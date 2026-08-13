-- Production Federation transport: explicit grants, durable delivery leases, remote Guild Actors,
-- and a read-only inbound projection. Federation data remains tenant-scoped and is never added to
-- ambient Memory search indexes.

-- The migration owner must backfill every Guild. FORCE RLS is restored before commit.
ALTER TABLE federation_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE federation_grants NO FORCE ROW LEVEL SECURITY;
ALTER TABLE federation_deliveries NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_actor_profiles NO FORCE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM federation_grants
     WHERE resource_type NOT IN ('memory', 'activity', 'decision')
  ) THEN
    RAISE EXCEPTION
      'Migration 0040 requires unsupported Federation grants to be revoked and exported before upgrade';
  END IF;
  IF EXISTS (
    SELECT 1 FROM federation_links
     WHERE NOT (allowed_resource_types && ARRAY['memory', 'activity', 'decision']::text[])
  ) THEN
    RAISE EXCEPTION
      'Migration 0040 requires every Federation link to allow Memory, Activity, or Decision';
  END IF;
END;
$$;

UPDATE federation_links
   SET allowed_resource_types = ARRAY(
         SELECT resource_type
           FROM unnest(allowed_resource_types) WITH ORDINALITY AS allowed(resource_type, position)
          WHERE resource_type IN ('memory', 'activity', 'decision')
          ORDER BY position
       ),
       updated_at = now()
 WHERE allowed_resource_types IS DISTINCT FROM ARRAY(
         SELECT resource_type
           FROM unnest(allowed_resource_types) WITH ORDINALITY AS allowed(resource_type, position)
          WHERE resource_type IN ('memory', 'activity', 'decision')
          ORDER BY position
       );

ALTER TABLE federation_grants
  DROP CONSTRAINT federation_grants_resource_type_check,
  ADD CONSTRAINT federation_grants_resource_type_check
    CHECK (resource_type IN ('memory', 'activity', 'decision')),
  ADD CONSTRAINT federation_grants_delivery_reference_unique
    UNIQUE (guild_id, federation_link_id, id);

CREATE FUNCTION guild_runtime.valid_federation_resource_types(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 3
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY['memory', 'activity', 'decision']::text[]
    AND cardinality(candidate) = cardinality(ARRAY(SELECT DISTINCT unnest(candidate)))
$$;

ALTER TABLE federation_links
  ADD CONSTRAINT federation_links_resource_types_valid
    CHECK (guild_runtime.valid_federation_resource_types(allowed_resource_types));

-- A linked Guild is represented as a first-class local Actor. The external Guild UUID remains on
-- the link; the local Actor UUID is deliberately deployment-local.
ALTER TABLE federation_links
  ADD COLUMN remote_actor_id uuid,
  ADD COLUMN remote_version integer NOT NULL DEFAULT 0 CHECK (remote_version >= 0);

UPDATE federation_links SET remote_actor_id = gen_random_uuid() WHERE remote_actor_id IS NULL;

INSERT INTO identities (id, guild_id, kind, display_name, status)
SELECT remote_actor_id, guild_id, 'guild', remote_name, 'active'
  FROM federation_links
ON CONFLICT (id) DO NOTHING;

INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
SELECT guild_id, remote_actor_id, 'active', 'restricted', created_at
  FROM federation_links
ON CONFLICT (guild_id, identity_id) DO NOTHING;

ALTER TABLE federation_links
  ALTER COLUMN remote_actor_id SET NOT NULL,
  ADD CONSTRAINT federation_links_remote_identity_fk
    FOREIGN KEY (guild_id, remote_actor_id) REFERENCES identities(guild_id, id),
  ADD CONSTRAINT federation_links_remote_actor_membership_fk
    FOREIGN KEY (guild_id, remote_actor_id) REFERENCES actor_memberships(guild_id, actor_id);

CREATE FUNCTION guild_runtime.ensure_federation_remote_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.remote_actor_id IS NULL THEN
    NEW.remote_actor_id := gen_random_uuid();
  END IF;

  INSERT INTO identities (id, guild_id, kind, display_name, status)
  VALUES (NEW.remote_actor_id, NEW.guild_id, 'guild', NEW.remote_name, 'active')
  ON CONFLICT (id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM identities
     WHERE guild_id = NEW.guild_id AND id = NEW.remote_actor_id
       AND kind = 'guild' AND status = 'active'
  ) THEN
    RAISE EXCEPTION 'Federation remote Actor must be an active Guild Actor in this Guild';
  END IF;

  INSERT INTO memberships (guild_id, identity_id, state, clearance, joined_at)
  VALUES (NEW.guild_id, NEW.remote_actor_id, 'active', 'restricted', now())
  ON CONFLICT (guild_id, identity_id) DO NOTHING;

  IF NOT EXISTS (
    SELECT 1 FROM actor_memberships
     WHERE guild_id = NEW.guild_id AND actor_id = NEW.remote_actor_id
       AND state = 'active' AND operational = true
  ) THEN
    RAISE EXCEPTION 'Federation remote Guild Actor requires an operational Membership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federation_link_remote_actor
BEFORE INSERT ON federation_links
FOR EACH ROW EXECUTE FUNCTION guild_runtime.ensure_federation_remote_actor();

CREATE FUNCTION guild_runtime.validate_federation_remote_actor()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM identities identity_row
      JOIN actor_memberships membership
        ON membership.guild_id = identity_row.guild_id
       AND membership.actor_id = identity_row.id
     WHERE identity_row.guild_id = NEW.guild_id
       AND identity_row.id = NEW.remote_actor_id
       AND identity_row.kind = 'guild'
  ) THEN
    RAISE EXCEPTION 'Federation link must reference a Guild Actor in this Guild';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER federation_link_remote_actor_kind
