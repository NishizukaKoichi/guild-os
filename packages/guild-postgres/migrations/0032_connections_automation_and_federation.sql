-- Add purchaser-owned Connections, durable automation definitions, bounded Agent
-- delegation, and explicit opt-in Guild federation.

ALTER TABLE connectors NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_agent_profiles NO FORCE ROW LEVEL SECURITY;

ALTER TABLE connectors
  ADD COLUMN description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  ADD COLUMN provider text NOT NULL DEFAULT 'custom'
    CHECK (length(btrim(provider)) BETWEEN 1 AND 100),
  ADD COLUMN configuration jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(configuration) = 'object'),
  ADD COLUMN auth_kind text NOT NULL DEFAULT 'secret_reference'
    CHECK (auth_kind IN ('none', 'secret_reference', 'oauth', 'service_binding', 'access_token')),
  ADD COLUMN write_risk_level smallint NOT NULL DEFAULT 2 CHECK (write_risk_level BETWEEN 0 AND 3),
  ADD COLUMN health_status text NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('unknown', 'healthy', 'degraded', 'unreachable')),
  ADD COLUMN last_checked_at timestamptz;

ALTER TABLE connectors
  ADD CONSTRAINT connectors_kind_known CHECK (kind IN (
    'https_webhook', 'mcp', 'oauth', 'webhook', 'api',
    'cloudflare_service', 'database', 'storage'
  ));

CREATE FUNCTION guild_runtime.valid_agent_identifier_array(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(candidate) <= 100
    AND array_position(candidate, NULL) IS NULL
    AND COALESCE(bool_and(value ~ '^[a-z0-9][a-z0-9._:-]{1,199}$'), true)
  FROM unnest(candidate) value
$$;

DROP TRIGGER connector_configuration_immutable ON connectors;
CREATE OR REPLACE FUNCTION guild_runtime.enforce_connector_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id
     OR OLD.name IS DISTINCT FROM NEW.name
     OR OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.capability_permissions IS DISTINCT FROM NEW.capability_permissions
     OR OLD.secret_reference IS DISTINCT FROM NEW.secret_reference
     OR OLD.endpoint_url IS DISTINCT FROM NEW.endpoint_url
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
     OR OLD.classification IS DISTINCT FROM NEW.classification
     OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
     OR OLD.deployment_managed IS DISTINCT FROM NEW.deployment_managed
     OR OLD.description IS DISTINCT FROM NEW.description
     OR OLD.provider IS DISTINCT FROM NEW.provider
     OR OLD.configuration IS DISTINCT FROM NEW.configuration
     OR OLD.auth_kind IS DISTINCT FROM NEW.auth_kind
     OR OLD.write_risk_level IS DISTINCT FROM NEW.write_risk_level THEN
    RAISE EXCEPTION 'Connection configuration is immutable; provision a replacement Connection';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'A revoked Connection cannot be restored';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Connection status or health changes require one version increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connector_configuration_immutable
BEFORE UPDATE ON connectors
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_connector_immutability();

ALTER TABLE agent_profiles
  ADD COLUMN skill_ids text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT agent_profile_skill_ids_valid
    CHECK (guild_runtime.valid_agent_identifier_array(skill_ids));
ALTER TABLE actor_agent_profiles
  ADD COLUMN skill_ids text[] NOT NULL DEFAULT '{}',
  ADD CONSTRAINT actor_agent_profile_skill_ids_valid
    CHECK (guild_runtime.valid_agent_identifier_array(skill_ids));

CREATE TABLE workflow_definitions (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  space_id uuid,
  owner_actor_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'active', 'paused', 'archived')),
  nodes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(nodes) = 'array'),
  edges jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(edges) = 'array'),
  visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  allowed_actor_ids uuid[] NOT NULL DEFAULT '{}',
  max_concurrent_runs integer NOT NULL DEFAULT 1 CHECK (max_concurrent_runs BETWEEN 1 AND 100),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (cardinality(allowed_actor_ids) <= 100),
  CHECK (visibility <> 'space' OR space_id IS NOT NULL),
  CHECK (visibility IN ('restricted', 'private') OR cardinality(allowed_actor_ids) = 0)
);

CREATE TABLE automation_rules (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  workflow_id uuid NOT NULL,
  agent_actor_id uuid NOT NULL,
  created_by_actor_id uuid NOT NULL,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('schedule', 'event', 'manual')),
  trigger_expression text NOT NULL CHECK (length(btrim(trigger_expression)) BETWEEN 1 AND 500),
  timezone text NOT NULL DEFAULT 'UTC' CHECK (length(btrim(timezone)) BETWEEN 1 AND 100),
  input_template jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input_template) = 'object'),
  status text NOT NULL DEFAULT 'paused' CHECK (status IN ('active', 'paused', 'archived')),
  next_run_at timestamptz,
  last_run_at timestamptz,
  consecutive_failures integer NOT NULL DEFAULT 0 CHECK (consecutive_failures BETWEEN 0 AND 1000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, workflow_id) REFERENCES workflow_definitions(guild_id, id),
  FOREIGN KEY (guild_id, agent_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, created_by_actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK ((trigger_kind = 'schedule' AND next_run_at IS NOT NULL) OR trigger_kind <> 'schedule')
);

