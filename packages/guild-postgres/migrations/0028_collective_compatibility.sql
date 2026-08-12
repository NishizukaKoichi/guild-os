-- Keep the v1 Identity/Knowledge/Work API operational while new code moves to
-- Actor/Memory/Activity. Compatibility is intentionally one-way for shapes that
-- cannot be represented by the fixed legacy hierarchy.

-- The final compatibility audit must observe every Guild. RLS remains enabled while FORCE is
-- temporarily relaxed for the migration-owning role and is restored before commit.
ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memories NO FORCE ROW LEVEL SECURITY;
ALTER TABLE goals NO FORCE ROW LEVEL SECURITY;
ALTER TABLE projects NO FORCE ROW LEVEL SECURITY;
ALTER TABLE quests NO FORCE ROW LEVEL SECURITY;
ALTER TABLE steps NO FORCE ROW LEVEL SECURITY;
ALTER TABLE activities NO FORCE ROW LEVEL SECURITY;

CREATE FUNCTION guild_runtime.sync_identity_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE actors SET status = 'disabled' WHERE id = OLD.id;
    RETURN OLD;
  END IF;

  INSERT INTO actors (
    id, home_guild_id, kind, display_name, status, access_subject,
    verified_email, preferred_locale, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NEW.kind, NEW.display_name, NEW.status,
    NEW.access_subject, NEW.verified_email, NEW.preferred_locale,
    NEW.created_at, NEW.updated_at
  )
  ON CONFLICT (id) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    status = EXCLUDED.status,
    access_subject = EXCLUDED.access_subject,
    verified_email = EXCLUDED.verified_email,
    preferred_locale = EXCLUDED.preferred_locale,
    updated_at = EXCLUDED.updated_at;

  INSERT INTO identity_actor_links (guild_id, identity_id, actor_id, created_at)
  VALUES (NEW.guild_id, NEW.id, NEW.id, NEW.created_at)
  ON CONFLICT (guild_id, identity_id) DO NOTHING;

  IF NEW.kind = 'human' THEN
    INSERT INTO human_profiles (actor_id) VALUES (NEW.id)
    ON CONFLICT (actor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_actor_compatibility
AFTER INSERT OR UPDATE ON identities
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_identity_actor();

CREATE FUNCTION guild_runtime.sync_membership_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  actor_kind text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE actor_memberships
       SET state = 'left', operational = false,
           left_at = COALESCE(left_at, now()), updated_at = now()
     WHERE guild_id = OLD.guild_id AND actor_id = OLD.identity_id;
    RETURN OLD;
  END IF;

  INSERT INTO actor_memberships (
    guild_id, actor_id, state, clearance, operational, joined_at, left_at, updated_at
  ) VALUES (
    NEW.guild_id, NEW.identity_id,
    CASE NEW.state
      WHEN 'preboarding' THEN 'joined'
      WHEN 'suspended' THEN 'paused'
      WHEN 'departed' THEN 'left'
      ELSE NEW.state
    END,
    NEW.clearance,
    NEW.state NOT IN ('suspended', 'departed'),
    NEW.joined_at, NEW.departed_at, NEW.updated_at
  )
  ON CONFLICT (guild_id, actor_id) DO UPDATE SET
    state = EXCLUDED.state,
    clearance = EXCLUDED.clearance,
    operational = EXCLUDED.operational,
    joined_at = EXCLUDED.joined_at,
    left_at = EXCLUDED.left_at,
    updated_at = EXCLUDED.updated_at;

  SELECT kind INTO actor_kind FROM actors WHERE id = NEW.identity_id;
  IF actor_kind = 'service' THEN
    INSERT INTO service_profiles (guild_id, actor_id)
    VALUES (NEW.guild_id, NEW.identity_id)
    ON CONFLICT (guild_id, actor_id) DO NOTHING;
  ELSIF actor_kind = 'guild' THEN
    INSERT INTO guild_actor_profiles (guild_id, actor_id)
    VALUES (NEW.guild_id, NEW.identity_id)
    ON CONFLICT (guild_id, actor_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_actor_compatibility
AFTER INSERT OR UPDATE OR DELETE ON memberships
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_membership_actor();

CREATE FUNCTION guild_runtime.sync_role_binding_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM actor_role_bindings
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO actor_role_bindings (id, guild_id, actor_id, role_id, space_id, created_at)
  VALUES (NEW.id, NEW.guild_id, NEW.identity_id, NEW.role_id, NEW.space_id, NEW.created_at)
  ON CONFLICT (id) DO UPDATE SET
    actor_id = EXCLUDED.actor_id,
    role_id = EXCLUDED.role_id,
    space_id = EXCLUDED.space_id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_binding_actor_compatibility
AFTER INSERT OR UPDATE OR DELETE ON role_bindings
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_role_binding_actor();

CREATE FUNCTION guild_runtime.sync_agent_profile_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM actor_agent_profiles
     WHERE guild_id = OLD.guild_id AND actor_id = OLD.identity_id;
    RETURN OLD;
  END IF;
  INSERT INTO actor_agent_profiles (
    guild_id, actor_id, instructions, model, tool_ids, limits, status, updated_at
  ) VALUES (
    NEW.guild_id, NEW.identity_id, NEW.instructions, NEW.model,
    NEW.tool_ids, NEW.limits, NEW.status, NEW.updated_at
  ) ON CONFLICT (guild_id, actor_id) DO UPDATE SET
    instructions = EXCLUDED.instructions,
    model = EXCLUDED.model,
    tool_ids = EXCLUDED.tool_ids,
    limits = EXCLUDED.limits,
    status = EXCLUDED.status,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_profile_actor_compatibility
AFTER INSERT OR UPDATE OR DELETE ON agent_profiles
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_agent_profile_actor();

CREATE FUNCTION guild_runtime.sync_file_actor_boundary()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_actor_id IS DISTINCT FROM NEW.owner_identity_id
     OR NEW.allowed_actor_ids IS DISTINCT FROM NEW.allowed_identity_ids THEN
    NEW.owner_actor_id := NEW.owner_identity_id;
    NEW.allowed_actor_ids := NEW.allowed_identity_ids;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_actor_boundary_compatibility
BEFORE INSERT OR UPDATE OF owner_identity_id, allowed_identity_ids,
  owner_actor_id, allowed_actor_ids ON files
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_file_actor_boundary();

CREATE FUNCTION guild_runtime.sync_knowledge_memory()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  creator_actor_id uuid;
  current_sources uuid[];
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE memories
       SET status = 'archived', governance_state = 'archived', updated_at = now()
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;

  SELECT created_by_identity_id INTO creator_actor_id
    FROM knowledge_versions
   WHERE guild_id = NEW.guild_id AND knowledge_id = NEW.id AND version = 1;
  SELECT source_ids INTO current_sources
    FROM knowledge_versions
   WHERE guild_id = NEW.guild_id AND knowledge_id = NEW.id
     AND version = NEW.current_version;

  INSERT INTO memories (
    id, guild_id, space_id, owner_actor_id, creator_actor_id, type, status,
    workflow, governance_state, visibility, classification, allowed_actor_ids,
    current_version, canonical_version, source_ids, review_due_at,
    legacy_source_type, legacy_source_id, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NEW.space_id, NEW.owner_identity_id,
    COALESCE(creator_actor_id, NEW.owner_identity_id), 'knowledge',
    CASE WHEN NEW.state = 'archived' THEN 'archived' ELSE 'active' END,
    'canonical', NEW.state, NEW.visibility, NEW.classification,
    NEW.allowed_identity_ids, NEW.current_version, NEW.canonical_version,
    COALESCE(current_sources, '{}'::uuid[]), NEW.review_due_at,
    'knowledge', NEW.id, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    space_id = EXCLUDED.space_id,
    owner_actor_id = EXCLUDED.owner_actor_id,
    status = EXCLUDED.status,
    governance_state = EXCLUDED.governance_state,
    visibility = EXCLUDED.visibility,
    classification = EXCLUDED.classification,
    allowed_actor_ids = EXCLUDED.allowed_actor_ids,
    current_version = EXCLUDED.current_version,
    canonical_version = EXCLUDED.canonical_version,
    source_ids = EXCLUDED.source_ids,
    review_due_at = EXCLUDED.review_due_at,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_memory_compatibility
AFTER INSERT OR UPDATE OR DELETE ON knowledge
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_knowledge_memory();

CREATE FUNCTION guild_runtime.sync_knowledge_version_memory()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO memory_versions (
      guild_id, memory_id, version, title, summary, body, source_ids,
      change_note, created_by_actor_id, created_at
    ) VALUES (
      NEW.guild_id, NEW.knowledge_id, NEW.version, NEW.title, NEW.summary,
      NEW.body, NEW.source_ids, NEW.change_note, NEW.created_by_identity_id,
      NEW.created_at
    ) ON CONFLICT (guild_id, memory_id, version) DO NOTHING;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE TRIGGER knowledge_version_memory_compatibility
AFTER INSERT OR UPDATE OR DELETE ON knowledge_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_knowledge_version_memory();

CREATE FUNCTION guild_runtime.sync_knowledge_file_memory()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    DELETE FROM memory_version_files
     WHERE guild_id = OLD.guild_id
       AND memory_id = OLD.knowledge_id
       AND memory_version = OLD.knowledge_version
       AND file_id = OLD.file_id;
    RETURN OLD;
  END IF;
  INSERT INTO memory_version_files (
    guild_id, memory_id, memory_version, file_id, position, created_at
  ) VALUES (
    NEW.guild_id, NEW.knowledge_id, NEW.knowledge_version,
    NEW.file_id, NEW.position, NEW.created_at
  ) ON CONFLICT (guild_id, memory_id, memory_version, file_id)
    DO UPDATE SET position = EXCLUDED.position;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_file_memory_compatibility
AFTER INSERT OR UPDATE OR DELETE ON knowledge_version_files
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_knowledge_file_memory();

CREATE FUNCTION guild_runtime.sync_goal_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE activities SET status = 'archived', updated_at = now()
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO activities (
    id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
    assignee_actor_id, type, title, description, status, visibility, classification,
    allowed_actor_ids, source_ids, due_at, position, version,
    legacy_source_type, legacy_source_id, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NULL, NEW.space_id, NEW.owner_identity_id,
    NEW.creator_identity_id, NULL, 'goal', NEW.title, NEW.description,
    CASE NEW.status WHEN 'draft' THEN 'proposed' ELSE NEW.status END,
    NEW.visibility, NEW.classification, NEW.allowed_identity_ids, NEW.source_ids,
    NEW.target_at, 0, NEW.version, 'goal', NEW.id, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    space_id = EXCLUDED.space_id, owner_actor_id = EXCLUDED.owner_actor_id,
    title = EXCLUDED.title, description = EXCLUDED.description,
    status = EXCLUDED.status, visibility = EXCLUDED.visibility,
    classification = EXCLUDED.classification,
    allowed_actor_ids = EXCLUDED.allowed_actor_ids, source_ids = EXCLUDED.source_ids,
    due_at = EXCLUDED.due_at, version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goal_activity_compatibility
AFTER INSERT OR UPDATE OR DELETE ON goals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_goal_activity();

CREATE FUNCTION guild_runtime.sync_project_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE activities SET status = 'archived', updated_at = now()
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO activities (
    id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
    assignee_actor_id, type, title, description, status, visibility, classification,
    allowed_actor_ids, source_ids, due_at, position, version,
    legacy_source_type, legacy_source_id, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NEW.goal_id, NEW.space_id, NEW.owner_identity_id,
    NEW.creator_identity_id, NULL, 'project', NEW.title, NEW.description,
    NEW.status, NEW.visibility, NEW.classification, NEW.allowed_identity_ids,
    NEW.source_ids, NEW.due_at, 0, NEW.version, 'project', NEW.id,
    NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    space_id = EXCLUDED.space_id, owner_actor_id = EXCLUDED.owner_actor_id,
    title = EXCLUDED.title, description = EXCLUDED.description,
    status = EXCLUDED.status, visibility = EXCLUDED.visibility,
    classification = EXCLUDED.classification,
    allowed_actor_ids = EXCLUDED.allowed_actor_ids, source_ids = EXCLUDED.source_ids,
    due_at = EXCLUDED.due_at, version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER project_activity_compatibility
AFTER INSERT OR UPDATE OR DELETE ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_project_activity();

CREATE FUNCTION guild_runtime.sync_quest_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE activities SET status = 'archived', updated_at = now()
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  INSERT INTO activities (
    id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
    assignee_actor_id, type, title, description, status, visibility, classification,
    allowed_actor_ids, source_ids, due_at, position, version,
    legacy_source_type, legacy_source_id, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NEW.project_id, NEW.space_id, NEW.owner_identity_id,
    NEW.creator_identity_id, NEW.assignee_identity_id, 'quest', NEW.title,
    NEW.description,
    CASE NEW.status WHEN 'backlog' THEN 'planned' WHEN 'in_progress' THEN 'active'
      ELSE NEW.status END,
    NEW.visibility, NEW.classification, NEW.allowed_identity_ids, NEW.source_ids,
    NEW.due_at, 0, NEW.version, 'quest', NEW.id, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    space_id = EXCLUDED.space_id, owner_actor_id = EXCLUDED.owner_actor_id,
    assignee_actor_id = EXCLUDED.assignee_actor_id, title = EXCLUDED.title,
    description = EXCLUDED.description, status = EXCLUDED.status,
    visibility = EXCLUDED.visibility, classification = EXCLUDED.classification,
    allowed_actor_ids = EXCLUDED.allowed_actor_ids, source_ids = EXCLUDED.source_ids,
    due_at = EXCLUDED.due_at, version = EXCLUDED.version,
    updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quest_activity_compatibility
AFTER INSERT OR UPDATE OR DELETE ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_quest_activity();

CREATE FUNCTION guild_runtime.sync_step_activity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_quest record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE activities SET status = 'archived', updated_at = now()
     WHERE guild_id = OLD.guild_id AND id = OLD.id;
    RETURN OLD;
  END IF;
  SELECT * INTO parent_quest FROM quests
   WHERE guild_id = NEW.guild_id AND id = NEW.quest_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Step compatibility requires its parent Quest'; END IF;
  INSERT INTO activities (
    id, guild_id, parent_activity_id, space_id, owner_actor_id, creator_actor_id,
    assignee_actor_id, type, title, description, status, visibility, classification,
    allowed_actor_ids, source_ids, position, version,
    legacy_source_type, legacy_source_id, created_at, updated_at
  ) VALUES (
    NEW.id, NEW.guild_id, NEW.quest_id, parent_quest.space_id,
    parent_quest.owner_identity_id, NEW.creator_identity_id,
    NEW.assignee_identity_id, 'step', NEW.title, NEW.description,
    CASE NEW.status WHEN 'pending' THEN 'planned' WHEN 'in_progress' THEN 'active'
      WHEN 'skipped' THEN 'cancelled' ELSE NEW.status END,
    parent_quest.visibility, parent_quest.classification,
    parent_quest.allowed_identity_ids, '{}'::uuid[], NEW.position, NEW.version,
    'step', NEW.id, NEW.created_at, NEW.updated_at
  ) ON CONFLICT (id) DO UPDATE SET
    assignee_actor_id = EXCLUDED.assignee_actor_id,
    title = EXCLUDED.title, description = EXCLUDED.description,
    status = EXCLUDED.status, position = EXCLUDED.position,
    version = EXCLUDED.version, updated_at = EXCLUDED.updated_at;
  RETURN NEW;
END;
$$;

CREATE TRIGGER step_activity_compatibility
AFTER INSERT OR UPDATE OR DELETE ON steps
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_step_activity();

CREATE FUNCTION guild_runtime.sync_neutral_permission_alias()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  alias_permission text;
BEGIN
  alias_permission := CASE NEW.permission
    WHEN 'identity.read' THEN 'actor.read'
    WHEN 'identity.manage' THEN 'actor.manage'
    WHEN 'knowledge.read' THEN 'memory.read'
    WHEN 'knowledge.create' THEN 'memory.create'
    WHEN 'knowledge.approve' THEN 'memory.govern'
    WHEN 'work.read' THEN 'activity.read'
    WHEN 'work.create' THEN 'activity.create'
    WHEN 'work.assign' THEN 'activity.assign'
    WHEN 'integration.read' THEN 'connection.read'
    WHEN 'integration.execute' THEN 'connection.execute'
    WHEN 'integration.manage' THEN 'connection.manage'
    WHEN 'agent.read' THEN 'run.read'
    WHEN 'agent.run' THEN 'run.create'
    WHEN 'agent.approve' THEN 'run.approve'
    WHEN 'agent.stop' THEN 'run.stop'
    WHEN 'chronicle.read' THEN 'event.read'
    WHEN 'guild.read' THEN 'template.read'
    ELSE NULL
  END;
  IF alias_permission IS NOT NULL THEN
    INSERT INTO role_permissions (guild_id, role_id, permission)
    VALUES (NEW.guild_id, NEW.role_id, alias_permission)
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER neutral_permission_alias_compatibility
AFTER INSERT ON role_permissions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.sync_neutral_permission_alias();

ALTER TABLE conversations DROP CONSTRAINT conversations_subject_type_check;
ALTER TABLE conversations
  ADD CONSTRAINT conversations_subject_type_check CHECK (
    subject_type IN (
      'memory', 'activity', 'knowledge', 'goal', 'project', 'quest', 'step',
      'decision', 'announcement', 'agent_run'
    )
  );

CREATE OR REPLACE FUNCTION guild_runtime.conversation_subject(
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
      SELECT m.space_id, m.owner_actor_id AS owner_identity_id, m.visibility,
             m.classification, m.allowed_actor_ids AS allowed_identity_ids,
             'memory.read'::text AS read_permission
        FROM memories m
       WHERE target_subject_type = 'memory'
         AND m.guild_id = target_guild_id AND m.id = target_subject_id
      UNION ALL
      SELECT a.space_id, a.owner_actor_id, a.visibility, a.classification,
             a.allowed_actor_ids, 'activity.read'::text
        FROM activities a
       WHERE target_subject_type = 'activity'
         AND a.guild_id = target_guild_id AND a.id = target_subject_id
      UNION ALL
      SELECT k.space_id, k.owner_identity_id, k.visibility, k.classification,
             k.allowed_identity_ids, 'knowledge.read'::text
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
        FROM steps s JOIN quests q
          ON q.guild_id = s.guild_id AND q.id = s.quest_id
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

CREATE OR REPLACE FUNCTION guild_runtime.identity_can_access_conversation_subject(
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
         EXISTS (SELECT 1 FROM granted_permissions WHERE permission = conversation_permission)
         AND EXISTS (SELECT 1 FROM granted_permissions WHERE permission = subject.read_permission)
         AND (
           actor.state = 'active'
           OR (
             conversation_permission IN ('conversation.read', 'conversation.create')
             AND subject.read_permission IN (
               'memory.read', 'activity.read', 'knowledge.read',
               'work.read', 'announcement.read'
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

CREATE VIEW connections AS
SELECT id, guild_id, space_id, owner_identity_id AS owner_actor_id,
       name, kind, status, capability_permissions, endpoint_url,
       created_at, updated_at
  FROM connectors;

CREATE VIEW runs AS
SELECT id, guild_id, agent_identity_id AS agent_actor_id,
       requester_identity_id AS requester_actor_id, activity_id,
       risk_level, status, limits, usage, plan, result, error_message,
       workflow_instance_id, kill_requested_at, estimated_budget_minor,
       started_at, finished_at, created_at, updated_at
  FROM agent_runs;

CREATE VIEW events AS
SELECT sequence, id, guild_id, actor_identity_id AS actor_id, action,
       subject_type, subject_id, correlation_id, details, occurred_at
  FROM chronicle_events;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM identities identity
    LEFT JOIN identity_actor_links link
      ON link.guild_id = identity.guild_id AND link.identity_id = identity.id
    LEFT JOIN actors actor ON actor.id = link.actor_id
    WHERE link.actor_id IS NULL OR actor.id IS NULL OR actor.kind <> identity.kind
  ) THEN
    RAISE EXCEPTION 'Identity compatibility coverage is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM knowledge legacy
    LEFT JOIN memories memory
      ON memory.guild_id = legacy.guild_id AND memory.id = legacy.id
    WHERE memory.id IS NULL OR memory.legacy_source_type <> 'knowledge'
  ) THEN
    RAISE EXCEPTION 'Knowledge compatibility coverage is incomplete';
  END IF;
  IF EXISTS (
    SELECT 1 FROM (
      SELECT guild_id, id, 'goal'::text AS source_type FROM goals
      UNION ALL SELECT guild_id, id, 'project' FROM projects
      UNION ALL SELECT guild_id, id, 'quest' FROM quests
      UNION ALL SELECT guild_id, id, 'step' FROM steps
    ) legacy
    LEFT JOIN activities activity
      ON activity.guild_id = legacy.guild_id AND activity.id = legacy.id
    WHERE activity.id IS NULL OR activity.legacy_source_type <> legacy.source_type
  ) THEN
    RAISE EXCEPTION 'Work compatibility coverage is incomplete';
  END IF;
END;
$$;

ALTER TABLE identities FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links FORCE ROW LEVEL SECURITY;
ALTER TABLE actors FORCE ROW LEVEL SECURITY;
ALTER TABLE knowledge FORCE ROW LEVEL SECURITY;
ALTER TABLE memories FORCE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
ALTER TABLE projects FORCE ROW LEVEL SECURITY;
ALTER TABLE quests FORCE ROW LEVEL SECURITY;
ALTER TABLE steps FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
