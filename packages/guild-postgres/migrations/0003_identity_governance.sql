ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_no_break_glass
  CHECK (permission <> 'break-glass.use');

ALTER TABLE agent_profiles
  ADD CONSTRAINT agent_profiles_instructions_valid
    CHECK (length(btrim(instructions)) BETWEEN 1 AND 20000 AND instructions = btrim(instructions)),
  ADD CONSTRAINT agent_profiles_model_valid
    CHECK (length(btrim(model)) BETWEEN 1 AND 200 AND model = btrim(model)),
  ADD CONSTRAINT agent_profiles_tool_count_valid
    CHECK (cardinality(tool_ids) <= 50 AND array_position(tool_ids, NULL) IS NULL),
  ADD CONSTRAINT agent_profiles_limits_valid
    CHECK (
      jsonb_typeof(limits) = 'object'
      AND jsonb_typeof(limits -> 'currency') = 'string'
      AND (limits ->> 'currency') ~ '^[A-Z]{3}$'
      AND jsonb_typeof(limits -> 'maxBudgetMinor') = 'number'
      AND (limits ->> 'maxBudgetMinor') ~ '^[0-9]+$'
      AND (limits ->> 'maxBudgetMinor')::numeric <= 9007199254740991
      AND jsonb_typeof(limits -> 'maxDurationSeconds') = 'number'
      AND (limits ->> 'maxDurationSeconds') ~ '^[1-9][0-9]*$'
      AND (limits ->> 'maxDurationSeconds')::numeric <= 9007199254740991
      AND jsonb_typeof(limits -> 'maxSteps') = 'number'
      AND (limits ->> 'maxSteps') ~ '^[1-9][0-9]*$'
      AND (limits ->> 'maxSteps')::numeric <= 9007199254740991
      AND jsonb_typeof(limits -> 'maxRetries') = 'number'
      AND (limits ->> 'maxRetries') ~ '^[0-9]+$'
      AND (limits ->> 'maxRetries')::numeric <= 9007199254740991
      AND jsonb_typeof(limits -> 'maxDelegationDepth') = 'number'
      AND (limits ->> 'maxDelegationDepth') ~ '^[0-9]+$'
      AND (limits ->> 'maxDelegationDepth')::numeric <= 9007199254740991
    );

CREATE UNIQUE INDEX spaces_one_root_per_guild_idx
  ON spaces (guild_id) WHERE parent_space_id IS NULL;

CREATE FUNCTION guild_runtime.permission_is_human_only(candidate text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT candidate IN (
    'guild.manage', 'constitution.update', 'space.manage', 'identity.manage',
    'membership.manage', 'role.manage', 'agent.manage', 'agent.approve',
    'agent.stop', 'integration.manage', 'break-glass.use'
  )
$$;

CREATE FUNCTION guild_runtime.enforce_machine_role_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM identities i
      JOIN role_permissions rp
        ON rp.guild_id = NEW.guild_id AND rp.role_id = NEW.role_id
     WHERE i.guild_id = NEW.guild_id
       AND i.id = NEW.identity_id
       AND i.kind <> 'human'
       AND guild_runtime.permission_is_human_only(rp.permission)
  ) THEN
    RAISE EXCEPTION 'Agent and Service identities cannot receive human-only permissions';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM identities i
      JOIN memberships m
        ON m.guild_id = i.guild_id AND m.identity_id = i.id
     WHERE i.guild_id = NEW.guild_id
       AND i.id = NEW.identity_id
       AND i.status = 'active'
       AND m.state IN ('preboarding', 'active')
  ) THEN
    RAISE EXCEPTION 'Role bindings require an enabled Identity with usable membership';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER role_binding_machine_boundary
BEFORE INSERT OR UPDATE OF guild_id, identity_id, role_id ON role_bindings
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_machine_role_boundary();

CREATE FUNCTION guild_runtime.enforce_role_permission_machine_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF guild_runtime.permission_is_human_only(NEW.permission) AND EXISTS (
    SELECT 1
      FROM role_bindings rb
      JOIN identities i ON i.guild_id = rb.guild_id AND i.id = rb.identity_id
     WHERE rb.guild_id = NEW.guild_id
       AND rb.role_id = NEW.role_id
       AND i.kind <> 'human'
  ) THEN
    RAISE EXCEPTION 'A Role assigned to an Agent or Service cannot gain human-only permissions';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER role_permission_machine_boundary
