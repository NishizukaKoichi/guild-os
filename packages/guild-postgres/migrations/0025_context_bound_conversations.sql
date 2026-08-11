ALTER TABLE conversations
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'locked')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN last_event_id uuid,
  ADD CONSTRAINT conversations_subject_type_check CHECK (
    subject_type IN (
      'knowledge', 'goal', 'project', 'quest', 'step',
      'decision', 'announcement', 'agent_run'
    )
  ),
  ADD CONSTRAINT conversations_boundary_shape_check CHECK (
    (visibility = 'space' AND space_id IS NOT NULL)
    OR (visibility = 'guild' AND space_id IS NULL)
    OR visibility IN ('restricted', 'private')
  ),
  ADD CONSTRAINT conversations_allowed_identity_limit CHECK (
    cardinality(allowed_identity_ids) <= 100
    AND array_position(allowed_identity_ids, NULL) IS NULL
  ),
  ADD CONSTRAINT conversations_last_event_fk
    FOREIGN KEY (guild_id, last_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE UNIQUE INDEX conversations_one_thread_per_subject_idx
  ON conversations (guild_id, subject_type, subject_id);

UPDATE conversation_messages SET body = btrim(body);
ALTER TABLE conversation_messages
  ADD COLUMN mentioned_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN state text NOT NULL DEFAULT 'active'
    CHECK (state IN ('active', 'redacted')),
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN last_event_id uuid,
  ADD COLUMN redacted_by_identity_id uuid,
  ADD COLUMN redacted_at timestamptz,
  ADD COLUMN redaction_reason text,
  ADD CONSTRAINT conversation_messages_trimmed_body_check CHECK (body = btrim(body)),
  ADD CONSTRAINT conversation_messages_mention_limit CHECK (
    cardinality(mentioned_identity_ids) <= 20
    AND array_position(mentioned_identity_ids, NULL) IS NULL
  ),
  ADD CONSTRAINT conversation_messages_redaction_shape_check CHECK (
    (state = 'active' AND redacted_by_identity_id IS NULL
      AND redacted_at IS NULL AND redaction_reason IS NULL)
    OR (state = 'redacted' AND redacted_by_identity_id IS NOT NULL
      AND redacted_at IS NOT NULL
      AND length(redaction_reason) BETWEEN 1 AND 2000
      AND redaction_reason = btrim(redaction_reason))
  ),
  ADD FOREIGN KEY (guild_id, redacted_by_identity_id)
    REFERENCES identities(guild_id, id),
  ADD CONSTRAINT conversation_messages_last_event_fk
    FOREIGN KEY (guild_id, last_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED;

CREATE INDEX conversation_messages_thread_cursor_idx
  ON conversation_messages (guild_id, conversation_id, created_at DESC, id DESC);

CREATE FUNCTION guild_runtime.conversation_subject(
  target_guild_id uuid,
  target_subject_type text,
  target_subject_id uuid
) RETURNS TABLE (
  space_id uuid,
  owner_identity_id uuid,
  visibility text,
  classification text,
  allowed_identity_ids uuid[],
  read_permission text
) LANGUAGE sql STABLE AS $$
  SELECT resource.space_id, resource.owner_identity_id, resource.visibility,
         resource.classification, resource.allowed_identity_ids, resource.read_permission
    FROM (
      SELECT k.space_id, k.owner_identity_id, k.visibility, k.classification,
             k.allowed_identity_ids, 'knowledge.read'::text AS read_permission
        FROM knowledge k
       WHERE target_subject_type = 'knowledge'
         AND k.guild_id = target_guild_id AND k.id = target_subject_id
      UNION ALL
      SELECT g.space_id, g.owner_identity_id, g.visibility, g.classification,
             g.allowed_identity_ids, 'work.read'::text
        FROM goals g
       WHERE target_subject_type = 'goal'
         AND g.guild_id = target_guild_id AND g.id = target_subject_id
      UNION ALL
      SELECT p.space_id, p.owner_identity_id, p.visibility, p.classification,
             p.allowed_identity_ids, 'work.read'::text
        FROM projects p
       WHERE target_subject_type = 'project'
         AND p.guild_id = target_guild_id AND p.id = target_subject_id
      UNION ALL
      SELECT q.space_id, q.owner_identity_id, q.visibility, q.classification,
             q.allowed_identity_ids, 'work.read'::text
        FROM quests q
       WHERE target_subject_type = 'quest'
         AND q.guild_id = target_guild_id AND q.id = target_subject_id
      UNION ALL
      SELECT q.space_id, q.owner_identity_id, q.visibility, q.classification,
             q.allowed_identity_ids, 'work.read'::text
        FROM steps s
        JOIN quests q ON q.guild_id = s.guild_id AND q.id = s.quest_id
       WHERE target_subject_type = 'step'
         AND s.guild_id = target_guild_id AND s.id = target_subject_id
      UNION ALL
      SELECT d.space_id, d.owner_identity_id, d.visibility, d.classification,
             d.allowed_identity_ids, 'decision.read'::text
        FROM decisions d
       WHERE target_subject_type = 'decision'
         AND d.guild_id = target_guild_id AND d.id = target_subject_id
      UNION ALL
      SELECT a.space_id, a.owner_identity_id, a.visibility, a.classification,
             a.allowed_identity_ids, 'announcement.read'::text
        FROM announcements a
       WHERE target_subject_type = 'announcement'
         AND a.guild_id = target_guild_id AND a.id = target_subject_id
      UNION ALL
      SELECT r.space_id, r.owner_identity_id, r.visibility, r.classification,
             r.allowed_identity_ids, 'agent.read'::text
        FROM agent_runs r
       WHERE target_subject_type = 'agent_run'
         AND r.guild_id = target_guild_id AND r.id = target_subject_id
    ) resource
$$;

CREATE FUNCTION guild_runtime.identity_can_access_conversation_subject(
  target_guild_id uuid,
  target_identity_id uuid,
  target_subject_type text,
  target_subject_id uuid,
  conversation_permission text
) RETURNS boolean LANGUAGE sql STABLE AS $$
  WITH RECURSIVE subject AS (
    SELECT * FROM guild_runtime.conversation_subject(
      target_guild_id, target_subject_type, target_subject_id
    )
  ),
  actor AS (
    SELECT identity_row.id, identity_row.kind, membership_row.state,
           membership_row.clearance,
           guild_row.root_owner_identity_id = identity_row.id AS is_root
      FROM identities identity_row
      JOIN memberships membership_row
        ON membership_row.guild_id = identity_row.guild_id
       AND membership_row.identity_id = identity_row.id
      JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
     WHERE identity_row.guild_id = target_guild_id
       AND identity_row.id = target_identity_id
       AND identity_row.status = 'active'
       AND membership_row.state IN ('preboarding', 'active')
  ),
  ancestors AS (
    SELECT space_row.id, space_row.parent_space_id
      FROM spaces space_row
      JOIN subject ON subject.space_id = space_row.id
     WHERE space_row.guild_id = target_guild_id AND space_row.status = 'active'
    UNION ALL
    SELECT parent.id, parent.parent_space_id
      FROM spaces parent
      JOIN ancestors child ON child.parent_space_id = parent.id
     WHERE parent.guild_id = target_guild_id AND parent.status = 'active'
  ),
  granted_permissions AS (
    SELECT DISTINCT permission_row.permission
      FROM role_bindings binding_row
      JOIN role_permissions permission_row
        ON permission_row.guild_id = binding_row.guild_id
       AND permission_row.role_id = binding_row.role_id
     WHERE binding_row.guild_id = target_guild_id
       AND binding_row.identity_id = target_identity_id
       AND (
         binding_row.space_id IS NULL
         OR EXISTS (SELECT 1 FROM ancestors WHERE ancestors.id = binding_row.space_id)
       )
  )
  SELECT EXISTS (
    SELECT 1 FROM actor CROSS JOIN subject
     WHERE (
       actor.is_root
       OR (
         EXISTS (
           SELECT 1 FROM granted_permissions
            WHERE permission = conversation_permission
         )
         AND EXISTS (
           SELECT 1 FROM granted_permissions
            WHERE permission = subject.read_permission
         )
         AND (
           actor.state = 'active'
           OR (
             conversation_permission IN ('conversation.read', 'conversation.create')
             AND subject.read_permission IN (
               'knowledge.read', 'work.read', 'announcement.read'
             )
           )
         )
         AND (conversation_permission <> 'conversation.moderate' OR actor.kind = 'human')
       )
     )
     AND CASE subject.classification
           WHEN 'public' THEN 0 WHEN 'internal' THEN 1
           WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
         END <= CASE actor.clearance
           WHEN 'public' THEN 0 WHEN 'internal' THEN 1
           WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
         END
     AND (
       subject.visibility NOT IN ('private', 'restricted')
       OR subject.owner_identity_id = actor.id
       OR actor.id = ANY(subject.allowed_identity_ids)
     )
  )
$$;

CREATE FUNCTION guild_runtime.enforce_conversation_governance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  subject record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Conversation history is append-only';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  IF actor_identity_id IS NULL THEN
    RAISE EXCEPTION 'Conversation mutation requires an authenticated actor';
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT * INTO subject FROM guild_runtime.conversation_subject(
      NEW.guild_id, NEW.subject_type, NEW.subject_id
    );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Conversation subject does not exist';
    END IF;
    IF NEW.space_id IS DISTINCT FROM subject.space_id
       OR NEW.owner_identity_id <> subject.owner_identity_id
       OR NEW.visibility <> subject.visibility
       OR NEW.classification <> subject.classification
       OR NOT (
         NEW.allowed_identity_ids @> subject.allowed_identity_ids
         AND subject.allowed_identity_ids @> NEW.allowed_identity_ids
       )
       OR NEW.status <> 'open' OR NEW.version <> 1
       OR NEW.last_event_id IS NULL THEN
      RAISE EXCEPTION 'Conversation must inherit its subject security boundary';
    END IF;
    IF EXISTS (
      SELECT 1 FROM unnest(NEW.allowed_identity_ids) identity_id
       GROUP BY identity_id HAVING count(*) > 1
    ) THEN
      RAISE EXCEPTION 'Conversation explicit audience must be unique';
    END IF;
    IF NOT guild_runtime.identity_can_access_conversation_subject(
      NEW.guild_id, actor_identity_id, NEW.subject_type, NEW.subject_id,
      'conversation.create'
    ) THEN
      RAISE EXCEPTION 'Conversation creation is not authorized';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id <> OLD.guild_id OR NEW.subject_type <> OLD.subject_type
     OR NEW.subject_id <> OLD.subject_id
     OR NEW.space_id IS DISTINCT FROM OLD.space_id
     OR NEW.owner_identity_id <> OLD.owner_identity_id
     OR NEW.visibility <> OLD.visibility
     OR NEW.classification <> OLD.classification
     OR NOT (
       NEW.allowed_identity_ids @> OLD.allowed_identity_ids
       AND OLD.allowed_identity_ids @> NEW.allowed_identity_ids
     )
     OR NEW.created_at <> OLD.created_at
     OR NEW.status = OLD.status OR NEW.version <> OLD.version + 1
     OR NEW.last_event_id IS NULL
     OR NEW.last_event_id IS NOT DISTINCT FROM OLD.last_event_id THEN
    RAISE EXCEPTION 'Invalid Conversation governance transition';
  END IF;
  IF NOT guild_runtime.identity_can_access_conversation_subject(
    NEW.guild_id, actor_identity_id, NEW.subject_type, NEW.subject_id,
    'conversation.moderate'
  ) THEN
    RAISE EXCEPTION 'Conversation moderation is not authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_governance_guard
BEFORE INSERT OR UPDATE OR DELETE ON conversations
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_conversation_governance();

CREATE FUNCTION guild_runtime.verify_conversation_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_actor_identity_id uuid;
  expected_action text;
  subject record;
BEGIN
  current_actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  expected_action := CASE
    WHEN TG_OP = 'INSERT' THEN 'conversation.opened'
    WHEN NEW.status = 'locked' THEN 'conversation.locked'
    ELSE 'conversation.unlocked'
  END;
  SELECT * INTO subject FROM guild_runtime.conversation_subject(
    NEW.guild_id, NEW.subject_type, NEW.subject_id
  );
  IF current_actor_identity_id IS NULL OR NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.id = NEW.last_event_id
       AND event.actor_identity_id = current_actor_identity_id
       AND event.action = expected_action
       AND event.subject_type = 'conversation'
       AND event.subject_id = NEW.id
       AND event.space_id IS NOT DISTINCT FROM subject.space_id
       AND event.owner_identity_id = subject.owner_identity_id
       AND event.visibility = subject.visibility
       AND event.classification = subject.classification
       AND event.allowed_identity_ids @> subject.allowed_identity_ids
       AND subject.allowed_identity_ids @> event.allowed_identity_ids
  ) THEN
    RAISE EXCEPTION 'Conversation mutation requires an atomic Chronicle event';
  END IF;
  IF TG_OP = 'UPDATE' AND NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id AND event.id = NEW.last_event_id
       AND event.sequence > COALESCE((
         SELECT previous.sequence FROM chronicle_events previous
          WHERE previous.guild_id = OLD.guild_id AND previous.id = OLD.last_event_id
       ), 0)
  ) THEN
    RAISE EXCEPTION 'Conversation mutation requires a newer Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER conversation_audit_required
