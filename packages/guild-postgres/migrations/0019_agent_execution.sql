ALTER TABLE connectors
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN deployment_managed boolean NOT NULL DEFAULT false,
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD CONSTRAINT connectors_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100),
  ADD CONSTRAINT connectors_endpoint_shape CHECK (
    endpoint_url IS NULL OR (
      endpoint_url ~ '^https://[^/?#]+(?:/[^?#]*)?$'
      AND length(endpoint_url) <= 2048
    )
  );

ALTER TABLE agent_runs
  ADD COLUMN space_id uuid,
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN connector_id uuid,
  ADD COLUMN action_kind text,
  ADD COLUMN source text NOT NULL DEFAULT 'guild-ui'
    CHECK (source IN ('guild-ui', 'cloudflare-os')),
  ADD COLUMN request_hash text NOT NULL DEFAULT repeat('0', 64),
  ADD COLUMN workflow_permissions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN connector_permissions_snapshot text[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN external_attempted_at timestamptz,
  ADD CONSTRAINT agent_runs_space_fk
    FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  ADD CONSTRAINT agent_runs_owner_fk
    FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD CONSTRAINT agent_runs_connector_fk
    FOREIGN KEY (guild_id, connector_id) REFERENCES connectors(guild_id, id),
  ADD CONSTRAINT agent_runs_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100),
  ADD CONSTRAINT agent_runs_request_hash_check CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  ADD CONSTRAINT agent_runs_action_kind_check CHECK (
    action_kind IS NULL OR action_kind = 'https_webhook.post'
  ),
  ADD CONSTRAINT agent_runs_permissions_check CHECK (
    cardinality(workflow_permissions) <= 20
    AND cardinality(connector_permissions_snapshot) <= 20
    AND array_position(workflow_permissions, NULL) IS NULL
    AND array_position(connector_permissions_snapshot, NULL) IS NULL
  );

UPDATE agent_runs SET owner_identity_id = requester_identity_id;
ALTER TABLE agent_runs ALTER COLUMN owner_identity_id SET NOT NULL;

ALTER TABLE approval_requests
  ADD COLUMN approval_count integer NOT NULL DEFAULT 0
    CHECK (approval_count >= 0 AND approval_count <= 20),
  ADD CONSTRAINT approval_requests_quorum_limit CHECK (required_approvals <= 20);

ALTER TABLE approval_votes
  ADD COLUMN reason text NOT NULL DEFAULT 'Legacy approval',
  ADD CONSTRAINT approval_votes_reason_check
    CHECK (length(btrim(reason)) BETWEEN 1 AND 5000);

CREATE INDEX agent_runs_recent_idx
  ON agent_runs (guild_id, updated_at DESC, id DESC);
CREATE INDEX agent_runs_connector_idx
  ON agent_runs (guild_id, connector_id, status);
CREATE INDEX agent_runs_workflow_idx
  ON agent_runs (guild_id, workflow_instance_id)
  WHERE workflow_instance_id IS NOT NULL;
CREATE INDEX approval_votes_count_idx
  ON approval_votes (guild_id, approval_request_id, verdict);

CREATE FUNCTION guild_runtime.enforce_connector_immutability() RETURNS trigger
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
     OR OLD.deployment_managed IS DISTINCT FROM NEW.deployment_managed THEN
    RAISE EXCEPTION 'Connector configuration is immutable; provision a new Connector';
  END IF;
  IF OLD.status = 'revoked' AND NEW.status <> 'revoked' THEN
    RAISE EXCEPTION 'A revoked Connector cannot be restored';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Connector status changes require an exact version increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER connector_configuration_immutable
BEFORE UPDATE ON connectors
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_connector_immutability();

CREATE FUNCTION guild_runtime.enforce_agent_run_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  permitted boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.plan IS NULL OR NEW.connector_id IS NULL OR NEW.action_kind IS NULL
       OR NEW.workflow_instance_id IS NULL OR length(btrim(NEW.workflow_instance_id)) = 0 THEN
      RAISE EXCEPTION 'New Agent runs require a plan, Connector, action, and Workflow instance';
    END IF;
    IF NEW.status NOT IN ('planning', 'awaiting_approval') THEN
      RAISE EXCEPTION 'New Agent runs must begin in planning or awaiting approval';
    END IF;
    IF NEW.risk_level <> 2 OR NEW.action_kind <> 'https_webhook.post' THEN
      RAISE EXCEPTION 'The v1 external webhook action must be Risk Level 2';
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
     OR OLD.connector_permissions_snapshot IS DISTINCT FROM NEW.connector_permissions_snapshot THEN
    RAISE EXCEPTION 'Agent run authority, plan, limits, and idempotency are immutable';
  END IF;

  IF OLD.status IN ('succeeded', 'failed', 'killed') THEN
    RAISE EXCEPTION 'A terminal Agent run is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    permitted := true;
  ELSIF OLD.status = 'planning' AND NEW.status IN ('awaiting_approval', 'failed', 'killed') THEN
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

CREATE FUNCTION guild_runtime.enforce_approval_request_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  permitted boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.agent_run_id IS DISTINCT FROM NEW.agent_run_id
     OR OLD.risk_level IS DISTINCT FROM NEW.risk_level
     OR OLD.action_kind IS DISTINCT FROM NEW.action_kind
     OR OLD.action_payload IS DISTINCT FROM NEW.action_payload
     OR OLD.required_approvals IS DISTINCT FROM NEW.required_approvals
     OR OLD.reauthentication_required IS DISTINCT FROM NEW.reauthentication_required
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Approval request scope and action are immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    permitted := true;
  ELSIF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected', 'expired') THEN
    permitted := true;
  ELSIF OLD.status = 'approved' AND NEW.status = 'applied' THEN
    permitted := true;
  END IF;
  IF NOT permitted THEN
    RAISE EXCEPTION 'Invalid approval request status transition from % to %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER approval_request_integrity
