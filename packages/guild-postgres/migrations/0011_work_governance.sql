ALTER TABLE goals
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN target_at timestamptz,
  ADD CONSTRAINT goals_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT goals_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT goals_status_check CHECK (status IN ('draft', 'active', 'completed', 'cancelled')),
  ADD CONSTRAINT goals_sources_limit CHECK (cardinality(source_ids) <= 100),
  ADD CONSTRAINT goals_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100);

ALTER TABLE projects
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN due_at timestamptz,
  ADD CONSTRAINT projects_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT projects_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT projects_status_check CHECK (status IN ('planned', 'active', 'blocked', 'completed', 'cancelled')),
  ADD CONSTRAINT projects_sources_limit CHECK (cardinality(source_ids) <= 100),
  ADD CONSTRAINT projects_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100);

ALTER TABLE quests
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT quests_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT quests_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT quests_status_check CHECK (status IN ('backlog', 'ready', 'in_progress', 'blocked', 'completed', 'cancelled')),
  ADD CONSTRAINT quests_sources_limit CHECK (cardinality(source_ids) <= 100),
  ADD CONSTRAINT quests_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100);

ALTER TABLE steps
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT steps_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT steps_description_check CHECK (length(description) <= 10000),
  ADD CONSTRAINT steps_status_check CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped'));

CREATE INDEX goals_recent_idx ON goals (guild_id, updated_at DESC, id DESC);
CREATE INDEX projects_goal_recent_idx ON projects (guild_id, goal_id, updated_at DESC, id DESC);
CREATE INDEX quests_project_recent_idx ON quests (guild_id, project_id, updated_at DESC, id DESC);
CREATE INDEX steps_quest_position_idx ON steps (guild_id, quest_id, position, id);

