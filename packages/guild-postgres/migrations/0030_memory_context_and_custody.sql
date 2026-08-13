-- Complete the Guild Memory boundary: explicit constitutional policy, custody,
-- a secured Context Graph, semantic retrieval, and review signals.

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

ALTER TABLE constitutions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE relations NO FORCE ROW LEVEL SECURITY;

ALTER TABLE constitutions
  ADD COLUMN principles text NOT NULL DEFAULT ''
    CHECK (length(principles) <= 20000),
  ADD COLUMN public_scope text NOT NULL DEFAULT ''
    CHECK (length(public_scope) <= 10000),
  ADD COLUMN membership_policy jsonb NOT NULL DEFAULT '{"preboardingRequired":true,"departureMode":"revoke_then_handover"}'::jsonb
    CHECK (jsonb_typeof(membership_policy) = 'object'),
  ADD COLUMN data_policy jsonb NOT NULL DEFAULT '{"defaultVisibility":"guild","defaultClassification":"internal","personalDataOnDeparture":"retain_by_policy","crossGuildSharing":"explicit_only"}'::jsonb
    CHECK (jsonb_typeof(data_policy) = 'object'),
  ADD COLUMN agent_policy jsonb NOT NULL DEFAULT '{"level0Automatic":true,"level1Automatic":false,"level2HumanApproval":true,"level3MultiHumanApproval":true}'::jsonb
    CHECK (jsonb_typeof(agent_policy) = 'object'),
  ADD COLUMN external_sharing_policy jsonb NOT NULL DEFAULT '{"enabled":false,"requireHumanApproval":true}'::jsonb
    CHECK (jsonb_typeof(external_sharing_policy) = 'object');

ALTER TABLE memories
  ADD COLUMN layer text NOT NULL DEFAULT 'working'
    CHECK (layer IN ('canonical', 'working', 'external')),
  ADD COLUMN origin_custody text NOT NULL DEFAULT 'guild'
    CHECK (origin_custody IN ('guild', 'personal')),
  ADD COLUMN provenance jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(provenance) = 'object'),
  ADD COLUMN last_verified_at timestamptz;

UPDATE memories
   SET layer = CASE
     WHEN workflow = 'canonical' AND governance_state IN ('canonical', 'deprecated', 'archived')
       THEN 'canonical'
     WHEN type = 'external' THEN 'external'
     ELSE 'working'
   END;

ALTER TABLE memories
  ADD CONSTRAINT memory_layer_governance CHECK (
    layer <> 'canonical'
    OR workflow = 'canonical' AND governance_state IN ('canonical', 'deprecated', 'archived')
  );

CREATE OR REPLACE FUNCTION guild_runtime.sync_memory_layer() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.workflow = 'canonical' AND NEW.governance_state IN ('canonical', 'deprecated', 'archived') THEN
    NEW.layer := 'canonical';
  ELSIF NEW.type = 'external' THEN
    NEW.layer := 'external';
  ELSIF NEW.layer = 'canonical' THEN
    NEW.layer := 'working';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_layer_sync
BEFORE INSERT OR UPDATE OF workflow, governance_state, type, layer ON memories
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_memory_layer();

CREATE FUNCTION guild_runtime.prevent_memory_origin_custody_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.origin_custody IS DISTINCT FROM NEW.origin_custody THEN
    RAISE EXCEPTION 'Memory origin custody is immutable; use an explicit custody transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_origin_custody_immutable
BEFORE UPDATE OF origin_custody ON memories
FOR EACH ROW EXECUTE FUNCTION guild_runtime.prevent_memory_origin_custody_change();

