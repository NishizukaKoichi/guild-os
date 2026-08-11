CREATE FUNCTION guild_runtime.enforce_published_knowledge_security_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.canonical_version IS NOT NULL AND (
    OLD.space_id IS DISTINCT FROM NEW.space_id
    OR OLD.visibility IS DISTINCT FROM NEW.visibility
    OR OLD.classification IS DISTINCT FROM NEW.classification
    OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
  ) THEN
    RAISE EXCEPTION 'Published Knowledge security boundary is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER published_knowledge_security_lock
BEFORE UPDATE ON knowledge
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_published_knowledge_security_lock();