AFTER INSERT OR UPDATE OF remote_actor_id ON federation_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.validate_federation_remote_actor();

-- Existing non-durable processing claims are released before coherent leases become mandatory.
UPDATE federation_deliveries
   SET status = 'failed', available_at = now(),
       last_error = 'Legacy Federation processing claim was released during migration.'
 WHERE status = 'processing';

UPDATE federation_deliveries
   SET status = 'rejected', completed_at = now(),
       last_error = 'Federation delivery exhausted its attempt limit before migration.'
 WHERE status IN ('pending', 'failed') AND attempt_count >= 20;

ALTER TABLE federation_deliveries
  ADD COLUMN transport_payload jsonb,
  ADD COLUMN transport_payload_hash text,
  ADD COLUMN envelope_fingerprint text,
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 20
    CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_owner text
    CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN heartbeat_at timestamptz,
  ADD CONSTRAINT federation_delivery_transport_payload_coherent CHECK (
    (transport_payload IS NULL AND transport_payload_hash IS NULL)
    OR (
      jsonb_typeof(transport_payload) = 'object'
      AND transport_payload_hash ~ '^[a-f0-9]{64}$'
    )
  ),
  ADD CONSTRAINT federation_delivery_fingerprint_valid CHECK (
    envelope_fingerprint IS NULL OR envelope_fingerprint ~ '^[a-f0-9]{64}$'
  ),
  ADD CONSTRAINT federation_delivery_fingerprint_direction CHECK (
    direction = 'inbound' OR envelope_fingerprint IS NULL
  ),
  ADD CONSTRAINT federation_delivery_lease_coherent CHECK (
    (lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL AND heartbeat_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL
        AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL)
  );

DROP INDEX federation_deliveries_ready_idx;
CREATE INDEX federation_deliveries_ready_idx
  ON federation_deliveries (guild_id, available_at, created_at, id)
  WHERE direction = 'outbound' AND status IN ('pending', 'failed');
CREATE INDEX federation_deliveries_stale_lease_idx
  ON federation_deliveries (guild_id, lease_expires_at, id)
  WHERE status = 'processing';