AFTER INSERT OR UPDATE ON conversations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_conversation_audit();

CREATE FUNCTION guild_runtime.enforce_conversation_message_governance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  thread record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Conversation messages are append-only';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  IF actor_identity_id IS NULL THEN
    RAISE EXCEPTION 'Conversation message mutation requires an authenticated actor';
  END IF;
  SELECT subject_type, subject_id, status INTO thread
    FROM conversations
   WHERE guild_id = NEW.guild_id AND id = NEW.conversation_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation was not found';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.author_identity_id <> actor_identity_id OR thread.status <> 'open'
       OR NEW.state <> 'active' OR NEW.version <> 1
       OR NEW.last_event_id IS NULL
       OR NEW.edited_at IS NOT NULL OR NEW.redacted_by_identity_id IS NOT NULL
       OR NEW.redacted_at IS NOT NULL OR NEW.redaction_reason IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid Conversation message insert';
    END IF;
    IF actor_identity_id = ANY(NEW.mentioned_identity_ids)
       OR EXISTS (
         SELECT 1 FROM unnest(NEW.mentioned_identity_ids) identity_id
          GROUP BY identity_id HAVING count(*) > 1
       ) THEN
      RAISE EXCEPTION 'Conversation mentions must be unique and cannot include the author';
    END IF;
    IF NOT guild_runtime.identity_can_access_conversation_subject(
      NEW.guild_id, actor_identity_id, thread.subject_type, thread.subject_id,
      'conversation.create'
    ) THEN
      RAISE EXCEPTION 'Conversation message creation is not authorized';
    END IF;
    IF EXISTS (
      SELECT 1
        FROM unnest(NEW.mentioned_identity_ids) mentioned(identity_id)
        LEFT JOIN identities identity_row
          ON identity_row.guild_id = NEW.guild_id
         AND identity_row.id = mentioned.identity_id
        LEFT JOIN memberships membership_row
          ON membership_row.guild_id = identity_row.guild_id
         AND membership_row.identity_id = identity_row.id
       WHERE identity_row.id IS NULL OR membership_row.identity_id IS NULL
          OR identity_row.kind <> 'human'
          OR identity_row.status <> 'active'
          OR membership_row.state NOT IN ('preboarding', 'active')
          OR NOT guild_runtime.identity_can_access_conversation_subject(
            NEW.guild_id, mentioned.identity_id, thread.subject_type, thread.subject_id,
            'conversation.read'
          )
    ) THEN
      RAISE EXCEPTION 'Mentioned Human cannot read the Conversation subject';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id <> OLD.guild_id OR NEW.conversation_id <> OLD.conversation_id
     OR NEW.author_identity_id <> OLD.author_identity_id OR NEW.body <> OLD.body
     OR NEW.mentioned_identity_ids <> OLD.mentioned_identity_ids
     OR NEW.created_at <> OLD.created_at
     OR NEW.edited_at IS DISTINCT FROM OLD.edited_at
     OR OLD.state <> 'active' OR NEW.state <> 'redacted'
     OR NEW.version <> OLD.version + 1
     OR NEW.last_event_id IS NULL
     OR NEW.last_event_id IS NOT DISTINCT FROM OLD.last_event_id
     OR NEW.redacted_by_identity_id <> actor_identity_id
     OR NEW.redacted_at IS NULL OR NEW.redaction_reason IS NULL THEN
    RAISE EXCEPTION 'Invalid Conversation message redaction';
  END IF;
  IF NOT guild_runtime.identity_can_access_conversation_subject(
    NEW.guild_id, actor_identity_id, thread.subject_type, thread.subject_id,
    'conversation.moderate'
  ) THEN
    RAISE EXCEPTION 'Conversation message moderation is not authorized';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER conversation_message_governance_guard