ALTER TABLE relations
  ADD COLUMN space_id uuid,
  ADD COLUMN owner_actor_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'guild'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN allowed_actor_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked')),
  ADD COLUMN properties jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(properties) = 'object'),
  ADD COLUMN rationale text NOT NULL DEFAULT ''
    CHECK (length(rationale) <= 5000),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN revoked_by_actor_id uuid,
  ADD COLUMN revoked_at timestamptz,
  ADD CONSTRAINT relations_space_fk
    FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  ADD CONSTRAINT relations_owner_fk
    FOREIGN KEY (guild_id, owner_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  ADD CONSTRAINT relations_revoker_fk
    FOREIGN KEY (guild_id, revoked_by_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  ADD CONSTRAINT relations_allowed_limit CHECK (cardinality(allowed_actor_ids) <= 100),
  ADD CONSTRAINT relations_space_visibility CHECK (visibility <> 'space' OR space_id IS NOT NULL),
  ADD CONSTRAINT relations_explicit_access CHECK (
    visibility IN ('restricted', 'private') OR cardinality(allowed_actor_ids) = 0
  ),
  ADD CONSTRAINT relations_revocation_shape CHECK (
    (status = 'active' AND revoked_by_actor_id IS NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_by_actor_id IS NOT NULL AND revoked_at IS NOT NULL)
  );

UPDATE relations SET owner_actor_id = created_by_identity_id;
ALTER TABLE relations ALTER COLUMN owner_actor_id SET NOT NULL;

CREATE INDEX relations_from_idx
  ON relations (guild_id, from_type, from_id, status, created_at DESC);
CREATE INDEX relations_to_idx
  ON relations (guild_id, to_type, to_id, status, created_at DESC);
CREATE INDEX relations_space_idx
  ON relations (guild_id, space_id, status, created_at DESC);

CREATE FUNCTION guild_runtime.context_endpoint_boundary(
  target_guild_id uuid,
  target_type text,
  target_id uuid
) RETURNS TABLE (
  space_id uuid,
  owner_actor_id uuid,
  visibility text,
  classification text,
  allowed_actor_ids uuid[],
  read_permission text
) LANGUAGE sql STABLE AS $$
  SELECT subject.space_id, subject.owner_identity_id, subject.visibility,
         subject.classification, subject.allowed_identity_ids, subject.read_permission
    FROM guild_runtime.conversation_subject(
      target_guild_id,
      CASE WHEN target_type = 'external_source' THEN 'memory' ELSE target_type END,
      target_id
    ) subject
   WHERE target_type IN ('memory', 'external_source', 'activity', 'knowledge',
                         'decision', 'announcement', 'agent_run')
     AND (target_type <> 'external_source' OR EXISTS (
       SELECT 1 FROM memories memory
        WHERE memory.guild_id = target_guild_id AND memory.id = target_id
          AND memory.layer = 'external'
     ))
  UNION ALL
  SELECT connection.space_id, connection.owner_identity_id, connection.visibility,
         connection.classification, connection.allowed_identity_ids, 'connection.read'
    FROM connectors connection
   WHERE target_type = 'connection' AND connection.guild_id = target_guild_id
     AND connection.id = target_id AND connection.status <> 'revoked'
  UNION ALL
  SELECT file_row.space_id, file_row.owner_actor_id, file_row.visibility,
         file_row.classification, file_row.allowed_actor_ids, 'file.read'
    FROM files file_row
   WHERE target_type = 'file' AND file_row.guild_id = target_guild_id
     AND file_row.id = target_id AND file_row.status <> 'deleted'
  UNION ALL
  SELECT event.space_id, event.owner_identity_id, event.visibility,
         event.classification, event.allowed_identity_ids, 'event.read'
    FROM chronicle_events event
   WHERE target_type = 'event' AND event.guild_id = target_guild_id AND event.id = target_id
  UNION ALL
  SELECT NULL::uuid, actor.id, 'guild'::text, 'internal'::text,
         '{}'::uuid[], 'actor.read'::text
    FROM actors actor
    JOIN actor_memberships membership
      ON membership.guild_id = target_guild_id AND membership.actor_id = actor.id
   WHERE target_type = 'actor' AND actor.id = target_id AND actor.status = 'active'
     AND membership.operational AND membership.state IN ('joined', 'active')
$$;

CREATE FUNCTION guild_runtime.actor_can_read_context_endpoint(
  target_guild_id uuid,
  target_actor_id uuid,
  target_type text,
  target_id uuid
) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE subject AS (
    SELECT * FROM guild_runtime.context_endpoint_boundary(
      target_guild_id, target_type, target_id
    )
  ), actor AS (
    SELECT actor_row.id, membership.clearance,
           guild.root_owner_identity_id = actor_row.id AS is_root
      FROM actors actor_row
      JOIN actor_memberships membership
        ON membership.actor_id = actor_row.id AND membership.guild_id = target_guild_id
      JOIN guilds guild ON guild.id = membership.guild_id
     WHERE actor_row.id = target_actor_id AND actor_row.status = 'active'
       AND membership.operational AND membership.state = 'active'
  ), ancestors AS (
    SELECT space.id, space.parent_space_id
      FROM spaces space JOIN subject ON subject.space_id = space.id
     WHERE space.guild_id = target_guild_id AND space.status = 'active'
    UNION ALL
    SELECT parent.id, parent.parent_space_id
      FROM spaces parent JOIN ancestors child ON child.parent_space_id = parent.id
     WHERE parent.guild_id = target_guild_id AND parent.status = 'active'
  ), granted_permissions AS (
    SELECT DISTINCT permission.permission
      FROM actor_role_bindings binding
      JOIN role_permissions permission
        ON permission.guild_id = binding.guild_id AND permission.role_id = binding.role_id
     WHERE binding.guild_id = target_guild_id AND binding.actor_id = target_actor_id
       AND (binding.space_id IS NULL OR EXISTS (
         SELECT 1 FROM ancestors WHERE ancestors.id = binding.space_id
       ))
  )
  SELECT EXISTS (
    SELECT 1 FROM actor CROSS JOIN subject
     WHERE (actor.is_root OR (
       EXISTS (SELECT 1 FROM granted_permissions WHERE permission = 'relation.read')
       AND EXISTS (
         SELECT 1 FROM granted_permissions WHERE permission = subject.read_permission
       )
     ))
       AND CASE subject.classification
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3 END
           <= CASE actor.clearance
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3 END
       AND (subject.visibility NOT IN ('private', 'restricted')
         OR subject.owner_actor_id = actor.id
         OR actor.id = ANY(subject.allowed_actor_ids))
  )
$$;

CREATE FUNCTION guild_runtime.context_endpoint_label(
  target_guild_id uuid,
  target_type text,
  target_id uuid
) RETURNS text LANGUAGE sql STABLE AS $$
  SELECT label FROM (
    SELECT COALESCE(version.title ->> 'en', version.title ->> 'ja',
                    version.title ->> 'zh-CN', 'Memory') AS label
      FROM memories memory JOIN memory_versions version
        ON version.guild_id = memory.guild_id AND version.memory_id = memory.id
       AND version.version = memory.current_version
     WHERE target_type IN ('memory', 'external_source')
       AND memory.guild_id = target_guild_id AND memory.id = target_id
       AND (target_type <> 'external_source' OR memory.layer = 'external')
    UNION ALL SELECT activity.title FROM activities activity
     WHERE target_type = 'activity' AND activity.guild_id = target_guild_id
       AND activity.id = target_id
    UNION ALL SELECT COALESCE(version.title ->> 'en', version.title ->> 'ja',
                              version.title ->> 'zh-CN', 'Knowledge')
      FROM knowledge item JOIN knowledge_versions version
        ON version.guild_id = item.guild_id AND version.knowledge_id = item.id
       AND version.version = item.current_version
     WHERE target_type = 'knowledge' AND item.guild_id = target_guild_id AND item.id = target_id
    UNION ALL SELECT decision.title FROM decisions decision
     WHERE target_type = 'decision' AND decision.guild_id = target_guild_id
       AND decision.id = target_id
    UNION ALL SELECT announcement.title FROM announcements announcement
     WHERE target_type = 'announcement' AND announcement.guild_id = target_guild_id
       AND announcement.id = target_id
    UNION ALL SELECT COALESCE(run.plan ->> 'objective', 'Agent run') FROM agent_runs run
     WHERE target_type = 'agent_run' AND run.guild_id = target_guild_id AND run.id = target_id
    UNION ALL SELECT connection.name FROM connectors connection
     WHERE target_type = 'connection' AND connection.guild_id = target_guild_id
       AND connection.id = target_id
    UNION ALL SELECT file_row.original_name FROM files file_row
     WHERE target_type = 'file' AND file_row.guild_id = target_guild_id AND file_row.id = target_id
    UNION ALL SELECT actor.display_name FROM actors actor JOIN actor_memberships membership
      ON membership.guild_id = target_guild_id AND membership.actor_id = actor.id
     WHERE target_type = 'actor' AND actor.id = target_id
    UNION ALL SELECT event.action FROM chronicle_events event
     WHERE target_type = 'event' AND event.guild_id = target_guild_id AND event.id = target_id
  ) labels LIMIT 1
$$;

CREATE FUNCTION guild_runtime.enforce_context_relation_endpoints() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM guild_runtime.context_endpoint_boundary(
      NEW.guild_id, NEW.from_type, NEW.from_id
    )
  ) OR NOT EXISTS (
    SELECT 1 FROM guild_runtime.context_endpoint_boundary(
      NEW.guild_id, NEW.to_type, NEW.to_id
    )
  ) THEN
    RAISE EXCEPTION 'Both Context Graph endpoints must exist in the same Guild';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relation_endpoint_integrity
BEFORE INSERT ON relations
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_context_relation_endpoints();

CREATE FUNCTION guild_runtime.enforce_relation_governance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Context Graph relations are append-only and cannot be deleted';
  END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.from_type IS DISTINCT FROM NEW.from_type
     OR OLD.from_id IS DISTINCT FROM NEW.from_id
     OR OLD.relation_type IS DISTINCT FROM NEW.relation_type
     OR OLD.to_type IS DISTINCT FROM NEW.to_type
     OR OLD.to_id IS DISTINCT FROM NEW.to_id
     OR OLD.created_by_identity_id IS DISTINCT FROM NEW.created_by_identity_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.owner_actor_id IS DISTINCT FROM NEW.owner_actor_id
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
     OR OLD.classification IS DISTINCT FROM NEW.classification
     OR OLD.allowed_actor_ids IS DISTINCT FROM NEW.allowed_actor_ids
     OR OLD.properties IS DISTINCT FROM NEW.properties
     OR OLD.rationale IS DISTINCT FROM NEW.rationale THEN
    RAISE EXCEPTION 'Context Graph relation content and security boundary are immutable';
  END IF;
  IF OLD.status <> 'active' OR NEW.status <> 'revoked'
     OR NEW.revoked_by_actor_id IS NULL OR NEW.revoked_at IS NULL THEN
    RAISE EXCEPTION 'A Context Graph relation can only be revoked once';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Context Graph relation revocation requires one version increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER relation_governance
BEFORE UPDATE OR DELETE ON relations
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_relation_governance();

CREATE TABLE resource_custody (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  resource_type text NOT NULL CHECK (
    resource_type IN ('memory', 'activity', 'decision', 'conversation', 'file', 'agent_run')
  ),
  resource_id uuid NOT NULL,
  custody text NOT NULL CHECK (custody IN ('guild', 'personal', 'shared')),
  personal_owner_actor_id uuid,
  shared_by_actor_id uuid,
  shared_at timestamptz,
  retention_until timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, resource_type, resource_id),
  FOREIGN KEY (guild_id, personal_owner_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, shared_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (
    (custody = 'guild' AND personal_owner_actor_id IS NULL AND shared_by_actor_id IS NULL AND shared_at IS NULL)
    OR (custody = 'personal' AND personal_owner_actor_id IS NOT NULL AND shared_by_actor_id IS NULL AND shared_at IS NULL)
    OR (custody = 'shared' AND personal_owner_actor_id IS NOT NULL AND shared_by_actor_id IS NOT NULL AND shared_at IS NOT NULL)
  )
);

CREATE FUNCTION guild_runtime.enforce_custody_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.resource_type IS DISTINCT FROM NEW.resource_type
     OR OLD.resource_id IS DISTINCT FROM NEW.resource_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Resource custody identity is immutable';
  END IF;
  IF OLD.custody = 'guild' AND NEW.custody <> 'guild' THEN
    RAISE EXCEPTION 'Guild Data cannot be converted into Personal Data';
  END IF;
  IF OLD.custody = 'shared' AND NEW.custody = 'personal' THEN
    RAISE EXCEPTION 'Shared Data cannot silently be withdrawn from Guild history';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Custody changes require one version increment';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER custody_transition
BEFORE UPDATE ON resource_custody
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_custody_transition();

CREATE FUNCTION guild_runtime.register_resource_custody() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  owner_id uuid;
  resource_kind text := TG_ARGV[0];
BEGIN
  owner_id := COALESCE(
    NULLIF(to_jsonb(NEW) ->> 'owner_actor_id', '')::uuid,
    NULLIF(to_jsonb(NEW) ->> 'owner_identity_id', '')::uuid
  );
  INSERT INTO resource_custody (
    guild_id, resource_type, resource_id, custody, personal_owner_actor_id
  ) VALUES (
    NEW.guild_id,
    resource_kind,
    NEW.id,
    CASE WHEN COALESCE(to_jsonb(NEW) ->> 'origin_custody', 'guild') = 'personal'
      THEN 'personal' ELSE 'guild' END,
    CASE WHEN COALESCE(to_jsonb(NEW) ->> 'origin_custody', 'guild') = 'personal'
      THEN owner_id ELSE NULL END
  ) ON CONFLICT (guild_id, resource_type, resource_id) DO NOTHING;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memories_register_custody
AFTER INSERT ON memories FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('memory');
CREATE TRIGGER activities_register_custody
AFTER INSERT ON activities FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('activity');
CREATE TRIGGER decisions_register_custody
AFTER INSERT ON decisions FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('decision');
CREATE TRIGGER conversations_register_custody
AFTER INSERT ON conversations FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('conversation');
CREATE TRIGGER files_register_custody
AFTER INSERT ON files FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('file');
CREATE TRIGGER agent_runs_register_custody
AFTER INSERT ON agent_runs FOR EACH ROW
EXECUTE FUNCTION guild_runtime.register_resource_custody('agent_run');

INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'memory', id,
       CASE WHEN origin_custody = 'personal' THEN 'personal' ELSE 'guild' END,
       CASE WHEN origin_custody = 'personal' THEN owner_actor_id ELSE NULL END
  FROM memories ON CONFLICT DO NOTHING;
INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'activity', id,
       'guild', NULL
  FROM activities ON CONFLICT DO NOTHING;
INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'decision', id,
       'guild', NULL
  FROM decisions ON CONFLICT DO NOTHING;
INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'conversation', id,
       'guild', NULL
  FROM conversations ON CONFLICT DO NOTHING;
INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'file', id,
       'guild', NULL
  FROM files ON CONFLICT DO NOTHING;
INSERT INTO resource_custody (guild_id, resource_type, resource_id, custody, personal_owner_actor_id)
SELECT guild_id, 'agent_run', id,
       'guild', NULL
  FROM agent_runs ON CONFLICT DO NOTHING;

CREATE TABLE memory_embeddings (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  memory_id uuid NOT NULL,
  memory_version integer NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'ja', 'zh-CN')),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  embedding vector(1024) NOT NULL,
  indexed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, memory_id, memory_version, locale, model),
  FOREIGN KEY (guild_id, memory_id, memory_version)
    REFERENCES memory_versions(guild_id, memory_id, version) ON DELETE RESTRICT
);

