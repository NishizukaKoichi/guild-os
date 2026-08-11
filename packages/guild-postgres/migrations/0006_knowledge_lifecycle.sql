CREATE FUNCTION guild_runtime.valid_localized_text(
  value jsonb,
  minimum_length integer,
  maximum_length integer
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN jsonb_typeof(value) <> 'object' OR value = '{}'::jsonb THEN false
    ELSE NOT EXISTS (
      SELECT 1
        FROM jsonb_each(value) AS entry(locale, content)
       WHERE locale NOT IN ('en', 'ja', 'zh-CN')
          OR jsonb_typeof(content) <> 'string'
          OR length(btrim(content #>> '{}')) NOT BETWEEN minimum_length AND maximum_length
    )
  END
$$;

CREATE FUNCTION guild_runtime.knowledge_languages_match(
  title jsonb,
  summary jsonb,
  body jsonb
) RETURNS boolean
LANGUAGE sql IMMUTABLE AS $$
  SELECT (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(title) AS key)
           = (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(summary) AS key)
     AND (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(title) AS key)
           = (SELECT array_agg(key ORDER BY key) FROM jsonb_object_keys(body) AS key)
$$;

ALTER TABLE knowledge_versions
  ADD COLUMN state text,
  ADD COLUMN change_note text NOT NULL DEFAULT ''
    CHECK (length(change_note) <= 2000);

UPDATE knowledge_versions kv
   SET state = k.state
  FROM knowledge k
 WHERE k.guild_id = kv.guild_id AND k.id = kv.knowledge_id;

ALTER TABLE knowledge_versions
  ALTER COLUMN state SET NOT NULL,
  ADD CONSTRAINT knowledge_versions_state_check
    CHECK (state IN ('draft', 'proposed', 'canonical', 'deprecated', 'archived')),
  ADD CONSTRAINT knowledge_versions_title_check
    CHECK (guild_runtime.valid_localized_text(title, 1, 200)),
  ADD CONSTRAINT knowledge_versions_summary_check
    CHECK (guild_runtime.valid_localized_text(summary, 1, 2000)),
  ADD CONSTRAINT knowledge_versions_body_check
    CHECK (guild_runtime.valid_localized_text(body, 1, 200000)),
  ADD CONSTRAINT knowledge_versions_languages_check
    CHECK (guild_runtime.knowledge_languages_match(title, summary, body));

ALTER TABLE knowledge
  ADD COLUMN canonical_version integer,
  ADD COLUMN review_due_at timestamptz;

UPDATE knowledge
   SET canonical_version = current_version
 WHERE state = 'canonical';

ALTER TABLE knowledge
  ADD CONSTRAINT knowledge_current_version_fk
    FOREIGN KEY (guild_id, id, current_version)
    REFERENCES knowledge_versions(guild_id, knowledge_id, version)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT knowledge_canonical_version_fk
    FOREIGN KEY (guild_id, id, canonical_version)
    REFERENCES knowledge_versions(guild_id, knowledge_id, version)
    DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE knowledge_reviews (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  knowledge_id uuid NOT NULL,
  knowledge_version integer NOT NULL,
  reviewer_identity_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('approve', 'request_changes')),
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, knowledge_id, knowledge_version, reviewer_identity_id),
  FOREIGN KEY (guild_id, knowledge_id, knowledge_version)
    REFERENCES knowledge_versions(guild_id, knowledge_id, version),
  FOREIGN KEY (guild_id, reviewer_identity_id)
    REFERENCES identities(guild_id, id)
);

ALTER TABLE files
  ADD COLUMN original_name text,
  ADD COLUMN status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('pending', 'ready', 'failed', 'deleted')),
  ADD COLUMN upload_expires_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE files SET original_name = id::text WHERE original_name IS NULL;

ALTER TABLE files
  ALTER COLUMN original_name SET NOT NULL,
  ADD CONSTRAINT files_original_name_check
    CHECK (length(btrim(original_name)) BETWEEN 1 AND 255),
  ADD CONSTRAINT files_media_type_check
    CHECK (length(btrim(media_type)) BETWEEN 1 AND 200),
  ADD CONSTRAINT files_upload_state_check
    CHECK (
      (status = 'pending' AND upload_expires_at IS NOT NULL)
      OR (status <> 'pending' AND upload_expires_at IS NULL)
    );

CREATE TABLE knowledge_version_files (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  knowledge_id uuid NOT NULL,
  knowledge_version integer NOT NULL,
  file_id uuid NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, knowledge_id, knowledge_version, file_id),
  UNIQUE (guild_id, file_id),
  UNIQUE (guild_id, knowledge_id, knowledge_version, position),
  FOREIGN KEY (guild_id, knowledge_id, knowledge_version)
    REFERENCES knowledge_versions(guild_id, knowledge_id, version),
  FOREIGN KEY (guild_id, file_id) REFERENCES files(guild_id, id)
);

CREATE UNIQUE INDEX knowledge_one_working_version_idx
  ON knowledge_versions (guild_id, knowledge_id)
  WHERE state IN ('draft', 'proposed');

CREATE UNIQUE INDEX knowledge_one_canonical_version_idx
  ON knowledge_versions (guild_id, knowledge_id)
  WHERE state = 'canonical';

CREATE INDEX knowledge_reviews_version_idx
  ON knowledge_reviews (guild_id, knowledge_id, knowledge_version, created_at DESC);

CREATE INDEX knowledge_files_version_idx
  ON knowledge_version_files (guild_id, knowledge_id, knowledge_version, position);

CREATE INDEX files_pending_cleanup_idx
  ON files (guild_id, upload_expires_at)
  WHERE status = 'pending';

