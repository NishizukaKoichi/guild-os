ALTER TABLE knowledge_version_files
  DROP CONSTRAINT knowledge_version_files_guild_id_file_id_key;

CREATE INDEX knowledge_file_lookup_idx
  ON knowledge_version_files (guild_id, file_id, knowledge_id);

CREATE OR REPLACE FUNCTION guild_runtime.enforce_knowledge_file_boundary() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_knowledge_id uuid;
  target_version integer;
  version_state text;
  knowledge_row knowledge%ROWTYPE;
  file_row files%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    target_guild_id := OLD.guild_id;
    target_knowledge_id := OLD.knowledge_id;
    target_version := OLD.knowledge_version;
  ELSE
    target_guild_id := NEW.guild_id;
    target_knowledge_id := NEW.knowledge_id;
    target_version := NEW.knowledge_version;
  END IF;
  SELECT state INTO version_state
    FROM knowledge_versions
   WHERE guild_id = target_guild_id
     AND knowledge_id = target_knowledge_id
     AND version = target_version;
  IF version_state <> 'draft' THEN
    RAISE EXCEPTION 'Files can be changed only on a draft Knowledge version';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;

  IF EXISTS (
    SELECT 1 FROM knowledge_version_files
     WHERE guild_id = NEW.guild_id AND file_id = NEW.file_id
       AND knowledge_id <> NEW.knowledge_id
  ) THEN
    RAISE EXCEPTION 'A file cannot cross Knowledge records';
  END IF;

  SELECT * INTO knowledge_row
    FROM knowledge
   WHERE guild_id = NEW.guild_id AND id = NEW.knowledge_id;
  SELECT * INTO file_row
    FROM files
   WHERE guild_id = NEW.guild_id AND id = NEW.file_id;
  IF file_row.space_id IS DISTINCT FROM knowledge_row.space_id
     OR file_row.visibility <> knowledge_row.visibility
     OR file_row.classification <> knowledge_row.classification
     OR file_row.allowed_identity_ids <> knowledge_row.allowed_identity_ids THEN
    RAISE EXCEPTION 'Knowledge file security boundary must match its Knowledge record';
  END IF;
  RETURN NEW;
END;
$$;