CREATE FUNCTION guild_runtime.space_contains(
  p_guild_id uuid,
  p_parent_space_id uuid,
  p_child_space_id uuid
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  WITH RECURSIVE lineage AS (
    SELECT id, parent_space_id
      FROM spaces
     WHERE guild_id = p_guild_id AND id = p_child_space_id AND status = 'active'
    UNION ALL
    SELECT parent.id, parent.parent_space_id
      FROM spaces parent
      JOIN lineage child ON child.parent_space_id = parent.id
     WHERE parent.guild_id = p_guild_id AND parent.status = 'active'
  )
  SELECT EXISTS (SELECT 1 FROM lineage WHERE id = p_parent_space_id)
$$;

CREATE FUNCTION guild_runtime.enforce_work_parent_scope() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_space_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    SELECT space_id INTO parent_space_id
      FROM goals WHERE guild_id = NEW.guild_id AND id = NEW.goal_id;
  ELSE
    SELECT space_id INTO parent_space_id
      FROM projects WHERE guild_id = NEW.guild_id AND id = NEW.project_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work parent was not found in this Guild'; END IF;
  IF parent_space_id IS NOT NULL AND (
    NEW.space_id IS NULL
    OR NOT guild_runtime.space_contains(NEW.guild_id, parent_space_id, NEW.space_id)
  ) THEN
    RAISE EXCEPTION 'Child Work cannot broaden its parent Space boundary';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_parent_scope
BEFORE INSERT OR UPDATE OF goal_id, space_id ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_scope();

CREATE TRIGGER quests_parent_scope
BEFORE INSERT OR UPDATE OF project_id, space_id ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_scope();

CREATE FUNCTION guild_runtime.enforce_work_assignee() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  identity_kind text;
  identity_status text;
  membership_status text;
  profile_status text;
BEGIN
  IF NEW.assignee_identity_id IS NULL THEN RETURN NEW; END IF;
  SELECT i.kind, i.status, m.state, ap.status
    INTO identity_kind, identity_status, membership_status, profile_status
    FROM identities i
    JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
    LEFT JOIN agent_profiles ap ON ap.guild_id = i.guild_id AND ap.identity_id = i.id
   WHERE i.guild_id = NEW.guild_id AND i.id = NEW.assignee_identity_id;
  IF NOT FOUND OR identity_status <> 'active'
     OR membership_status NOT IN ('preboarding', 'active')
     OR identity_kind NOT IN ('human', 'agent')
     OR (identity_kind = 'agent' AND profile_status <> 'active') THEN
    RAISE EXCEPTION 'Work can be assigned only to an active Human or Agent';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quest_assignee_integrity
BEFORE INSERT OR UPDATE OF assignee_identity_id ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_assignee();

CREATE TRIGGER step_assignee_integrity
BEFORE INSERT OR UPDATE OF assignee_identity_id ON steps
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_assignee();

CREATE FUNCTION guild_runtime.enforce_work_parent_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.creator_identity_id IS DISTINCT FROM NEW.creator_identity_id
     OR (TG_TABLE_NAME = 'projects' AND
         to_jsonb(OLD)->>'goal_id' IS DISTINCT FROM to_jsonb(NEW)->>'goal_id')
     OR (TG_TABLE_NAME = 'quests' AND
         to_jsonb(OLD)->>'project_id' IS DISTINCT FROM to_jsonb(NEW)->>'project_id')
     OR (TG_TABLE_NAME = 'steps' AND
         to_jsonb(OLD)->>'quest_id' IS DISTINCT FROM to_jsonb(NEW)->>'quest_id') THEN
    RAISE EXCEPTION 'Work parent and creator are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_immutable_parent
BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_immutability();
CREATE TRIGGER quests_immutable_parent
BEFORE UPDATE ON quests FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_immutability();
CREATE TRIGGER steps_immutable_parent
BEFORE UPDATE ON steps FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_immutability();

CREATE FUNCTION guild_runtime.enforce_work_status_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed boolean := false;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME = 'goals' THEN
    allowed := (OLD.status = 'draft' AND NEW.status IN ('active', 'cancelled'))
      OR (OLD.status = 'active' AND NEW.status IN ('completed', 'cancelled'))
      OR (OLD.status = 'completed' AND NEW.status = 'active')
      OR (OLD.status = 'cancelled' AND NEW.status = 'draft');
  ELSIF TG_TABLE_NAME = 'projects' THEN
    allowed := (OLD.status = 'planned' AND NEW.status IN ('active', 'cancelled'))
      OR (OLD.status = 'active' AND NEW.status IN ('blocked', 'completed', 'cancelled'))
      OR (OLD.status = 'blocked' AND NEW.status IN ('active', 'cancelled'))
      OR (OLD.status = 'completed' AND NEW.status = 'active')
      OR (OLD.status = 'cancelled' AND NEW.status = 'planned');
  ELSIF TG_TABLE_NAME = 'quests' THEN
    allowed := (OLD.status = 'backlog' AND NEW.status IN ('ready', 'in_progress', 'cancelled'))
      OR (OLD.status = 'ready' AND NEW.status IN ('backlog', 'in_progress', 'cancelled'))
      OR (OLD.status = 'in_progress' AND NEW.status IN ('ready', 'blocked', 'completed', 'cancelled'))
      OR (OLD.status = 'blocked' AND NEW.status IN ('in_progress', 'cancelled'))
      OR (OLD.status = 'completed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'cancelled' AND NEW.status = 'backlog');
  ELSE
    allowed := (OLD.status = 'pending' AND NEW.status IN ('in_progress', 'completed', 'skipped'))
      OR (OLD.status = 'in_progress' AND NEW.status IN ('pending', 'completed', 'skipped'))
      OR (OLD.status = 'completed' AND NEW.status = 'in_progress')
      OR (OLD.status = 'skipped' AND NEW.status = 'pending');
  END IF;
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid % status transition from % to %', TG_TABLE_NAME, OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_status_transition BEFORE UPDATE OF status ON goals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_status_transition();
CREATE TRIGGER projects_status_transition BEFORE UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_status_transition();
CREATE TRIGGER quests_status_transition BEFORE UPDATE OF status ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_status_transition();
CREATE TRIGGER steps_status_transition BEFORE UPDATE OF status ON steps
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_status_transition();

CREATE FUNCTION guild_runtime.enforce_work_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD) - 'version' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(NEW) - 'version' - 'updated_at') THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Work version must increment exactly once';
    END IF;
  ELSIF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Work version cannot change without a material update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_version_integrity BEFORE UPDATE ON goals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_version();
CREATE TRIGGER projects_version_integrity BEFORE UPDATE ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_version();
CREATE TRIGGER quests_version_integrity BEFORE UPDATE ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_version();
CREATE TRIGGER steps_version_integrity BEFORE UPDATE ON steps
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_version();