BEFORE INSERT OR UPDATE OR DELETE ON conversation_messages
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_conversation_message_governance();

CREATE FUNCTION guild_runtime.verify_conversation_message_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  current_actor_identity_id uuid;
  expected_action text;
  subject record;
BEGIN
  current_actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  expected_action := CASE
    WHEN TG_OP = 'INSERT' THEN 'conversation.message.posted'
    ELSE 'conversation.message.redacted'
  END;
  SELECT subject_row.* INTO subject
    FROM conversations thread
    CROSS JOIN LATERAL guild_runtime.conversation_subject(
      thread.guild_id, thread.subject_type, thread.subject_id
    ) subject_row
   WHERE thread.guild_id = NEW.guild_id AND thread.id = NEW.conversation_id;
  IF current_actor_identity_id IS NULL OR NOT FOUND OR NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.id = NEW.last_event_id
       AND event.actor_identity_id = current_actor_identity_id
       AND event.action = expected_action
       AND event.subject_type = 'conversation_message'
       AND event.subject_id = NEW.id
       AND event.space_id IS NOT DISTINCT FROM subject.space_id
       AND event.owner_identity_id = subject.owner_identity_id
       AND event.visibility = subject.visibility
       AND event.classification = subject.classification
       AND event.allowed_identity_ids @> subject.allowed_identity_ids
       AND subject.allowed_identity_ids @> event.allowed_identity_ids
  ) THEN
    RAISE EXCEPTION 'Conversation message mutation requires an atomic Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER conversation_message_audit_required
AFTER INSERT OR UPDATE ON conversation_messages
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_conversation_message_audit();
