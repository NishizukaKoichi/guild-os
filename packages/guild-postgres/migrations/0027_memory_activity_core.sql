-- Add broad Memory and recursive Activity primitives without removing the governed
-- Knowledge or fixed Work compatibility models.

ALTER TABLE knowledge NO FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_version_files NO FORCE ROW LEVEL SECURITY;
ALTER TABLE files NO FORCE ROW LEVEL SECURITY;
ALTER TABLE goals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;
ALTER TABLE quests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE steps NO FORCE ROW LEVEL SECURITY;
ALTER TABLE decisions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_runs NO FORCE ROW LEVEL SECURITY;

CREATE TABLE memories (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  space_id uuid,
  owner_actor_id uuid NOT NULL,
  creator_actor_id uuid NOT NULL,
  type text NOT NULL CHECK (
    type IN (
      'fact', 'document', 'conversation', 'event', 'experience', 'rule',
      'decision', 'artifact', 'research', 'data', 'manual', 'failure',
      'learning', 'external', 'agent_output', 'knowledge'
    ) OR type ~ '^custom:[a-z0-9][a-z0-9_-]{1,62}$'
  ),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  workflow text CHECK (workflow IN ('canonical')),
  governance_state text CHECK (
    governance_state IS NULL OR governance_state IN (
      'draft', 'proposed', 'canonical', 'deprecated', 'archived'
    )
  ),
  visibility text NOT NULL CHECK (visibility IN (
    'guild', 'space', 'restricted', 'private'
  )),
  classification text NOT NULL CHECK (classification IN (
    'public', 'internal', 'confidential', 'restricted'
  )),
  allowed_actor_ids uuid[] NOT NULL DEFAULT '{}',
  current_version integer NOT NULL CHECK (current_version > 0),
  canonical_version integer,
  confidence numeric(5,4) CHECK (confidence BETWEEN 0 AND 1),
  source_ids uuid[] NOT NULL DEFAULT '{}',
  review_due_at timestamptz,
  legacy_source_type text CHECK (legacy_source_type IS NULL OR legacy_source_type = 'knowledge'),
  legacy_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, legacy_source_type, legacy_source_id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, creator_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (cardinality(allowed_actor_ids) <= 100),
  CHECK (cardinality(source_ids) <= 100),
  CHECK (
    (workflow = 'canonical' AND governance_state IS NOT NULL)
    OR (workflow IS NULL AND governance_state IS NULL)
  )
);

CREATE TABLE memory_versions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  memory_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title jsonb NOT NULL CHECK (guild_runtime.valid_localized_text(title, 1, 200)),
  summary jsonb NOT NULL CHECK (guild_runtime.valid_localized_text(summary, 1, 2000)),
  body jsonb NOT NULL CHECK (guild_runtime.valid_localized_text(body, 1, 200000)),
  source_ids uuid[] NOT NULL DEFAULT '{}',
  change_note text NOT NULL DEFAULT '' CHECK (length(change_note) <= 2000),
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, memory_id, version),
  FOREIGN KEY (guild_id, memory_id) REFERENCES memories(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, created_by_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (guild_runtime.knowledge_languages_match(title, summary, body)),
  CHECK (cardinality(source_ids) <= 100)
);

ALTER TABLE memories
  ADD CONSTRAINT memories_current_version_fk
    FOREIGN KEY (guild_id, id, current_version)
    REFERENCES memory_versions(guild_id, memory_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT memories_canonical_version_fk
    FOREIGN KEY (guild_id, id, canonical_version)
    REFERENCES memory_versions(guild_id, memory_id, version)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE memory_version_files (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  memory_id uuid NOT NULL,
  memory_version integer NOT NULL,
  file_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, memory_id, memory_version, file_id),
  UNIQUE (guild_id, memory_id, memory_version, position),
  FOREIGN KEY (guild_id, memory_id, memory_version)
    REFERENCES memory_versions(guild_id, memory_id, version),
  FOREIGN KEY (guild_id, file_id) REFERENCES files(guild_id, id)
);