CREATE FUNCTION guild_runtime.reject_knowledge_version_content_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Knowledge versions are immutable';
  END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.knowledge_id IS DISTINCT FROM NEW.knowledge_id
     OR OLD.version IS DISTINCT FROM NEW.version
     OR OLD.title IS DISTINCT FROM NEW.title
     OR OLD.summary IS DISTINCT FROM NEW.summary
     OR OLD.body IS DISTINCT FROM NEW.body
     OR OLD.source_ids IS DISTINCT FROM NEW.source_ids
     OR OLD.created_by_identity_id IS DISTINCT FROM NEW.created_by_identity_id
     OR OLD.created_at IS DISTINCT FROM NEW.created_at
     OR OLD.change_note IS DISTINCT FROM NEW.change_note THEN
    RAISE EXCEPTION 'Knowledge version content is immutable; create a new version';
  END IF;
  IF NOT (
    (OLD.state = 'draft' AND NEW.state IN ('proposed', 'archived'))
    OR (OLD.state = 'proposed' AND NEW.state IN ('draft', 'canonical', 'archived'))
    OR (OLD.state = 'canonical' AND NEW.state = 'deprecated')
    OR (OLD.state = 'deprecated' AND NEW.state = 'archived')
    OR OLD.state = NEW.state
  ) THEN
    RAISE EXCEPTION 'Invalid Knowledge version state transition from % to %', OLD.state, NEW.state;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER knowledge_version_immutable_content
BEFORE UPDATE OR DELETE ON knowledge_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_knowledge_version_content_mutation();

CREATE FUNCTION guild_runtime.reject_knowledge_review_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Knowledge reviews are append-only';
END;
$$;

CREATE TRIGGER knowledge_review_no_update_or_delete
BEFORE UPDATE OR DELETE ON knowledge_reviews
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_knowledge_review_mutation();

CREATE FUNCTION guild_runtime.enforce_knowledge_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_knowledge_id uuid;
  knowledge_row knowledge%ROWTYPE;
  current_state text;
  canonical_state text;
BEGIN
  IF TG_TABLE_NAME = 'knowledge' THEN
    target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
    target_knowledge_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  ELSE
    target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
    target_knowledge_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.knowledge_id ELSE NEW.knowledge_id END;
  END IF;

  SELECT * INTO knowledge_row
    FROM knowledge
   WHERE guild_id = target_guild_id AND id = target_knowledge_id;
  IF NOT FOUND THEN
    IF TG_TABLE_NAME = 'knowledge' AND TG_OP = 'DELETE' THEN
      RAISE EXCEPTION 'Knowledge is retained through archive state, not deletion';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  SELECT state INTO current_state
    FROM knowledge_versions
   WHERE guild_id = knowledge_row.guild_id
     AND knowledge_id = knowledge_row.id
     AND version = knowledge_row.current_version;
  IF current_state IS NULL OR current_state <> knowledge_row.state THEN
    RAISE EXCEPTION 'Knowledge current version and state are inconsistent';
  END IF;

  IF knowledge_row.canonical_version IS NOT NULL THEN
    SELECT state INTO canonical_state
      FROM knowledge_versions
     WHERE guild_id = knowledge_row.guild_id
       AND knowledge_id = knowledge_row.id
       AND version = knowledge_row.canonical_version;
    IF canonical_state IS NULL
       OR canonical_state <> 'canonical'
          AND NOT (
            knowledge_row.current_version = knowledge_row.canonical_version
            AND knowledge_row.state IN ('deprecated', 'archived')
            AND canonical_state = knowledge_row.state
          ) THEN
      RAISE EXCEPTION 'Knowledge canonical version is inconsistent';
    END IF;
  END IF;

  IF knowledge_row.state = 'canonical'
     AND knowledge_row.current_version IS DISTINCT FROM knowledge_row.canonical_version THEN
    RAISE EXCEPTION 'Canonical Knowledge must point to its current version';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE CONSTRAINT TRIGGER knowledge_integrity
AFTER INSERT OR UPDATE OR DELETE ON knowledge
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_knowledge_integrity();

CREATE CONSTRAINT TRIGGER knowledge_version_integrity
AFTER INSERT OR UPDATE OR DELETE ON knowledge_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_knowledge_integrity();

CREATE FUNCTION guild_runtime.enforce_knowledge_file_boundary() RETURNS trigger
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

CREATE TRIGGER knowledge_file_boundary
BEFORE INSERT OR DELETE ON knowledge_version_files
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_knowledge_file_boundary();

CREATE FUNCTION guild_runtime.enforce_file_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id
     OR OLD.r2_key IS DISTINCT FROM NEW.r2_key
     OR OLD.sha256 IS DISTINCT FROM NEW.sha256
     OR OLD.media_type IS DISTINCT FROM NEW.media_type
     OR OLD.byte_size IS DISTINCT FROM NEW.byte_size
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
     OR OLD.classification IS DISTINCT FROM NEW.classification
     OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
     OR OLD.original_name IS DISTINCT FROM NEW.original_name
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'File metadata is immutable';
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('ready', 'failed', 'deleted'))
    OR (OLD.status IN ('ready', 'failed') AND NEW.status = 'deleted')
    OR OLD.status = NEW.status
  ) THEN
    RAISE EXCEPTION 'Invalid file state transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER file_immutable_metadata
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_file_immutability();

CREATE TRIGGER files_touch_updated_at
BEFORE UPDATE ON files
FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at();

ALTER TABLE knowledge_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_reviews FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON knowledge_reviews
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

ALTER TABLE knowledge_version_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_version_files FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON knowledge_version_files
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());