BEFORE UPDATE ON approval_requests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_approval_request_integrity();

CREATE FUNCTION guild_runtime.enforce_agent_approval_vote() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_row record;
BEGIN
  SELECT approval.*, run.space_id, run.owner_identity_id, run.visibility,
         run.classification, run.allowed_identity_ids
    INTO request_row
    FROM approval_requests approval
    JOIN agent_runs run
      ON run.guild_id = approval.guild_id AND run.id = approval.agent_run_id
   WHERE approval.guild_id = NEW.guild_id AND approval.id = NEW.approval_request_id
   FOR UPDATE OF approval, run;
  IF NOT FOUND OR request_row.status <> 'pending' OR request_row.expires_at <= now() THEN
    RAISE EXCEPTION 'Only a current pending Agent approval can be reviewed';
  END IF;
  IF NOT EXISTS (
    SELECT 1
      FROM identities identity_row
      JOIN memberships membership_row
        ON membership_row.guild_id = identity_row.guild_id
       AND membership_row.identity_id = identity_row.id
      JOIN guilds guild_row ON guild_row.id = identity_row.guild_id
     WHERE identity_row.guild_id = NEW.guild_id
       AND identity_row.id = NEW.approver_identity_id
       AND identity_row.kind = 'human'
       AND identity_row.status = 'active'
       AND membership_row.state = 'active'
       AND CASE request_row.classification
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
           END <= CASE membership_row.clearance
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
           END
       AND (request_row.visibility NOT IN ('private', 'restricted')
         OR request_row.owner_identity_id = identity_row.id
         OR identity_row.id = ANY(request_row.allowed_identity_ids))
       AND (guild_row.root_owner_identity_id = identity_row.id OR EXISTS (
         SELECT 1
           FROM role_bindings binding_row
           JOIN role_permissions permission_row
             ON permission_row.guild_id = binding_row.guild_id
            AND permission_row.role_id = binding_row.role_id
          WHERE binding_row.guild_id = identity_row.guild_id
            AND binding_row.identity_id = identity_row.id
            AND permission_row.permission = 'agent.approve'
            AND (binding_row.space_id IS NULL
              OR request_row.space_id IS NOT NULL
                 AND guild_runtime.space_contains(
                   NEW.guild_id,
                   binding_row.space_id,
                   request_row.space_id
                 ))
       ))
  ) THEN
    RAISE EXCEPTION 'Agent approval requires an authorized active Human';
  END IF;
  IF request_row.reauthentication_required AND (
    NEW.reauthenticated_at IS NULL
    OR NEW.reauthenticated_at < now() - interval '5 minutes'
    OR NEW.reauthenticated_at > now() + interval '30 seconds'
  ) THEN
    RAISE EXCEPTION 'This Agent approval requires recent reauthentication';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER agent_approval_vote_boundary
BEFORE INSERT ON approval_votes
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_approval_vote();

CREATE FUNCTION guild_runtime.reject_approval_vote_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Approval votes are append-only';
END;
$$;

CREATE TRIGGER approval_votes_append_only
BEFORE UPDATE OR DELETE ON approval_votes
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_approval_vote_mutation();

CREATE FUNCTION guild_runtime.enforce_agent_approval_outcome() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_id uuid := CASE
    WHEN TG_TABLE_NAME = 'approval_votes' THEN COALESCE(NEW.approval_request_id, OLD.approval_request_id)
    ELSE COALESCE(NEW.id, OLD.id)
  END;
  request_guild_id uuid := CASE
    WHEN TG_TABLE_NAME = 'approval_votes' THEN COALESCE(NEW.guild_id, OLD.guild_id)
    ELSE COALESCE(NEW.guild_id, OLD.guild_id)
  END;
  request_row record;
  approve_count integer;
  reject_count integer;
BEGIN
  SELECT * INTO request_row
    FROM approval_requests
   WHERE guild_id = request_guild_id AND id = request_id;
  IF NOT FOUND OR request_row.agent_run_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  SELECT count(*) FILTER (WHERE verdict = 'approve')::integer,
         count(*) FILTER (WHERE verdict = 'reject')::integer
    INTO approve_count, reject_count
    FROM approval_votes
   WHERE guild_id = request_guild_id AND approval_request_id = request_id;
  IF request_row.approval_count <> approve_count THEN
    RAISE EXCEPTION 'Agent approval count does not match append-only votes';
  END IF;
  IF request_row.status IN ('approved', 'applied')
     AND approve_count < request_row.required_approvals THEN
    RAISE EXCEPTION 'Agent approval quorum has not been reached';
  END IF;
  IF request_row.status = 'rejected' AND reject_count < 1 THEN
    RAISE EXCEPTION 'A rejected Agent action requires a Human rejection vote';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

CREATE CONSTRAINT TRIGGER approval_request_outcome_integrity
AFTER INSERT OR UPDATE OR DELETE ON approval_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_approval_outcome();

CREATE CONSTRAINT TRIGGER approval_vote_outcome_integrity
AFTER INSERT OR UPDATE OR DELETE ON approval_votes
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_approval_outcome();

CREATE FUNCTION guild_runtime.enforce_outbox_payload_immutability() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.approval_request_id IS DISTINCT FROM NEW.approval_request_id
     OR OLD.topic IS DISTINCT FROM NEW.topic
     OR OLD.payload IS DISTINCT FROM NEW.payload
     OR OLD.idempotency_key IS DISTINCT FROM NEW.idempotency_key
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Outbox destination and payload are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER outbox_payload_immutable
BEFORE UPDATE ON outbox
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_outbox_payload_immutability();
