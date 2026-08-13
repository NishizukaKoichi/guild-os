-- Generalize Agent execution across the four risk levels and make model routing
-- purchaser-owned while preserving the existing Cloudflare Workers AI default.

ALTER TABLE agent_runs NO FORCE ROW LEVEL SECURITY;

ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_action_kind_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_action_kind_check CHECK (action_kind IN (
    'memory.search', 'activity.draft', 'agent.delegate',
    'https_webhook.post', 'federation.publish'
  )),
  ADD COLUMN parent_run_id uuid,
  ADD COLUMN workflow_definition_id uuid,
  ADD CONSTRAINT agent_runs_parent_fk
    FOREIGN KEY (guild_id, parent_run_id) REFERENCES agent_runs(guild_id, id),
  ADD CONSTRAINT agent_runs_workflow_definition_fk
    FOREIGN KEY (guild_id, workflow_definition_id)
    REFERENCES workflow_definitions(guild_id, id),
  ADD CONSTRAINT agent_runs_not_own_parent CHECK (id IS DISTINCT FROM parent_run_id);

DROP TRIGGER agent_run_integrity ON agent_runs;
CREATE OR REPLACE FUNCTION guild_runtime.enforce_agent_run_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  permitted boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan IS NULL OR NEW.action_kind IS NULL
       OR NEW.workflow_instance_id IS NULL OR length(btrim(NEW.workflow_instance_id)) = 0 THEN
      RAISE EXCEPTION 'New Agent runs require a plan, action, and Workflow instance';
    END IF;
    IF NEW.action_kind IN ('https_webhook.post', 'federation.publish')
       AND NEW.connector_id IS NULL THEN
      RAISE EXCEPTION 'External Agent actions require a Connection';
    END IF;
    IF NEW.action_kind IN ('memory.search', 'activity.draft', 'agent.delegate')
       AND NEW.connector_id IS NOT NULL THEN
      RAISE EXCEPTION 'Internal Agent actions cannot inherit external Connection authority';
    END IF;
    IF (NEW.action_kind = 'memory.search' AND NEW.risk_level <> 0)
       OR (NEW.action_kind IN ('activity.draft', 'agent.delegate') AND NEW.risk_level <> 1)
       OR (NEW.action_kind IN ('https_webhook.post', 'federation.publish')
           AND NEW.risk_level NOT IN (2, 3)) THEN
      RAISE EXCEPTION 'Agent action kind does not match its required risk level';
    END IF;
    IF NEW.status NOT IN ('planning', 'awaiting_approval', 'running') THEN
      RAISE EXCEPTION 'Agent runs must begin in planning, approval, or running state';
    END IF;
    IF jsonb_typeof(NEW.plan) <> 'object'
       OR jsonb_typeof(NEW.usage) <> 'object'
       OR jsonb_typeof(NEW.limits) <> 'object' THEN
      RAISE EXCEPTION 'Agent run plan, usage, and limits must be JSON objects';
    END IF;
    RETURN NEW;
  END IF;

  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.agent_identity_id IS DISTINCT FROM NEW.agent_identity_id
     OR OLD.requester_identity_id IS DISTINCT FROM NEW.requester_identity_id
     OR OLD.quest_id IS DISTINCT FROM NEW.quest_id
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id
     OR OLD.visibility IS DISTINCT FROM NEW.visibility
     OR OLD.classification IS DISTINCT FROM NEW.classification
     OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
     OR OLD.connector_id IS DISTINCT FROM NEW.connector_id
     OR OLD.risk_level IS DISTINCT FROM NEW.risk_level
     OR OLD.limits IS DISTINCT FROM NEW.limits
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.plan IS DISTINCT FROM NEW.plan
     OR OLD.workflow_instance_id IS DISTINCT FROM NEW.workflow_instance_id
     OR OLD.estimated_budget_minor IS DISTINCT FROM NEW.estimated_budget_minor
     OR OLD.action_kind IS DISTINCT FROM NEW.action_kind
     OR OLD.source IS DISTINCT FROM NEW.source
     OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
     OR OLD.workflow_permissions IS DISTINCT FROM NEW.workflow_permissions
     OR OLD.connector_permissions_snapshot IS DISTINCT FROM NEW.connector_permissions_snapshot
     OR OLD.parent_run_id IS DISTINCT FROM NEW.parent_run_id
     OR OLD.workflow_definition_id IS DISTINCT FROM NEW.workflow_definition_id THEN
    RAISE EXCEPTION 'Agent run authority, plan, limits, and idempotency are immutable';
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'killed') THEN
    RAISE EXCEPTION 'A terminal Agent run is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    permitted := true;
  ELSIF OLD.status = 'planning' AND NEW.status IN ('awaiting_approval', 'running', 'failed', 'killed') THEN
    permitted := true;
  ELSIF OLD.status = 'awaiting_approval' AND NEW.status IN ('running', 'failed', 'killed') THEN
    permitted := true;
  ELSIF OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'killed') THEN
    permitted := true;
  END IF;
  IF NOT permitted THEN
    RAISE EXCEPTION 'Invalid Agent run status transition from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Agent run mutations require an exact version increment';
  END IF;
  IF NEW.status = 'succeeded' AND NEW.result IS NULL THEN
    RAISE EXCEPTION 'A successful Agent run requires a result';
  END IF;
  IF NEW.status <> 'succeeded' AND NEW.result IS NOT NULL THEN
    RAISE EXCEPTION 'Only a successful Agent run may store a result';
  END IF;
  IF NEW.status IN ('succeeded', 'failed', 'killed') AND NEW.finished_at IS NULL THEN
    RAISE EXCEPTION 'A terminal Agent run requires a finish timestamp';
  END IF;
  IF NEW.status = 'killed' AND NEW.kill_requested_at IS NULL THEN
    RAISE EXCEPTION 'A killed Agent run requires a kill timestamp';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_run_integrity