CREATE TABLE federation_delivery_grants (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  federation_link_id uuid NOT NULL,
  delivery_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 99),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, delivery_id, grant_id),
  UNIQUE (guild_id, delivery_id, position),
  FOREIGN KEY (guild_id, delivery_id)
    REFERENCES federation_deliveries(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, federation_link_id, grant_id)
    REFERENCES federation_grants(guild_id, federation_link_id, id) ON DELETE RESTRICT
);

CREATE FUNCTION guild_runtime.capture_federation_delivery_grants()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.direction = 'outbound'
     AND NEW.event_type IN (
       'guild.federation.resources.published',
       'guild.federation.grants.revoked'
     )
     AND jsonb_typeof(NEW.payload -> 'grants') = 'array' THEN
    INSERT INTO federation_delivery_grants (
      guild_id, federation_link_id, delivery_id, grant_id, position
    )
    SELECT NEW.guild_id, NEW.federation_link_id, NEW.id, grant_record.id,
           (entry.position - 1)::integer
      FROM jsonb_array_elements(NEW.payload -> 'grants')
           WITH ORDINALITY AS entry(value, position)
      JOIN federation_grants grant_record
        ON grant_record.guild_id = NEW.guild_id
       AND grant_record.federation_link_id = NEW.federation_link_id
       AND grant_record.id::text = entry.value ->> 'grantId'
     WHERE entry.position <= 100
    ON CONFLICT DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federation_delivery_grant_capture
AFTER INSERT ON federation_deliveries
FOR EACH ROW EXECUTE FUNCTION guild_runtime.capture_federation_delivery_grants();

-- Backfill explicit references for queued rows created by migration 0032 callers.
INSERT INTO federation_delivery_grants (
  guild_id, federation_link_id, delivery_id, grant_id, position, created_at
)
SELECT delivery.guild_id, delivery.federation_link_id, delivery.id, grant_record.id,
       (entry.position - 1)::integer, delivery.created_at
  FROM federation_deliveries delivery
 CROSS JOIN LATERAL jsonb_array_elements(
   CASE WHEN jsonb_typeof(delivery.payload -> 'grants') = 'array'
        THEN delivery.payload -> 'grants' ELSE '[]'::jsonb END
 ) WITH ORDINALITY AS entry(value, position)
  JOIN federation_grants grant_record
    ON grant_record.guild_id = delivery.guild_id
   AND grant_record.federation_link_id = delivery.federation_link_id
   AND grant_record.id::text = entry.value ->> 'grantId'
 WHERE delivery.direction = 'outbound' AND entry.position <= 100
ON CONFLICT DO NOTHING;