BEFORE INSERT OR UPDATE OF guild_id, role_id, permission ON role_permissions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_role_permission_machine_boundary();

CREATE FUNCTION guild_runtime.enforce_nonempty_role_permissions() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  old_guild_id uuid;
  old_role_id uuid;
  new_guild_id uuid;
  new_role_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'roles' THEN
    new_guild_id := NEW.guild_id;
    new_role_id := NEW.id;
  ELSE
    IF TG_OP <> 'INSERT' THEN
      old_guild_id := OLD.guild_id;
      old_role_id := OLD.role_id;
    END IF;
    IF TG_OP <> 'DELETE' THEN
      new_guild_id := NEW.guild_id;
      new_role_id := NEW.role_id;
    END IF;
  END IF;

  IF old_role_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM roles WHERE guild_id = old_guild_id AND id = old_role_id)
     AND NOT EXISTS (
       SELECT 1 FROM role_permissions WHERE guild_id = old_guild_id AND role_id = old_role_id
     ) THEN
    RAISE EXCEPTION 'A Role requires at least one permission';
  END IF;

  IF new_role_id IS NOT NULL
     AND EXISTS (SELECT 1 FROM roles WHERE guild_id = new_guild_id AND id = new_role_id)
     AND NOT EXISTS (
       SELECT 1 FROM role_permissions WHERE guild_id = new_guild_id AND role_id = new_role_id
     ) THEN
    RAISE EXCEPTION 'A Role requires at least one permission';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER role_requires_permissions
AFTER INSERT OR UPDATE ON roles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_nonempty_role_permissions();

CREATE CONSTRAINT TRIGGER role_permission_set_nonempty
AFTER INSERT OR UPDATE OR DELETE ON role_permissions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_nonempty_role_permissions();

CREATE FUNCTION guild_runtime.enforce_space_hierarchy() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.parent_space_id = NEW.id THEN
    RAISE EXCEPTION 'A Space cannot be its own parent';
  END IF;

  IF NEW.status = 'active' AND NEW.parent_space_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM spaces
     WHERE guild_id = NEW.guild_id AND id = NEW.parent_space_id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'An active Space requires an active parent';
  END IF;

  IF NEW.status = 'archived' AND EXISTS (
    SELECT 1 FROM spaces
     WHERE guild_id = NEW.guild_id AND parent_space_id = NEW.id AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'A Space with active children cannot be archived';
  END IF;

  IF NEW.parent_space_id IS NOT NULL AND EXISTS (
    WITH RECURSIVE ancestors AS (
      SELECT s.id, s.parent_space_id, ARRAY[s.id] AS visited
        FROM spaces s
       WHERE s.guild_id = NEW.guild_id AND s.id = NEW.parent_space_id
      UNION ALL
      SELECT s.id, s.parent_space_id, ancestors.visited || s.id
        FROM spaces s
        JOIN ancestors ON s.id = ancestors.parent_space_id
       WHERE s.guild_id = NEW.guild_id AND NOT s.id = ANY(ancestors.visited)
    )
    SELECT 1 FROM ancestors WHERE id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Space hierarchy cannot contain a cycle';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER space_hierarchy_integrity
BEFORE INSERT OR UPDATE OF guild_id, parent_space_id, status ON spaces
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_space_hierarchy();

CREATE FUNCTION guild_runtime.enforce_identity_kind_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> OLD.kind THEN
    RAISE EXCEPTION 'Identity kind is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER identity_kind_immutable
BEFORE UPDATE OF kind ON identities
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_identity_kind_immutable();

CREATE FUNCTION guild_runtime.enforce_agent_profile_identity() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM identities
     WHERE guild_id = NEW.guild_id AND id = NEW.identity_id AND kind = 'agent'
  ) THEN
    RAISE EXCEPTION 'Agent profiles require an Agent Identity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_profile_identity_kind
BEFORE INSERT OR UPDATE OF guild_id, identity_id ON agent_profiles
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_profile_identity();