CREATE TABLE activities (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  parent_activity_id uuid,
  space_id uuid,
  owner_actor_id uuid NOT NULL,
  creator_actor_id uuid NOT NULL,
  assignee_actor_id uuid,
  type text NOT NULL CHECK (
    type IN (
      'task', 'project', 'quest', 'event', 'discussion', 'experiment',
      'study', 'campaign', 'ritual', 'session', 'creation', 'maintenance',
      'investigation', 'goal', 'step'
    ) OR type ~ '^custom:[a-z0-9][a-z0-9_-]{1,62}$'
  ),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status text NOT NULL CHECK (status IN (
    'proposed', 'planned', 'ready', 'active', 'paused', 'blocked',
    'completed', 'cancelled', 'archived'
  )),
  visibility text NOT NULL CHECK (visibility IN (
    'guild', 'space', 'restricted', 'private'
  )),
  classification text NOT NULL CHECK (classification IN (
    'public', 'internal', 'confidential', 'restricted'
  )),
  allowed_actor_ids uuid[] NOT NULL DEFAULT '{}',
  source_ids uuid[] NOT NULL DEFAULT '{}',
  starts_at timestamptz,
  due_at timestamptz,
  position integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  legacy_source_type text CHECK (
    legacy_source_type IS NULL OR legacy_source_type IN ('goal', 'project', 'quest', 'step')
  ),
  legacy_source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, legacy_source_type, legacy_source_id),
  FOREIGN KEY (guild_id, parent_activity_id)
    REFERENCES activities(guild_id, id) DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, creator_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, assignee_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (parent_activity_id IS NULL OR parent_activity_id <> id),
  CHECK (cardinality(allowed_actor_ids) <= 100),
  CHECK (cardinality(source_ids) <= 100),
  CHECK (starts_at IS NULL OR due_at IS NULL OR starts_at <= due_at)
);

CREATE TABLE activity_dependencies (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  depends_on_activity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('blocks', 'relates_to', 'follows')),
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, activity_id, depends_on_activity_id, kind),
  FOREIGN KEY (guild_id, activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, depends_on_activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, created_by_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (activity_id <> depends_on_activity_id)
);

