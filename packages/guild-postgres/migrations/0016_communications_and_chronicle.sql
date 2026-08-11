ALTER TABLE announcements
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD CONSTRAINT announcements_version_positive CHECK (version > 0),
  ADD CONSTRAINT announcements_space_visibility CHECK (
    (visibility = 'space' AND space_id IS NOT NULL)
    OR (visibility = 'guild' AND space_id IS NULL)
    OR visibility IN ('restricted', 'private')
  ),
  ADD CONSTRAINT announcements_explicit_access CHECK (
    visibility IN ('restricted', 'private') OR cardinality(allowed_identity_ids) = 0
  ),
  ADD CONSTRAINT announcements_publication_state CHECK (
    (status = 'draft' AND published_at IS NULL)
    OR (status IN ('published', 'archived') AND published_at IS NOT NULL)
  ),
  ADD CONSTRAINT announcements_expiry_order CHECK (
    expires_at IS NULL OR expires_at > COALESCE(published_at, created_at)
  );

CREATE FUNCTION guild_runtime.enforce_announcement_governance() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.owner_identity_id <> OLD.owner_identity_id
     OR NEW.creator_identity_id <> OLD.creator_identity_id THEN
    RAISE EXCEPTION 'Announcement ownership and creator are immutable';
  END IF;

  IF OLD.status <> 'draft' AND (
    NEW.space_id IS DISTINCT FROM OLD.space_id
    OR NEW.target_role_id IS DISTINCT FROM OLD.target_role_id
    OR NEW.title IS DISTINCT FROM OLD.title
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.visibility IS DISTINCT FROM OLD.visibility
    OR NEW.classification IS DISTINCT FROM OLD.classification
    OR NEW.allowed_identity_ids IS DISTINCT FROM OLD.allowed_identity_ids
    OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
    OR NEW.published_at IS DISTINCT FROM OLD.published_at
  ) THEN
    RAISE EXCEPTION 'Published Announcement content and audience are immutable';
  END IF;

  IF NOT (
    NEW.status = OLD.status
    OR OLD.status = 'draft' AND NEW.status IN ('published', 'archived')
    OR OLD.status = 'published' AND NEW.status = 'archived'
  ) THEN
    RAISE EXCEPTION 'Invalid Announcement status transition';
  END IF;

  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Announcement version must increment exactly once';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER announcement_governance
BEFORE UPDATE ON announcements
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_announcement_governance();

ALTER TABLE inbox_notifications
  ADD COLUMN space_id uuid,
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN deduplication_key text;

UPDATE inbox_notifications SET owner_identity_id = recipient_identity_id;

ALTER TABLE inbox_notifications
  ALTER COLUMN owner_identity_id SET NOT NULL,
  ADD FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD CONSTRAINT inbox_space_visibility CHECK (
    visibility <> 'space' OR space_id IS NOT NULL
  ),
  ADD CONSTRAINT inbox_explicit_access CHECK (
    visibility IN ('restricted', 'private') OR cardinality(allowed_identity_ids) = 0
  ),
  ADD CONSTRAINT inbox_deduplication_key_length CHECK (
    deduplication_key IS NULL OR length(deduplication_key) BETWEEN 1 AND 500
  );

CREATE UNIQUE INDEX inbox_deduplication_idx
  ON inbox_notifications (guild_id, recipient_identity_id, deduplication_key)
  WHERE deduplication_key IS NOT NULL;
CREATE INDEX inbox_resource_idx
  ON inbox_notifications (guild_id, resource_type, resource_id, created_at DESC);

CREATE FUNCTION guild_runtime.protect_inbox_payload() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.guild_id <> OLD.guild_id
     OR NEW.recipient_identity_id <> OLD.recipient_identity_id
     OR NEW.kind <> OLD.kind
     OR NEW.title <> OLD.title
     OR NEW.body <> OLD.body
     OR NEW.resource_type IS DISTINCT FROM OLD.resource_type
     OR NEW.resource_id IS DISTINCT FROM OLD.resource_id
     OR NEW.space_id IS DISTINCT FROM OLD.space_id
     OR NEW.owner_identity_id <> OLD.owner_identity_id
     OR NEW.visibility <> OLD.visibility
     OR NEW.classification <> OLD.classification
     OR NEW.allowed_identity_ids <> OLD.allowed_identity_ids
     OR NEW.deduplication_key IS DISTINCT FROM OLD.deduplication_key
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Inbox notification payload is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER inbox_payload_immutable
BEFORE UPDATE ON inbox_notifications
FOR EACH ROW EXECUTE FUNCTION guild_runtime.protect_inbox_payload();

ALTER TABLE chronicle_events
  ADD COLUMN space_id uuid,
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'guild'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'restricted'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN search_document tsvector GENERATED ALWAYS AS (
    to_tsvector('simple'::regconfig, action || ' ' || subject_type)
  ) STORED;

UPDATE chronicle_events SET owner_identity_id = actor_identity_id;

ALTER TABLE chronicle_events
  ALTER COLUMN owner_identity_id SET NOT NULL,
  ADD FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD CONSTRAINT chronicle_space_visibility CHECK (
    visibility <> 'space' OR space_id IS NOT NULL
  ),
  ADD CONSTRAINT chronicle_explicit_access CHECK (
    visibility IN ('restricted', 'private') OR cardinality(allowed_identity_ids) = 0
  );

CREATE INDEX chronicle_search_idx ON chronicle_events USING GIN (search_document);
CREATE INDEX chronicle_time_idx ON chronicle_events (guild_id, occurred_at DESC, sequence DESC);

CREATE OR REPLACE FUNCTION guild_runtime.permission_is_human_only(candidate text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT candidate IN (
    'guild.manage', 'constitution.update', 'space.manage', 'identity.manage',
    'membership.manage', 'role.manage', 'knowledge.approve', 'decision.approve',
    'announcement.manage', 'agent.manage', 'agent.approve', 'agent.stop',
    'integration.manage', 'break-glass.use'
  )
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM role_bindings rb
      JOIN identities i ON i.guild_id = rb.guild_id AND i.id = rb.identity_id
      JOIN role_permissions rp ON rp.guild_id = rb.guild_id AND rp.role_id = rb.role_id
     WHERE i.kind <> 'human'
       AND guild_runtime.permission_is_human_only(rp.permission)
  ) THEN
    RAISE EXCEPTION 'Existing machine Role bindings contain human-only Announcement permissions';
  END IF;
END;
$$;
