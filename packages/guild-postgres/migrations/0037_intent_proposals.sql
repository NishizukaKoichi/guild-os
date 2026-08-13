-- Persist inspectable Plan proposals and the execution state of every Act item.
-- Model output is never authority: each action is re-authorized when claimed and
-- consequential writes are staged through the governed Agent execution path.

CREATE TABLE intent_proposals (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  space_id uuid,
  created_by_actor_id uuid NOT NULL,
  locale text NOT NULL CHECK (locale IN ('en', 'ja', 'zh-CN')),
  objective text NOT NULL CHECK (length(btrim(objective)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'ready'
    CHECK (status IN ('ready', 'executing', 'completed', 'rejected', 'failed', 'expired')),
  action_count integer NOT NULL CHECK (action_count BETWEEN 1 AND 20),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(evidence) = 'array'),
  maximum_risk_level smallint NOT NULL CHECK (maximum_risk_level BETWEEN 0 AND 3),
  authorization_snapshot jsonb NOT NULL CHECK (jsonb_typeof(authorization_snapshot) = 'object'),
  request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, created_by_actor_id, request_hash),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (expires_at > created_at),
  CHECK ((status IN ('completed', 'failed', 'rejected', 'expired')) = (completed_at IS NOT NULL)),
  CHECK (status <> 'failed' OR error_summary IS NOT NULL)
);

CREATE TABLE intent_proposal_actions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  proposal_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 0 AND 19),
  kind text NOT NULL CHECK (kind IN (
    'memory.propose', 'activity.create', 'activity.assign',
    'decision.propose', 'agent.run'
  )),
  action jsonb NOT NULL CHECK (jsonb_typeof(action) = 'object'),
  risk_level smallint NOT NULL CHECK (risk_level BETWEEN 0 AND 3),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'staged', 'succeeded', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  lease_token uuid,
  lease_expires_at timestamptz,
  resource_type text CHECK (
    resource_type IS NULL OR resource_type IN ('memory', 'activity', 'decision', 'agent_run')
  ),
  resource_id uuid,
  agent_run_id uuid,
  result jsonb CHECK (result IS NULL OR jsonb_typeof(result) = 'object'),
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, proposal_id, position),
  FOREIGN KEY (guild_id, proposal_id) REFERENCES intent_proposals(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, agent_run_id) REFERENCES agent_runs(guild_id, id) ON DELETE RESTRICT,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL)),
  CHECK ((resource_type IS NULL) = (resource_id IS NULL)),
  CHECK (agent_run_id IS NULL OR kind = 'agent.run'),
  CHECK (status NOT IN ('processing') OR lease_token IS NOT NULL),
  CHECK (status NOT IN ('succeeded', 'failed', 'cancelled') OR finished_at IS NOT NULL),
  CHECK (status <> 'succeeded' OR result IS NOT NULL),
  CHECK (status <> 'failed' OR error_summary IS NOT NULL)
);

CREATE INDEX intent_proposal_actor_idx
  ON intent_proposals (guild_id, created_by_actor_id, created_at DESC, id DESC);
CREATE INDEX intent_proposal_action_ready_idx
  ON intent_proposal_actions (guild_id, proposal_id, position)
  WHERE status IN ('pending', 'processing', 'staged');
CREATE INDEX intent_proposal_action_agent_idx
  ON intent_proposal_actions (guild_id, agent_run_id)
  WHERE status = 'staged' AND agent_run_id IS NOT NULL;

CREATE FUNCTION guild_runtime.enforce_intent_proposal_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transition_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'ready' OR NEW.version <> 1 OR NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'New Plan proposals must begin ready at version one';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.space_id IS DISTINCT FROM NEW.space_id
     OR OLD.created_by_actor_id IS DISTINCT FROM NEW.created_by_actor_id
     OR OLD.locale IS DISTINCT FROM NEW.locale
     OR OLD.objective IS DISTINCT FROM NEW.objective
     OR OLD.action_count IS DISTINCT FROM NEW.action_count
     OR OLD.evidence IS DISTINCT FROM NEW.evidence
     OR OLD.maximum_risk_level IS DISTINCT FROM NEW.maximum_risk_level
     OR OLD.authorization_snapshot IS DISTINCT FROM NEW.authorization_snapshot
     OR OLD.request_hash IS DISTINCT FROM NEW.request_hash
     OR OLD.expires_at IS DISTINCT FROM NEW.expires_at
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'A ready Plan proposal is immutable';
  END IF;
  IF NEW.status = OLD.status THEN
    transition_allowed := true;
  ELSIF OLD.status = 'ready' AND NEW.status IN ('executing', 'rejected', 'expired', 'failed') THEN
    transition_allowed := true;
  ELSIF OLD.status = 'executing' AND NEW.status IN ('completed', 'failed', 'expired') THEN
    transition_allowed := true;
  END IF;
  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Invalid Plan proposal status transition from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Plan proposal mutations require an exact version increment';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER intent_proposal_integrity
BEFORE INSERT OR UPDATE ON intent_proposals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_intent_proposal_integrity();

CREATE FUNCTION guild_runtime.enforce_intent_action_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transition_allowed boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' OR NEW.version <> 1 OR NEW.attempt_count <> 0 THEN
      RAISE EXCEPTION 'New Plan actions must begin pending at version one';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.proposal_id IS DISTINCT FROM NEW.proposal_id
     OR OLD.position IS DISTINCT FROM NEW.position
     OR OLD.kind IS DISTINCT FROM NEW.kind
     OR OLD.action IS DISTINCT FROM NEW.action
     OR OLD.risk_level IS DISTINCT FROM NEW.risk_level
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'Plan action intent and risk are immutable';
  END IF;
  IF OLD.status IN ('succeeded', 'failed', 'cancelled') THEN
    RAISE EXCEPTION 'A terminal Plan action is immutable';
  END IF;
  IF NEW.status = OLD.status AND OLD.status IN ('processing', 'staged') THEN
    transition_allowed := true;
  ELSIF OLD.status = 'pending' AND NEW.status IN ('processing', 'cancelled') THEN
    transition_allowed := true;
  ELSIF OLD.status = 'processing' AND NEW.status IN ('pending', 'staged', 'succeeded', 'failed', 'cancelled') THEN
    transition_allowed := true;
  ELSIF OLD.status = 'staged' AND NEW.status IN ('succeeded', 'failed', 'cancelled') THEN
    transition_allowed := true;
  END IF;
  IF NOT transition_allowed THEN
    RAISE EXCEPTION 'Invalid Plan action status transition from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Plan action mutations require an exact version increment';
  END IF;
  IF NEW.attempt_count < OLD.attempt_count OR NEW.attempt_count > OLD.attempt_count + 1 THEN
    RAISE EXCEPTION 'Plan action attempt count cannot move backwards or skip attempts';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER intent_action_integrity
BEFORE INSERT OR UPDATE ON intent_proposal_actions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_intent_action_integrity();

CREATE FUNCTION guild_runtime.reject_intent_history_delete() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Plan and Act history is append-preserving and cannot be deleted';
END;
$$;

CREATE TRIGGER intent_proposal_delete_rejected
BEFORE DELETE ON intent_proposals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_intent_history_delete();
CREATE TRIGGER intent_action_delete_rejected
BEFORE DELETE ON intent_proposal_actions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_intent_history_delete();

ALTER TABLE intent_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_proposals FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON intent_proposals
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

ALTER TABLE intent_proposal_actions ENABLE ROW LEVEL SECURITY;
ALTER TABLE intent_proposal_actions FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON intent_proposal_actions
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());
