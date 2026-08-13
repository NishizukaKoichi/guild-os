-- Execute purchaser-owned Connection capabilities through the same governed Agent path.

ALTER TABLE agent_runs DROP CONSTRAINT agent_runs_action_kind_check;
ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_action_kind_check CHECK (action_kind IN (
    'memory.search', 'activity.draft', 'agent.delegate', 'connection.invoke',
    'https_webhook.post', 'federation.publish'
  ));

CREATE OR REPLACE FUNCTION guild_runtime.valid_automation_action_kinds(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 6
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY[
      'memory_search', 'activity_draft', 'agent_delegate', 'connection_invoke',
      'https_webhook', 'federation_publish'
    ]::text[]
    AND cardinality(candidate) = cardinality(ARRAY(SELECT DISTINCT unnest(candidate)))
$$;

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
    IF NEW.action_kind IN ('connection.invoke', 'https_webhook.post', 'federation.publish')
       AND NEW.connector_id IS NULL THEN
      RAISE EXCEPTION 'External Agent actions require a Connection';
    END IF;
    IF NEW.action_kind IN ('memory.search', 'activity.draft', 'agent.delegate')
       AND NEW.connector_id IS NOT NULL THEN
      RAISE EXCEPTION 'Internal Agent actions cannot inherit external Connection authority';
    END IF;
    IF (NEW.action_kind = 'memory.search' AND NEW.risk_level <> 0)
       OR (NEW.action_kind IN ('activity.draft', 'agent.delegate') AND NEW.risk_level <> 1)
       OR (NEW.action_kind = 'connection.invoke' AND NEW.risk_level NOT IN (0, 1, 2, 3))
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
