-- Durable, bounded Automation execution and explicit Workflow authority.

CREATE FUNCTION guild_runtime.valid_automation_action_kinds(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 5
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY[
      'memory_search', 'activity_draft', 'agent_delegate',
      'https_webhook', 'federation_publish'
    ]::text[]
    AND cardinality(candidate) = cardinality(ARRAY(SELECT DISTINCT unnest(candidate)))
$$;

CREATE FUNCTION guild_runtime.valid_workflow_permissions(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 100
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY[
      'actor.read', 'actor.manage', 'memory.read', 'memory.create', 'memory.govern',
      'activity.read', 'activity.create', 'activity.assign', 'connection.read',
      'connection.execute', 'connection.manage', 'run.read', 'run.create',
      'run.approve', 'run.stop', 'event.read', 'template.read', 'template.manage',
      'stewardship.manage', 'stewardship.recover', 'relation.read', 'relation.manage',
      'lifecycle.read', 'lifecycle.manage', 'message.read', 'message.create',
      'contribution.read', 'contribution.correct', 'automation.read',
      'automation.manage', 'federation.read', 'federation.manage', 'data.read',
      'data.manage', 'guild.read', 'guild.manage', 'constitution.read',
      'constitution.update', 'space.read', 'space.manage', 'identity.read',
      'identity.manage', 'membership.read', 'membership.manage', 'role.read',
      'role.manage', 'knowledge.read', 'knowledge.create', 'knowledge.propose',
      'knowledge.approve', 'file.read', 'file.create', 'file.delete', 'work.read',
      'work.create', 'work.assign', 'decision.read', 'decision.propose',
      'decision.approve', 'conversation.read', 'conversation.create',
      'conversation.moderate', 'announcement.read', 'announcement.manage',
      'agent.read', 'agent.manage', 'agent.run', 'agent.approve', 'agent.stop',
      'inbox.read', 'chronicle.read', 'integration.read', 'integration.execute',
      'integration.manage', 'break-glass.use'
    ]::text[]
    AND cardinality(candidate) = cardinality(ARRAY(SELECT DISTINCT unnest(candidate)))
$$;

ALTER TABLE workflow_definitions
  ADD COLUMN allowed_action_kinds text[] NOT NULL
    DEFAULT ARRAY['memory_search', 'activity_draft']::text[],
  ADD COLUMN capability_permissions text[] NOT NULL
    DEFAULT ARRAY['memory.read', 'activity.create']::text[],
  ADD CONSTRAINT workflow_allowed_action_kinds_valid
    CHECK (guild_runtime.valid_automation_action_kinds(allowed_action_kinds)),
  ADD CONSTRAINT workflow_capability_permissions_valid
    CHECK (guild_runtime.valid_workflow_permissions(capability_permissions));

ALTER TABLE workflow_run_requests
  ADD COLUMN available_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN lease_token uuid,
  ADD COLUMN lease_owner text CHECK (lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200),
  ADD COLUMN lease_expires_at timestamptz,
  ADD COLUMN attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 100),
  ADD COLUMN max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  ADD COLUMN agent_run_id uuid,
  ADD COLUMN error_code text CHECK (error_code IS NULL OR length(error_code) <= 100),
  ADD CONSTRAINT workflow_run_agent_fk
    FOREIGN KEY (guild_id, agent_run_id) REFERENCES agent_runs(guild_id, id),
  ADD CONSTRAINT workflow_run_lease_coherent CHECK (
    (lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR (lease_token IS NOT NULL AND lease_owner IS NOT NULL AND lease_expires_at IS NOT NULL)
  );

DROP INDEX workflow_run_requests_ready_idx;
CREATE INDEX workflow_run_requests_ready_idx
  ON workflow_run_requests (guild_id, available_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX workflow_run_requests_stale_lease_idx
  ON workflow_run_requests (guild_id, lease_expires_at, id)
  WHERE status = 'planning';

CREATE FUNCTION guild_runtime.enforce_workflow_run_execution_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Workflow execution history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.workflow_id IS DISTINCT FROM OLD.workflow_id
     OR NEW.automation_rule_id IS DISTINCT FROM OLD.automation_rule_id
     OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
     OR NEW.agent_actor_id IS DISTINCT FROM OLD.agent_actor_id
     OR NEW.trigger_kind IS DISTINCT FROM OLD.trigger_kind
     OR NEW.trigger_event_id IS DISTINCT FROM OLD.trigger_event_id
     OR NEW.input IS DISTINCT FROM OLD.input
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Workflow execution request identity and bounds are immutable';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'Terminal Workflow execution history is immutable';
  END IF;
  IF OLD.status = 'planning' AND NEW.status = 'planning'
     AND NEW.lease_token IS DISTINCT FROM OLD.lease_token
     AND OLD.lease_expires_at > now() THEN
    RAISE EXCEPTION 'A live Workflow execution lease cannot be stolen';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status = 'planning')
    OR (OLD.status = 'planning' AND NEW.status IN ('planning', 'queued', 'running', 'failed', 'cancelled'))
    OR (OLD.status = 'running' AND NEW.status IN ('succeeded', 'failed', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid Workflow execution state transition';
  END IF;
  IF NEW.status = 'queued' AND (
       NEW.lease_token IS NOT NULL OR NEW.agent_run_id IS NOT NULL
       OR NEW.attempt_count >= NEW.max_attempts
     ) THEN
    RAISE EXCEPTION 'A retried Workflow execution must release its lease and retain attempts';
  END IF;
  IF NEW.status = 'running' AND (NEW.agent_run_id IS NULL OR NEW.lease_token IS NOT NULL) THEN
    RAISE EXCEPTION 'A running Workflow execution requires one Agent Run and no live lease';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_run_execution_transition
BEFORE INSERT OR UPDATE OR DELETE ON workflow_run_requests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_workflow_run_execution_transition();
