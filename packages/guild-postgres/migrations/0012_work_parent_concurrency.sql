CREATE FUNCTION guild_runtime.enforce_work_parent_accepts_child() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_status text;
BEGIN
  IF TG_TABLE_NAME = 'projects' THEN
    SELECT status INTO parent_status
      FROM goals
     WHERE guild_id = NEW.guild_id AND id = NEW.goal_id
     FOR UPDATE;
  ELSIF TG_TABLE_NAME = 'quests' THEN
    SELECT status INTO parent_status
      FROM projects
     WHERE guild_id = NEW.guild_id AND id = NEW.project_id
     FOR UPDATE;
  ELSE
    SELECT status INTO parent_status
      FROM quests
     WHERE guild_id = NEW.guild_id AND id = NEW.quest_id
     FOR UPDATE;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Work parent was not found in this Guild'; END IF;
  IF parent_status IN ('completed', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal Work cannot accept or reactivate child Work';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER projects_parent_accepts_child
BEFORE INSERT OR UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_accepts_child();

CREATE TRIGGER quests_parent_accepts_child
BEFORE INSERT OR UPDATE OF status ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_accepts_child();

CREATE TRIGGER steps_parent_accepts_child
BEFORE INSERT OR UPDATE OF status ON steps
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_parent_accepts_child();

CREATE FUNCTION guild_runtime.enforce_work_terminal_children() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  unfinished_exists boolean := false;
BEGIN
  IF OLD.status = NEW.status OR NEW.status NOT IN ('completed', 'cancelled') THEN
    RETURN NEW;
  END IF;
  IF TG_TABLE_NAME = 'goals' THEN
    SELECT EXISTS (
      SELECT 1 FROM projects
       WHERE guild_id = NEW.guild_id AND goal_id = NEW.id
         AND status NOT IN ('completed', 'cancelled')
    ) INTO unfinished_exists;
  ELSIF TG_TABLE_NAME = 'projects' THEN
    SELECT EXISTS (
      SELECT 1 FROM quests
       WHERE guild_id = NEW.guild_id AND project_id = NEW.id
         AND status NOT IN ('completed', 'cancelled')
    ) INTO unfinished_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM steps
       WHERE guild_id = NEW.guild_id AND quest_id = NEW.id
         AND status NOT IN ('completed', 'skipped')
    ) INTO unfinished_exists;
  END IF;
  IF unfinished_exists THEN
    RAISE EXCEPTION 'Terminal Work requires every child Work item to be terminal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER goals_terminal_children
BEFORE UPDATE OF status ON goals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_terminal_children();

CREATE TRIGGER projects_terminal_children
BEFORE UPDATE OF status ON projects
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_terminal_children();

CREATE TRIGGER quests_terminal_children
BEFORE UPDATE OF status ON quests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_work_terminal_children();
