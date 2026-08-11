-- Constitution updates are Root-only authority. Existing delegated grants are converted to read
-- access before the stricter constraint is installed so upgrades cannot leave an empty Role.
INSERT INTO role_permissions (guild_id, role_id, permission)
SELECT root_permission.guild_id, root_permission.role_id, 'constitution.read'
  FROM role_permissions root_permission
 WHERE root_permission.permission = 'constitution.update'
   AND NOT EXISTS (
     SELECT 1 FROM role_permissions sibling
      WHERE sibling.guild_id = root_permission.guild_id
        AND sibling.role_id = root_permission.role_id
        AND sibling.permission <> 'constitution.update'
   )
ON CONFLICT DO NOTHING;

DELETE FROM role_permissions WHERE permission = 'constitution.update';

ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_no_break_glass;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_no_root_authority
  CHECK (permission NOT IN ('constitution.update', 'break-glass.use'));

ALTER TABLE constitutions
  ADD CONSTRAINT constitution_quorum_order
    CHECK (level3_approval_quorum >= level2_approval_quorum),
  ADD CONSTRAINT constitution_quorum_bounds
    CHECK (level2_approval_quorum <= 100 AND level3_approval_quorum <= 100),
  ADD CONSTRAINT constitution_retention_bounds
    CHECK (data_retention_days <= 36500),
  ADD CONSTRAINT constitution_agent_defaults_valid
    CHECK (
      jsonb_typeof(agent_defaults) = 'object'
      AND jsonb_typeof(agent_defaults -> 'currency') = 'string'
      AND (agent_defaults ->> 'currency') ~ '^[A-Z]{3}$'
      AND jsonb_typeof(agent_defaults -> 'maxBudgetMinor') = 'number'
      AND (agent_defaults ->> 'maxBudgetMinor') ~ '^[0-9]+$'
      AND (agent_defaults ->> 'maxBudgetMinor')::numeric <= 9007199254740991
      AND jsonb_typeof(agent_defaults -> 'maxDurationSeconds') = 'number'
      AND (agent_defaults ->> 'maxDurationSeconds') ~ '^[1-9][0-9]*$'
      AND (agent_defaults ->> 'maxDurationSeconds')::numeric <= 9007199254740991
      AND jsonb_typeof(agent_defaults -> 'maxSteps') = 'number'
      AND (agent_defaults ->> 'maxSteps') ~ '^[1-9][0-9]*$'
      AND (agent_defaults ->> 'maxSteps')::numeric <= 9007199254740991
      AND jsonb_typeof(agent_defaults -> 'maxRetries') = 'number'
      AND (agent_defaults ->> 'maxRetries') ~ '^[0-9]+$'
      AND (agent_defaults ->> 'maxRetries')::numeric <= 9007199254740991
      AND jsonb_typeof(agent_defaults -> 'maxDelegationDepth') = 'number'
      AND (agent_defaults ->> 'maxDelegationDepth') ~ '^[0-9]+$'
      AND (agent_defaults ->> 'maxDelegationDepth')::numeric <= 9007199254740991
    );

CREATE FUNCTION guild_runtime.enforce_constitution_governance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  root_owner_id uuid;
  actor_identity_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'A Guild Constitution cannot be deleted';
  END IF;

  SELECT g.root_owner_identity_id INTO root_owner_id
    FROM guilds g
    JOIN identities i
      ON i.guild_id = g.id AND i.id = g.root_owner_identity_id
    JOIN memberships m
      ON m.guild_id = i.guild_id AND m.identity_id = i.id
   WHERE g.id = NEW.guild_id
     AND i.kind = 'human'
     AND i.status = 'active'
     AND m.state = 'active';

  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;

  IF root_owner_id IS NULL OR actor_identity_id IS NULL
     OR actor_identity_id <> root_owner_id
     OR NEW.updated_by_identity_id <> root_owner_id THEN
    RAISE EXCEPTION 'Only the active human Root Owner can update the Constitution';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.guild_id <> OLD.guild_id THEN
      RAISE EXCEPTION 'Constitution Guild is immutable';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Constitution version must increment exactly once';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER constitution_governance
BEFORE INSERT OR UPDATE ON constitutions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_constitution_governance();

CREATE TRIGGER constitution_no_delete
BEFORE DELETE ON constitutions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_constitution_governance();