CREATE INDEX memory_embeddings_cosine_idx
  ON memory_embeddings USING hnsw (embedding vector_cosine_ops);

CREATE TABLE memory_embedding_jobs (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  memory_id uuid NOT NULL,
  memory_version integer NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'ja', 'zh-CN')),
  model text NOT NULL DEFAULT '@cf/baai/bge-m3'
    CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 10),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, memory_id, memory_version, locale, model),
  FOREIGN KEY (guild_id, memory_id, memory_version)
    REFERENCES memory_versions(guild_id, memory_id, version) ON DELETE RESTRICT
);

CREATE INDEX memory_embedding_jobs_ready_idx
  ON memory_embedding_jobs (guild_id, available_at, created_at)
  WHERE status IN ('pending', 'failed');

CREATE FUNCTION guild_runtime.enqueue_memory_embeddings() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  language text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource_custody custody
     WHERE custody.guild_id = NEW.guild_id AND custody.resource_type = 'memory'
       AND custody.resource_id = NEW.memory_id AND custody.custody IN ('guild', 'shared')
  ) THEN
    RETURN NEW;
  END IF;
  FOR language IN SELECT jsonb_object_keys(NEW.body)
  LOOP
    IF language IN ('en', 'ja', 'zh-CN') THEN
      INSERT INTO memory_embedding_jobs (
        id, guild_id, memory_id, memory_version, locale
      ) VALUES (gen_random_uuid(), NEW.guild_id, NEW.memory_id, NEW.version, language)
      ON CONFLICT (guild_id, memory_id, memory_version, locale, model) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_version_embedding_job
