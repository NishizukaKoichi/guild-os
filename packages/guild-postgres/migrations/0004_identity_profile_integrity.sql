CREATE FUNCTION guild_runtime.enforce_agent_tool_ids() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM unnest(NEW.tool_ids) AS tool_id
     WHERE length(btrim(tool_id)) NOT BETWEEN 1 AND 200 OR tool_id <> btrim(tool_id)
  ) OR cardinality(NEW.tool_ids) <> (
    SELECT count(DISTINCT tool_id) FROM unnest(NEW.tool_ids) AS tool_id
  ) THEN
    RAISE EXCEPTION 'Agent tool IDs must be unique, unpadded, and between 1 and 200 characters';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_tool_ids_valid
BEFORE INSERT OR UPDATE OF tool_ids ON agent_profiles
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_tool_ids();

CREATE FUNCTION guild_runtime.enforce_identity_membership_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_identity_id uuid;
  identity_status text;
  membership_state text;
BEGIN
  target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  target_identity_id := CASE
    WHEN TG_TABLE_NAME = 'identities' THEN CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    ELSE CASE WHEN TG_OP = 'DELETE' THEN OLD.identity_id ELSE NEW.identity_id END
  END;

  SELECT i.status, m.state
    INTO identity_status, membership_state
    FROM identities i
    LEFT JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
   WHERE i.guild_id = target_guild_id AND i.id = target_identity_id;

  IF identity_status IS NOT NULL AND (
    membership_state IS NULL
    OR identity_status = 'active' AND membership_state NOT IN ('preboarding', 'active')
    OR identity_status = 'disabled' AND membership_state NOT IN ('invited', 'suspended', 'departed')
  ) THEN
    RAISE EXCEPTION 'Identity status and Membership state are inconsistent';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER identity_membership_pair
AFTER INSERT OR UPDATE OR DELETE ON identities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_identity_membership_pair();

CREATE CONSTRAINT TRIGGER membership_identity_pair
AFTER INSERT OR UPDATE OR DELETE ON memberships
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_identity_membership_pair();

CREATE FUNCTION guild_runtime.enforce_agent_identity_profile_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_identity_id uuid;
  identity_kind text;
  identity_status text;
  profile_status text;
BEGIN
  target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  target_identity_id := CASE
    WHEN TG_TABLE_NAME = 'identities' THEN CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END
    ELSE CASE WHEN TG_OP = 'DELETE' THEN OLD.identity_id ELSE NEW.identity_id END
  END;

  SELECT kind, status INTO identity_kind, identity_status
    FROM identities
   WHERE guild_id = target_guild_id AND id = target_identity_id;
  SELECT status INTO profile_status
    FROM agent_profiles
   WHERE guild_id = target_guild_id AND identity_id = target_identity_id;

  IF identity_kind = 'agent' AND profile_status IS NULL THEN
    RAISE EXCEPTION 'An Agent Identity requires an Agent profile';
  END IF;
  IF profile_status IS NOT NULL AND identity_kind IS DISTINCT FROM 'agent' THEN
    RAISE EXCEPTION 'An Agent profile requires an Agent Identity';
  END IF;
  IF identity_kind = 'agent' AND identity_status = 'disabled' AND profile_status <> 'stopped' THEN
    RAISE EXCEPTION 'A disabled Agent Identity requires a stopped Agent profile';
  END IF;

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER identity_agent_profile_pair
AFTER INSERT OR UPDATE OR DELETE ON identities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_identity_profile_pair();

CREATE CONSTRAINT TRIGGER agent_profile_identity_pair
AFTER INSERT OR UPDATE OR DELETE ON agent_profiles
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_identity_profile_pair();
