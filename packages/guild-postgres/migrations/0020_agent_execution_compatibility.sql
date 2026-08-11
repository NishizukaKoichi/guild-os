CREATE OR REPLACE FUNCTION guild_runtime.enforce_connector_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  secret_was_cleared_on_revoke boolean :=
    OLD.status <> 'revoked'
    AND NEW.status = 'revoked'
    AND OLD.secret_reference IS NOT NULL
    AND NEW.secret_reference IS NULL;
BEGIN
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id
     OR OLD.name IS DISTINCT FROM NEW.name
     OR OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.capability_permissions IS DISTINCT FROM NEW.capability_permissions
     OR (OLD.secret_reference IS DISTINCT FROM NEW.secret_reference
         AND NOT secret_was_cleared_on_revoke)
     OR OLD.endpoint_url IS DISTINCT FROM NEW.endpoint_url
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
     OR OLD.classification IS DISTINCT FROM NEW.classification
     OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
     OR OLD.deployment_managed IS DISTINCT FROM NEW.deployment_managed THEN
    RAISE EXCEPTION 'Connector configuration is immutable; provision a new Connector';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'A revoked Connector cannot be restored';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Connector status changes require an exact version increment';
  END IF;
  RETURN NEW;
END;
$$;