BEFORE INSERT OR UPDATE ON agent_runs
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_run_integrity();

CREATE TABLE model_providers (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  kind text NOT NULL CHECK (kind IN (
    'workers_ai', 'cloudflare_ai_gateway', 'openai_compatible'
  )),
  endpoint_url text CHECK (
    endpoint_url IS NULL OR endpoint_url ~ '^https://[^/?#]+(?:/[^?#]*)?$'
  ),
  secret_reference text CHECK (secret_reference IS NULL OR length(secret_reference) <= 500),
  allowed_models text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled', 'revoked')),
  deployment_managed boolean NOT NULL DEFAULT false,
  created_by_actor_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, name),
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (cardinality(allowed_models) BETWEEN 1 AND 100),
  CHECK (array_position(allowed_models, NULL) IS NULL),
  CHECK (
    (kind = 'workers_ai' AND endpoint_url IS NULL AND secret_reference IS NULL)
    OR (kind = 'cloudflare_ai_gateway' AND endpoint_url IS NOT NULL AND secret_reference IS NOT NULL)
    OR (kind = 'openai_compatible' AND endpoint_url IS NOT NULL AND secret_reference IS NOT NULL)
  )
);

CREATE TABLE model_routes (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (purpose IN ('ask', 'plan', 'act', 'embedding', 'review')),
  provider_id uuid NOT NULL,
  primary_model text NOT NULL CHECK (length(btrim(primary_model)) BETWEEN 1 AND 200),
  fallback_model text CHECK (fallback_model IS NULL OR length(btrim(fallback_model)) BETWEEN 1 AND 200),
  max_tokens integer NOT NULL CHECK (max_tokens BETWEEN 1 AND 1000000),
  daily_budget_minor integer NOT NULL DEFAULT 0 CHECK (daily_budget_minor BETWEEN 0 AND 9007199254740991),
  cache_enabled boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  updated_by_actor_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, purpose),
  FOREIGN KEY (guild_id, provider_id) REFERENCES model_providers(guild_id, id),
  FOREIGN KEY (guild_id, updated_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id)
);

DO $$
DECLARE
  guild_row record;
  provider_id uuid;
BEGIN
  FOR guild_row IN SELECT id, root_owner_identity_id FROM guilds
  LOOP
    provider_id := gen_random_uuid();
    INSERT INTO model_providers (
      id, guild_id, name, kind, allowed_models, deployment_managed, created_by_actor_id
    ) VALUES (
      provider_id, guild_row.id, 'Cloudflare Workers AI', 'workers_ai',
      ARRAY['@cf/meta/llama-3.1-8b-instruct-fast', '@cf/baai/bge-m3'],
      true, guild_row.root_owner_identity_id
    );
    INSERT INTO model_routes (
      id, guild_id, purpose, provider_id, primary_model, max_tokens,
      cache_enabled, updated_by_actor_id
    ) VALUES
      (gen_random_uuid(), guild_row.id, 'ask', provider_id,
       '@cf/meta/llama-3.1-8b-instruct-fast', 2048, false, guild_row.root_owner_identity_id),
      (gen_random_uuid(), guild_row.id, 'plan', provider_id,
       '@cf/meta/llama-3.1-8b-instruct-fast', 4096, false, guild_row.root_owner_identity_id),
      (gen_random_uuid(), guild_row.id, 'review', provider_id,
       '@cf/meta/llama-3.1-8b-instruct-fast', 2048, false, guild_row.root_owner_identity_id),
      (gen_random_uuid(), guild_row.id, 'act', provider_id,
       '@cf/meta/llama-3.1-8b-instruct-fast', 2048, false, guild_row.root_owner_identity_id),
      (gen_random_uuid(), guild_row.id, 'embedding', provider_id,
       '@cf/baai/bge-m3', 512, true, guild_row.root_owner_identity_id);
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enqueue_memory_embeddings() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  language text;
  configured_model text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM resource_custody custody
     WHERE custody.guild_id = NEW.guild_id AND custody.resource_type = 'memory'
       AND custody.resource_id = NEW.memory_id AND custody.custody IN ('guild', 'shared')
  ) THEN
    RETURN NEW;
  END IF;
  SELECT route.primary_model INTO configured_model
    FROM model_routes route JOIN model_providers provider
      ON provider.guild_id = route.guild_id AND provider.id = route.provider_id
   WHERE route.guild_id = NEW.guild_id AND route.purpose = 'embedding'
     AND route.status = 'active' AND provider.status = 'active';
  configured_model := COALESCE(configured_model, '@cf/baai/bge-m3');
  FOR language IN SELECT jsonb_object_keys(NEW.body)
  LOOP
    IF language IN ('en', 'ja', 'zh-CN') THEN
      INSERT INTO memory_embedding_jobs (
        id, guild_id, memory_id, memory_version, locale, model
      ) VALUES (
        gen_random_uuid(), NEW.guild_id, NEW.memory_id, NEW.version, language, configured_model
      ) ON CONFLICT (guild_id, memory_id, memory_version, locale, model) DO NOTHING;
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['model_providers', 'model_routes']
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

ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;