AFTER INSERT ON memory_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enqueue_memory_embeddings();

INSERT INTO memory_embedding_jobs (id, guild_id, memory_id, memory_version, locale)
SELECT gen_random_uuid(), version_row.guild_id, version_row.memory_id,
       version_row.version, language.locale
  FROM memory_versions version_row
  JOIN resource_custody custody ON custody.guild_id = version_row.guild_id
       AND custody.resource_type = 'memory' AND custody.resource_id = version_row.memory_id
       AND custody.custody IN ('guild', 'shared')
 CROSS JOIN LATERAL jsonb_object_keys(version_row.body) AS language(locale)
 WHERE language.locale IN ('en', 'ja', 'zh-CN')
ON CONFLICT DO NOTHING;

CREATE TABLE memory_review_signals (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  memory_id uuid NOT NULL,
  compared_memory_id uuid,
  kind text NOT NULL CHECK (kind IN (
    'stale', 'possible_contradiction', 'missing_source', 'low_confidence'
  )),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved', 'dismissed')),
  evidence text NOT NULL CHECK (length(btrim(evidence)) BETWEEN 1 AND 10000),
  detected_by_actor_id uuid,
  resolved_by_actor_id uuid,
  resolution text CHECK (resolution IS NULL OR length(resolution) <= 5000),
  detected_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE NULLS NOT DISTINCT (guild_id, memory_id, compared_memory_id, kind, status),
  FOREIGN KEY (guild_id, memory_id) REFERENCES memories(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, compared_memory_id) REFERENCES memories(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, detected_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, resolved_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (memory_id IS DISTINCT FROM compared_memory_id),
  CHECK (
    (status = 'open' AND resolved_by_actor_id IS NULL AND resolution IS NULL AND resolved_at IS NULL)
    OR (status IN ('resolved', 'dismissed') AND resolved_by_actor_id IS NOT NULL
        AND resolution IS NOT NULL AND resolved_at IS NOT NULL)
  )
);

CREATE INDEX memory_review_signals_open_idx
  ON memory_review_signals (guild_id, status, detected_at DESC);

CREATE FUNCTION guild_runtime.enforce_memory_review_signal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Memory review signals are append-only and cannot be deleted';
  END IF;
  IF OLD.status <> 'open' OR NEW.status NOT IN ('resolved', 'dismissed') THEN
    RAISE EXCEPTION 'A Memory review signal can only be resolved or dismissed once';
  END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.memory_id IS DISTINCT FROM NEW.memory_id
     OR OLD.compared_memory_id IS DISTINCT FROM NEW.compared_memory_id
     OR OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.evidence IS DISTINCT FROM NEW.evidence
     OR OLD.detected_by_actor_id IS DISTINCT FROM NEW.detected_by_actor_id
     OR OLD.detected_at IS DISTINCT FROM NEW.detected_at THEN
    RAISE EXCEPTION 'Memory review evidence is immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Memory review resolution requires one version increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_review_signal_governance
BEFORE UPDATE OR DELETE ON memory_review_signals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_memory_review_signal();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'resource_custody', 'memory_embeddings', 'memory_embedding_jobs',
    'memory_review_signals'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY guild_scope ON %I USING (guild_id = guild_runtime.current_guild_id()) WITH CHECK (guild_id = guild_runtime.current_guild_id())',
      table_name
    );
  END LOOP;
END;
$$;

ALTER TABLE constitutions FORCE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
ALTER TABLE memory_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE relations FORCE ROW LEVEL SECURITY;