CREATE TABLE activity_memory_links (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  memory_id uuid NOT NULL,
  relation text NOT NULL CHECK (relation IN (
    'input', 'output', 'evidence', 'result', 'context'
  )),
  created_by_actor_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, activity_id, memory_id, relation),
  FOREIGN KEY (guild_id, activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, memory_id) REFERENCES memories(guild_id, id),
  FOREIGN KEY (guild_id, created_by_actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

ALTER TABLE decisions
  ADD COLUMN method text NOT NULL DEFAULT 'custodian'
    CHECK (method IN ('custodian', 'consent', 'vote', 'review', 'editorial', 'policy', 'hybrid'));

ALTER TABLE files
  ADD COLUMN owner_actor_id uuid,
  ADD COLUMN allowed_actor_ids uuid[];
UPDATE files
   SET owner_actor_id = owner_identity_id,
       allowed_actor_ids = allowed_identity_ids;
ALTER TABLE files
  ALTER COLUMN owner_actor_id SET NOT NULL,
  ALTER COLUMN allowed_actor_ids SET NOT NULL,
  ADD FOREIGN KEY (guild_id, owner_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  ADD CONSTRAINT files_allowed_actor_limit CHECK (cardinality(allowed_actor_ids) <= 100);

ALTER TABLE agent_runs
  ADD COLUMN activity_id uuid,
  ADD CONSTRAINT agent_runs_activity_fk
    FOREIGN KEY (guild_id, activity_id) REFERENCES activities(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED;

INSERT INTO memories (
  id, guild_id, space_id, owner_actor_id, creator_actor_id, type, status,
  workflow, governance_state, visibility, classification, allowed_actor_ids,
  current_version, canonical_version, source_ids, review_due_at,
  legacy_source_type, legacy_source_id, created_at, updated_at
)
SELECT k.id, k.guild_id, k.space_id, k.owner_identity_id,
       COALESCE(first_version.created_by_identity_id, k.owner_identity_id),
       'knowledge', CASE WHEN k.state = 'archived' THEN 'archived' ELSE 'active' END,
       'canonical', k.state, k.visibility, k.classification, k.allowed_identity_ids,
       k.current_version, k.canonical_version,
       COALESCE(current_version.source_ids, '{}'::uuid[]), k.review_due_at,
       'knowledge', k.id, k.created_at, k.updated_at
  FROM knowledge k
  LEFT JOIN knowledge_versions first_version
    ON first_version.guild_id = k.guild_id
   AND first_version.knowledge_id = k.id
   AND first_version.version = 1
  LEFT JOIN knowledge_versions current_version
    ON current_version.guild_id = k.guild_id
   AND current_version.knowledge_id = k.id
   AND current_version.version = k.current_version;

INSERT INTO memory_versions (
  guild_id, memory_id, version, title, summary, body, source_ids,
  change_note, created_by_actor_id, created_at
)
SELECT guild_id, knowledge_id, version, title, summary, body, source_ids,
       change_note, created_by_identity_id, created_at
  FROM knowledge_versions;

INSERT INTO memory_version_files (
  guild_id, memory_id, memory_version, file_id, position, created_at
)
SELECT guild_id, knowledge_id, knowledge_version, file_id, position, created_at
  FROM knowledge_version_files;

DO $$
BEGIN
  IF EXISTS (
    SELECT id FROM (
      SELECT id FROM goals
      UNION ALL SELECT id FROM projects
      UNION ALL SELECT id FROM quests
      UNION ALL SELECT id FROM steps
    ) legacy_activities
    GROUP BY id HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Legacy Work UUID collision prevents an ID-preserving Activity migration';
  END IF;
END;
$$;

INSERT INTO activities (
  id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
  assignee_actor_id, type, title, description, status, visibility, classification,
  allowed_actor_ids, source_ids, due_at, position, version,
  legacy_source_type, legacy_source_id, created_at, updated_at
)
SELECT id, guild_id, NULL, space_id, owner_identity_id, creator_identity_id,
       NULL, 'goal', title, description,
       CASE status WHEN 'draft' THEN 'proposed' ELSE status END,
       visibility, classification, allowed_identity_ids, source_ids, target_at,
       0, version, 'goal', id, created_at, updated_at
  FROM goals;

INSERT INTO activities (
  id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
  assignee_actor_id, type, title, description, status, visibility, classification,
  allowed_actor_ids, source_ids, due_at, position, version,
  legacy_source_type, legacy_source_id, created_at, updated_at
)
SELECT id, guild_id, goal_id, space_id, owner_identity_id, creator_identity_id,
       NULL, 'project', title, description, status,
       visibility, classification, allowed_identity_ids, source_ids, due_at,
       0, version, 'project', id, created_at, updated_at
  FROM projects;

INSERT INTO activities (
  id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
  assignee_actor_id, type, title, description, status, visibility, classification,
  allowed_actor_ids, source_ids, due_at, position, version,
  legacy_source_type, legacy_source_id, created_at, updated_at
)
SELECT id, guild_id, project_id, space_id, owner_identity_id, creator_identity_id,
       assignee_identity_id, 'quest', title, description,
       CASE status WHEN 'backlog' THEN 'planned' WHEN 'in_progress' THEN 'active' ELSE status END,
       visibility, classification, allowed_identity_ids, source_ids, due_at,
       0, version, 'quest', id, created_at, updated_at
  FROM quests;

INSERT INTO activities (
  id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
  assignee_actor_id, type, title, description, status, visibility, classification,
  allowed_actor_ids, source_ids, position, version,
  legacy_source_type, legacy_source_id, created_at, updated_at
)
SELECT s.id, s.guild_id, s.quest_id, q.space_id, q.owner_identity_id,
       s.creator_identity_id, s.assignee_identity_id, 'step', s.title, s.description,
       CASE s.status WHEN 'pending' THEN 'planned' WHEN 'in_progress' THEN 'active'
         WHEN 'skipped' THEN 'cancelled' ELSE s.status END,
       q.visibility, q.classification, q.allowed_identity_ids, '{}'::uuid[],
       s.position, s.version, 'step', s.id, s.created_at, s.updated_at
  FROM steps s
  JOIN quests q ON q.guild_id = s.guild_id AND q.id = s.quest_id;

UPDATE agent_runs SET activity_id = quest_id WHERE quest_id IS NOT NULL;

CREATE INDEX memories_recent_idx
  ON memories (guild_id, status, space_id, updated_at DESC, id DESC);
CREATE INDEX memory_versions_search_idx ON memory_versions USING GIN (
  to_tsvector('simple',
    coalesce(title::text, '') || ' ' ||
    coalesce(summary::text, '') || ' ' ||
    coalesce(body::text, '')
  )
);
CREATE INDEX memory_file_lookup_idx
  ON memory_version_files (guild_id, file_id, memory_id);
CREATE INDEX activities_parent_recent_idx
  ON activities (guild_id, parent_activity_id, status, position, updated_at DESC, id);
CREATE INDEX activities_assignee_idx
  ON activities (guild_id, assignee_actor_id, status, due_at);

CREATE FUNCTION guild_runtime.reject_memory_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Memory versions are immutable';
  END IF;
  IF OLD IS DISTINCT FROM NEW THEN
    RAISE EXCEPTION 'Memory version content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER memory_versions_immutable
BEFORE UPDATE OR DELETE ON memory_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_memory_version_mutation();

CREATE FUNCTION guild_runtime.enforce_activity_hierarchy()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_space_id uuid;
BEGIN
  IF NEW.parent_activity_id IS NULL THEN RETURN NEW; END IF;

  SELECT space_id INTO parent_space_id
    FROM activities
   WHERE guild_id = NEW.guild_id AND id = NEW.parent_activity_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Activity parent does not exist in this Guild'; END IF;
  IF parent_space_id IS NOT NULL AND (
    NEW.space_id IS NULL
    OR NOT guild_runtime.space_contains(NEW.guild_id, parent_space_id, NEW.space_id)
  ) THEN
    RAISE EXCEPTION 'Child Activity cannot broaden its parent Space boundary';
  END IF;
  IF EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_activity_id, ARRAY[id] AS visited
        FROM activities
       WHERE guild_id = NEW.guild_id AND id = NEW.parent_activity_id
      UNION ALL
      SELECT parent.id, parent.parent_activity_id, child.visited || parent.id
        FROM activities parent
        JOIN ancestors child ON child.parent_activity_id = parent.id
       WHERE parent.guild_id = NEW.guild_id
         AND NOT parent.id = ANY(child.visited)
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Activity hierarchy cannot contain a cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_hierarchy_integrity
BEFORE INSERT OR UPDATE OF guild_id, parent_activity_id, space_id ON activities
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_activity_hierarchy();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'memories', 'memory_versions', 'memory_version_files', 'activities',
    'activity_dependencies', 'activity_memory_links'
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

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON memories FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at();
CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON activities FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at();

DO $$
DECLARE
  legacy_activity_count bigint;
BEGIN
  SELECT (SELECT count(*) FROM goals)
       + (SELECT count(*) FROM projects)
       + (SELECT count(*) FROM quests)
       + (SELECT count(*) FROM steps)
    INTO legacy_activity_count;
  IF (SELECT count(*) FROM memories) <> (SELECT count(*) FROM knowledge) THEN
    RAISE EXCEPTION 'Memory backfill count does not match Knowledge count';
  END IF;
  IF (SELECT count(*) FROM memory_versions) <> (SELECT count(*) FROM knowledge_versions) THEN
    RAISE EXCEPTION 'Memory version backfill count does not match Knowledge version count';
  END IF;
  IF (SELECT count(*) FROM memory_version_files) <> (SELECT count(*) FROM knowledge_version_files) THEN
    RAISE EXCEPTION 'Memory file backfill count does not match Knowledge file count';
  END IF;
  IF (SELECT count(*) FROM activities) <> legacy_activity_count THEN
    RAISE EXCEPTION 'Activity backfill count does not match legacy Work count';
  END IF;
  IF EXISTS (SELECT 1 FROM files WHERE owner_actor_id IS NULL OR allowed_actor_ids IS NULL) THEN
    RAISE EXCEPTION 'File Actor ownership backfill is incomplete';
  END IF;
END;
$$;

ALTER TABLE knowledge FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_versions FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge_version_files FORCE ROW LEVEL SECURITY;
ALTER TABLE files FORCE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE quests FORCE ROW LEVEL SECURITY;
ALTER TABLE steps FORCE ROW LEVEL SECURITY;
ALTER TABLE decisions FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
