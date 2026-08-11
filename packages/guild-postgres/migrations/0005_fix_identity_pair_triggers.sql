CREATE OR REPLACE FUNCTION guild_runtime.enforce_identity_membership_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_identity_id uuid;
  identity_status text;
  membership_state text;
BEGIN
  target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  IF TG_TABLE_NAME = 'identities' THEN
    target_identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.identity_id ELSE NEW.identity_id END;
  END IF;

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

CREATE OR REPLACE FUNCTION guild_runtime.enforce_agent_identity_profile_pair() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_identity_id uuid;
  identity_kind text;
  identity_status text;
  profile_status text;
BEGIN
  target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  IF TG_TABLE_NAME = 'identities' THEN
    target_identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_identity_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.identity_id ELSE NEW.identity_id END;
  END IF;

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
