-- Federation runtime Service backfill. This purchaser-owned machine Actor gives
-- signed inbound and outbound transport truthful Chronicle attribution without
-- impersonating the Human Root Owner.

ALTER TABLE guilds NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_bindings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_role_bindings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE service_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE chronicle_events NO FORCE ROW LEVEL SECURITY;

CREATE TEMP TABLE guild_federation_runtime_backfill (
  guild_id uuid PRIMARY KEY,
  role_id uuid NOT NULL UNIQUE,
  role_name text NOT NULL,
  service_id uuid NOT NULL UNIQUE,
  role_binding_id uuid NOT NULL UNIQUE,
  chronicle_event_id uuid NOT NULL UNIQUE,
  correlation_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

WITH candidates AS (
  SELECT guild_row.id AS guild_id,
         gen_random_uuid() AS role_id,
         gen_random_uuid() AS service_id,
         gen_random_uuid() AS role_binding_id,
         gen_random_uuid() AS chronicle_event_id,
         gen_random_uuid() AS correlation_id
    FROM guilds guild_row
   WHERE NOT EXISTS (
     SELECT 1
       FROM service_profiles profile
      WHERE profile.guild_id = guild_row.id
        AND profile.service_type = 'federation-runtime'
   )
)
INSERT INTO guild_federation_runtime_backfill (
  guild_id, role_id, role_name, service_id, role_binding_id,
  chronicle_event_id, correlation_id
)
SELECT candidate.guild_id,
       candidate.role_id,
       CASE WHEN EXISTS (
         SELECT 1 FROM roles existing
          WHERE existing.guild_id = candidate.guild_id
            AND existing.name = 'Federation runtime service'
       ) THEN 'Federation runtime service [' || left(candidate.role_id::text, 8) || ']'
       ELSE 'Federation runtime service'
       END,
       candidate.service_id,
       candidate.role_binding_id,
       candidate.chronicle_event_id,
       candidate.correlation_id
  FROM candidates candidate;

INSERT INTO roles (id, guild_id, name, system)
SELECT role_id, guild_id, role_name, true
  FROM guild_federation_runtime_backfill;

INSERT INTO role_permissions (guild_id, role_id, permission)
SELECT guild_id, role_id, 'federation.read'
  FROM guild_federation_runtime_backfill;

-- Compatibility triggers create the neutral Actor, Membership, profile, and links.
INSERT INTO identities (
  id, guild_id, kind, display_name, status, preferred_locale
)
SELECT service_id, guild_id, 'service', 'Guild Federation runtime', 'active', 'en'
  FROM guild_federation_runtime_backfill;

INSERT INTO memberships (
  guild_id, identity_id, state, clearance, joined_at
)
SELECT guild_id, service_id, 'active', 'restricted', now()
  FROM guild_federation_runtime_backfill;

UPDATE service_profiles profile
   SET service_type = 'federation-runtime',
       description = 'Runs signed, leased Federation transport inside the purchaser-owned deployment.',
       updated_at = now()
  FROM guild_federation_runtime_backfill backfill
 WHERE profile.guild_id = backfill.guild_id
   AND profile.actor_id = backfill.service_id
   AND profile.service_type = 'service';

INSERT INTO role_bindings (
  id, guild_id, identity_id, role_id, space_id
)
SELECT role_binding_id, guild_id, service_id, role_id, NULL
  FROM guild_federation_runtime_backfill;

INSERT INTO chronicle_events (
  id, guild_id, space_id, owner_identity_id, visibility, classification,
  allowed_identity_ids, actor_identity_id, action, subject_type, subject_id,
  correlation_id, details, occurred_at
)
SELECT chronicle_event_id, guild_id, NULL, service_id, 'guild', 'restricted',
       '{}'::uuid[], service_id, 'service.provisioned_by_system', 'identity', service_id,
       correlation_id,
       jsonb_build_object(
         'serviceType', 'federation-runtime',
         'source', 'schema-migration-0043',
         'humanAction', false,
         'secretStored', false
       ),
       now()
  FROM guild_federation_runtime_backfill;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM guild_federation_runtime_backfill backfill
      LEFT JOIN identities identity_row
        ON identity_row.guild_id = backfill.guild_id
       AND identity_row.id = backfill.service_id
       AND identity_row.kind = 'service'
       AND identity_row.status = 'active'
      LEFT JOIN memberships membership
        ON membership.guild_id = backfill.guild_id
       AND membership.identity_id = backfill.service_id
       AND membership.state = 'active'
      LEFT JOIN service_profiles profile
        ON profile.guild_id = backfill.guild_id
       AND profile.actor_id = backfill.service_id
       AND profile.service_type = 'federation-runtime'
      LEFT JOIN role_permissions permission_row
        ON permission_row.guild_id = backfill.guild_id
       AND permission_row.role_id = backfill.role_id
       AND permission_row.permission = 'federation.read'
     WHERE identity_row.id IS NULL OR membership.identity_id IS NULL
        OR profile.actor_id IS NULL OR permission_row.role_id IS NULL
  ) THEN
    RAISE EXCEPTION 'Federation runtime Service backfill is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM guilds guild_row
     WHERE NOT EXISTS (
       SELECT 1 FROM service_profiles profile
        WHERE profile.guild_id = guild_row.id
          AND profile.service_type = 'federation-runtime'
     )
  ) THEN
    RAISE EXCEPTION 'Every Guild must have a Federation runtime Service profile';
  END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE guilds FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE role_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE actors FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE identity_actor_links FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_role_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE service_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE chronicle_events FORCE ROW LEVEL SECURITY;