CREATE TABLE federation_inbound_resources (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  federation_link_id uuid NOT NULL,
  remote_actor_id uuid NOT NULL,
  source_guild_id uuid NOT NULL,
  grant_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('memory', 'activity', 'decision')),
  resource_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('read', 'participate')),
  grant_version integer NOT NULL CHECK (grant_version > 0),
  resource_version integer CHECK (resource_version IS NULL OR resource_version > 0),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  resource jsonb,
  resource_hash text,
  received_delivery_id uuid NOT NULL,
  revoked_delivery_id uuid,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, federation_link_id, grant_id),
  UNIQUE (guild_id, federation_link_id, resource_type, resource_id),
  FOREIGN KEY (guild_id, federation_link_id)
    REFERENCES federation_links(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, remote_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, received_delivery_id)
    REFERENCES federation_deliveries(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, revoked_delivery_id)
    REFERENCES federation_deliveries(guild_id, id) ON DELETE RESTRICT,
  CHECK (source_guild_id <> guild_id),
  CHECK (resource_hash IS NULL OR resource_hash ~ '^[a-f0-9]{64}$'),
  CHECK (
    (status = 'active' AND resource IS NOT NULL AND jsonb_typeof(resource) = 'object'
      AND resource_hash IS NOT NULL AND resource_version IS NOT NULL
      AND revoked_delivery_id IS NULL AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND resource IS NULL AND resource_hash IS NULL
      AND resource_version IS NULL AND revoked_delivery_id IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

-- Deliberately no content, full-text, vector, or cross-Guild index is created here.
CREATE INDEX federation_inbound_resource_lookup_idx
  ON federation_inbound_resources
    (guild_id, federation_link_id, resource_type, resource_id)
  WHERE status = 'active';

CREATE FUNCTION guild_runtime.federation_resource_grant_exists()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  resource_exists boolean;
BEGIN
  IF NEW.resource_type = 'memory' THEN
    SELECT EXISTS (
      SELECT 1 FROM memories
       WHERE guild_id = NEW.guild_id AND id = NEW.resource_id
    ) INTO resource_exists;
  ELSIF NEW.resource_type = 'activity' THEN
    SELECT EXISTS (
      SELECT 1 FROM activities
       WHERE guild_id = NEW.guild_id AND id = NEW.resource_id
    ) INTO resource_exists;
  ELSIF NEW.resource_type = 'decision' THEN
    SELECT EXISTS (
      SELECT 1 FROM decisions
       WHERE guild_id = NEW.guild_id AND id = NEW.resource_id
    ) INTO resource_exists;
  ELSE
    resource_exists := false;
  END IF;
  IF NOT resource_exists THEN
    RAISE EXCEPTION 'Federation grant must reference an explicit resource in this Guild';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER federation_grant_resource_exists
AFTER INSERT OR UPDATE OF resource_type, resource_id ON federation_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.federation_resource_grant_exists();

CREATE FUNCTION guild_runtime.block_revoked_federation_grant()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'revoked' THEN
    UPDATE federation_deliveries delivery
       SET status = 'rejected', completed_at = now(),
           last_error = 'Federation grant was revoked.',
           lease_token = NULL, lease_owner = NULL,
           lease_expires_at = NULL, heartbeat_at = NULL
      FROM federation_delivery_grants reference
     WHERE reference.guild_id = NEW.guild_id
       AND reference.federation_link_id = NEW.federation_link_id
       AND reference.grant_id = NEW.id
       AND delivery.guild_id = reference.guild_id
       AND delivery.id = reference.delivery_id
       AND delivery.event_type = 'guild.federation.resources.published'
       AND delivery.status IN ('pending', 'processing', 'failed');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federation_grant_immediate_revocation
AFTER UPDATE OF status ON federation_grants
FOR EACH ROW EXECUTE FUNCTION guild_runtime.block_revoked_federation_grant();

CREATE FUNCTION guild_runtime.block_revoked_federation_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_delivery uuid := NULLIF(current_setting('app.federation_delivery_id', true), '')::uuid;
BEGIN
  IF OLD.status <> 'revoked' AND NEW.status = 'revoked' THEN
    UPDATE federation_deliveries
       SET status = 'rejected', completed_at = now(),
           last_error = 'Federation link was revoked.',
           lease_token = NULL, lease_owner = NULL,
           lease_expires_at = NULL, heartbeat_at = NULL
     WHERE guild_id = NEW.guild_id AND federation_link_id = NEW.id
       AND status IN ('pending', 'processing', 'failed')
       AND event_type <> 'guild.federation.link.revoked'
       AND (current_delivery IS NULL OR id <> current_delivery);

    UPDATE federation_inbound_resources
       SET status = 'revoked', resource = NULL, resource_hash = NULL,
           resource_version = NULL,
           revoked_delivery_id = COALESCE(current_delivery, received_delivery_id),
           revoked_at = now(), updated_at = now()
     WHERE guild_id = NEW.guild_id AND federation_link_id = NEW.id
       AND status = 'active';

    UPDATE memberships
       SET state = 'departed', departed_at = COALESCE(departed_at, now()), updated_at = now()
     WHERE guild_id = NEW.guild_id AND identity_id = NEW.remote_actor_id
       AND state <> 'departed';
    UPDATE identities
       SET status = 'disabled', updated_at = now()
     WHERE guild_id = NEW.guild_id AND id = NEW.remote_actor_id
       AND status <> 'disabled';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER federation_link_immediate_revocation
AFTER UPDATE OF status ON federation_links
FOR EACH ROW EXECUTE FUNCTION guild_runtime.block_revoked_federation_link();

CREATE FUNCTION guild_runtime.enqueue_federation_grant_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payload_value jsonb;
BEGIN
  IF OLD.status = 'active' AND NEW.status = 'revoked'
     AND EXISTS (
       SELECT 1 FROM federation_links link
        WHERE link.guild_id = NEW.guild_id AND link.id = NEW.federation_link_id
          AND link.status = 'active' AND link.direction IN ('outbound', 'bidirectional')
     ) THEN
    payload_value := jsonb_build_object(
      'kind', 'grants_revoked',
      'grants', jsonb_build_array(jsonb_build_object(
        'grantId', NEW.id::text,
        'resourceType', NEW.resource_type,
        'resourceId', NEW.resource_id::text,
        'permission', NEW.permission,
        'grantVersion', NEW.version,
        'revokedAt', to_char(NEW.revoked_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
      ))
    );
    INSERT INTO federation_deliveries (
      id, guild_id, federation_link_id, direction, event_type, payload,
      payload_hash, idempotency_key, status, available_at
    ) VALUES (
      gen_random_uuid(), NEW.guild_id, NEW.federation_link_id, 'outbound',
      'guild.federation.grants.revoked', payload_value,
      encode(digest(convert_to(payload_value::text, 'UTF8'), 'sha256'), 'hex'),
      'federation:grant-revoked:' || NEW.federation_link_id::text || ':' ||
        NEW.id::text || ':v' || NEW.version::text,
      'pending', now()
    ) ON CONFLICT (guild_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER federation_grant_revocation_delivery
AFTER UPDATE OF status ON federation_grants
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enqueue_federation_grant_revocation();

CREATE FUNCTION guild_runtime.enqueue_federation_link_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  payload_value jsonb;
BEGIN
  IF OLD.status <> 'revoked' AND NEW.status = 'revoked'
     AND NEW.direction IN ('outbound', 'bidirectional')
     AND current_setting('app.federation_inbound_revocation', true) IS DISTINCT FROM 'true' THEN
    payload_value := jsonb_build_object(
      'kind', 'link_revoked',
      'linkVersion', NEW.version,
      'revokedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    );
    INSERT INTO federation_deliveries (
      id, guild_id, federation_link_id, direction, event_type, payload,
      payload_hash, idempotency_key, status, available_at
    ) VALUES (
      gen_random_uuid(), NEW.guild_id, NEW.id, 'outbound',
      'guild.federation.link.revoked', payload_value,
      encode(digest(convert_to(payload_value::text, 'UTF8'), 'sha256'), 'hex'),
      'federation:link-revoked:' || NEW.id::text || ':v' || NEW.version::text,
      'pending', now()
    ) ON CONFLICT (guild_id, idempotency_key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER federation_link_revocation_delivery
AFTER UPDATE OF status ON federation_links
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enqueue_federation_link_revocation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'federation_delivery_grants', 'federation_inbound_resources'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', table_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', table_name);
    EXECUTE format(
      'CREATE POLICY guild_scope ON %I USING (guild_id = guild_runtime.current_guild_id()) WITH CHECK (guild_id = guild_runtime.current_guild_id())',
      table_name
    );
  END LOOP;
END;
$$;

-- Existing Federation link backfills create Identity and Membership compatibility rows.
-- Drain their deferred constraint-trigger events before altering the protected source tables.
SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE federation_links FORCE ROW LEVEL SECURITY;
ALTER TABLE federation_grants FORCE ROW LEVEL SECURITY;
ALTER TABLE federation_deliveries FORCE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE actors FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_actor_profiles FORCE ROW LEVEL SECURITY;