CREATE INDEX automation_rules_due_idx
  ON automation_rules (guild_id, next_run_at, id)
  WHERE status = 'active' AND trigger_kind = 'schedule';
CREATE INDEX automation_rules_event_idx
  ON automation_rules (guild_id, trigger_expression, id)
  WHERE status = 'active' AND trigger_kind = 'event';

CREATE TABLE automation_events (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 200),
  source_actor_id uuid NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(payload) = 'object'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  processed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, source_actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE INDEX automation_events_pending_idx
  ON automation_events (guild_id, created_at, id) WHERE status = 'pending';

CREATE TABLE workflow_run_requests (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  workflow_id uuid NOT NULL,
  automation_rule_id uuid,
  requested_by_actor_id uuid NOT NULL,
  agent_actor_id uuid NOT NULL,
  trigger_kind text NOT NULL CHECK (trigger_kind IN ('schedule', 'event', 'manual', 'delegation')),
  trigger_event_id uuid,
  input jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(input) = 'object'),
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'planning', 'running', 'succeeded', 'failed', 'cancelled')),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  output jsonb CHECK (output IS NULL OR jsonb_typeof(output) = 'object'),
  error_message text CHECK (error_message IS NULL OR length(error_message) <= 2000),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, workflow_id) REFERENCES workflow_definitions(guild_id, id),
  FOREIGN KEY (guild_id, automation_rule_id) REFERENCES automation_rules(guild_id, id),
  FOREIGN KEY (guild_id, trigger_event_id) REFERENCES automation_events(guild_id, id),
  FOREIGN KEY (guild_id, requested_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, agent_actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE INDEX workflow_run_requests_ready_idx
  ON workflow_run_requests (guild_id, created_at, id) WHERE status = 'queued';

CREATE TABLE agent_delegations (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  parent_run_id uuid NOT NULL,
  child_run_id uuid,
  from_agent_actor_id uuid NOT NULL,
  to_agent_actor_id uuid NOT NULL,
  requester_actor_id uuid NOT NULL,
  objective text NOT NULL CHECK (length(btrim(objective)) BETWEEN 1 AND 5000),
  permission_snapshot text[] NOT NULL DEFAULT '{}',
  depth integer NOT NULL CHECK (depth BETWEEN 1 AND 100),
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'approved', 'running', 'completed', 'rejected', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, child_run_id),
  FOREIGN KEY (guild_id, parent_run_id) REFERENCES agent_runs(guild_id, id),
  FOREIGN KEY (guild_id, child_run_id) REFERENCES agent_runs(guild_id, id),
  FOREIGN KEY (guild_id, from_agent_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, to_agent_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, requester_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (from_agent_actor_id <> to_agent_actor_id),
  CHECK (cardinality(permission_snapshot) <= 100 AND array_position(permission_snapshot, NULL) IS NULL)
);

CREATE TABLE federation_links (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  remote_guild_id uuid NOT NULL,
  remote_name text NOT NULL CHECK (length(btrim(remote_name)) BETWEEN 1 AND 200),
  endpoint_url text NOT NULL CHECK (
    endpoint_url ~ '^https://[^/?#]+(?:/[^?#]*)?$' AND length(endpoint_url) <= 2048
  ),
  secret_reference text NOT NULL CHECK (length(btrim(secret_reference)) BETWEEN 1 AND 500),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound', 'bidirectional')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  allowed_resource_types text[] NOT NULL DEFAULT '{}',
  created_by_actor_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, remote_guild_id),
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (remote_guild_id <> guild_id),
  CHECK (
    cardinality(allowed_resource_types) <= 20
    AND array_position(allowed_resource_types, NULL) IS NULL
  )
);

CREATE TABLE federation_grants (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  federation_link_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (resource_type IN ('memory', 'activity', 'decision', 'agent')),
  resource_id uuid NOT NULL,
  permission text NOT NULL CHECK (permission IN ('read', 'participate')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  granted_by_actor_id uuid NOT NULL,
  revoked_by_actor_id uuid,
  revoked_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, federation_link_id, resource_type, resource_id),
  FOREIGN KEY (guild_id, federation_link_id) REFERENCES federation_links(guild_id, id),
  FOREIGN KEY (guild_id, granted_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, revoked_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (
    (status = 'active' AND revoked_by_actor_id IS NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_by_actor_id IS NOT NULL AND revoked_at IS NOT NULL)
  )
);

CREATE TABLE federation_deliveries (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  federation_link_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  event_type text NOT NULL CHECK (length(btrim(event_type)) BETWEEN 1 AND 200),
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[a-f0-9]{64}$'),
  idempotency_key text NOT NULL CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'rejected')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  available_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  last_error text CHECK (last_error IS NULL OR length(last_error) <= 2000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, federation_link_id) REFERENCES federation_links(guild_id, id)
);

CREATE INDEX federation_deliveries_ready_idx
  ON federation_deliveries (guild_id, available_at, id)
  WHERE direction = 'outbound' AND status IN ('pending', 'failed');

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'workflow_definitions', 'automation_rules', 'automation_events',
    'workflow_run_requests', 'agent_delegations', 'federation_links',
    'federation_grants', 'federation_deliveries'
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

ALTER TABLE connectors FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE actor_agent_profiles FORCE ROW LEVEL SECURITY;
