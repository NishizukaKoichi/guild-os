-- Purchaser-owned, asynchronous exports and evidence-gated retention execution.

CREATE FUNCTION guild_runtime.valid_portability_categories(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 12
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY[
      'guild', 'actors', 'spaces', 'roles', 'memories', 'activities',
      'decisions', 'conversations', 'files', 'agent_runs', 'chronicle', 'operations'
    ]::text[]
    AND cardinality(candidate) = (
      SELECT count(DISTINCT category)::integer FROM unnest(candidate) AS category
    )
$$;

CREATE FUNCTION guild_runtime.valid_retention_categories(candidate text[])
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT cardinality(candidate) BETWEEN 1 AND 7
    AND array_position(candidate, NULL) IS NULL
    AND candidate <@ ARRAY[
      'memories', 'activities', 'decisions', 'conversations',
      'files', 'agent_runs', 'chronicle'
    ]::text[]
    AND cardinality(candidate) = (
      SELECT count(DISTINCT category)::integer FROM unnest(candidate) AS category
    )
$$;

CREATE TABLE data_export_jobs (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  requester_actor_id uuid NOT NULL,
  format_version integer NOT NULL CHECK (format_version > 0),
  requested_categories text[] NOT NULL
    CHECK (guild_runtime.valid_portability_categories(requested_categories)),
  include_requester_personal boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'expired')),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  max_attempts integer NOT NULL DEFAULT 3 CHECK (max_attempts BETWEEN 1 AND 20),
  retryable boolean NOT NULL DEFAULT false,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_owner text CHECK (
    lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200
  ),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  r2_object_key text CHECK (
    r2_object_key IS NULL OR length(btrim(r2_object_key)) BETWEEN 1 AND 1024
  ),
  sha256 text CHECK (sha256 IS NULL OR sha256 ~ '^[a-f0-9]{64}$'),
  byte_count bigint CHECK (byte_count IS NULL OR byte_count >= 0),
  row_count bigint CHECK (row_count IS NULL OR row_count >= 0),
  file_count bigint CHECK (file_count IS NULL OR file_count >= 0),
  completed_at timestamptz,
  expires_at timestamptz,
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (guild_id, r2_object_key),
  FOREIGN KEY (guild_id, requester_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (attempt_count <= max_attempts),
  CHECK (
    (status = 'queued'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND r2_object_key IS NULL AND sha256 IS NULL
      AND byte_count IS NULL AND row_count IS NULL AND file_count IS NULL
      AND completed_at IS NULL AND expires_at IS NULL AND error_summary IS NULL
      AND retryable = false)
    OR (status = 'processing'
      AND lease_token IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL
      AND r2_object_key IS NULL AND sha256 IS NULL
      AND byte_count IS NULL AND row_count IS NULL AND file_count IS NULL
      AND completed_at IS NULL AND expires_at IS NULL AND error_summary IS NULL
      AND retryable = false)
    OR (status = 'completed'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND r2_object_key IS NOT NULL AND sha256 IS NOT NULL
      AND byte_count IS NOT NULL AND row_count IS NOT NULL AND file_count IS NOT NULL
      AND completed_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at > completed_at AND error_summary IS NULL AND retryable = false)
    OR (status = 'failed'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND r2_object_key IS NULL AND sha256 IS NULL
      AND byte_count IS NULL AND row_count IS NULL AND file_count IS NULL
      AND completed_at IS NULL AND expires_at IS NULL AND error_summary IS NOT NULL)
    OR (status = 'expired'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND r2_object_key IS NOT NULL AND sha256 IS NOT NULL
      AND byte_count IS NOT NULL AND row_count IS NOT NULL AND file_count IS NOT NULL
      AND completed_at IS NOT NULL AND expires_at IS NOT NULL
      AND expires_at > completed_at AND error_summary IS NULL AND retryable = false)
  )
);

CREATE INDEX data_export_jobs_claim_idx
  ON data_export_jobs (guild_id, available_at, created_at, id)
  WHERE status = 'queued';
CREATE INDEX data_export_jobs_stale_lease_idx
  ON data_export_jobs (guild_id, lease_expires_at, id)
  WHERE status = 'processing';
CREATE INDEX data_export_jobs_expiry_idx
  ON data_export_jobs (guild_id, expires_at, id)
  WHERE status = 'completed';

CREATE TABLE server_authorization_evidence (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  subject_human_actor_id uuid NOT NULL,
  verified_by_service_actor_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose = 'retention.purge'),
  verification_method text NOT NULL
    CHECK (length(btrim(verification_method)) BETWEEN 1 AND 100),
  verifier_assertion_sha256 text NOT NULL
    CHECK (verifier_assertion_sha256 ~ '^[a-f0-9]{64}$'),
  chronicle_event_id uuid NOT NULL,
  verified_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_by_retention_run_id uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, chronicle_event_id),
  FOREIGN KEY (guild_id, subject_human_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, verified_by_service_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (expires_at > verified_at AND expires_at <= verified_at + interval '10 minutes'),
  CHECK (
    (consumed_by_retention_run_id IS NULL AND consumed_at IS NULL)
    OR (consumed_by_retention_run_id IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE retention_runs (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  requested_by_actor_id uuid NOT NULL,
  dry_run boolean NOT NULL,
  policy_version integer NOT NULL CHECK (policy_version > 0),
  categories text[] NOT NULL CHECK (guild_runtime.valid_retention_categories(categories)),
  cutoff_at timestamptz NOT NULL,
  authorization_evidence_id uuid,
  planned_chronicle_event_id uuid NOT NULL,
  terminal_chronicle_event_id uuid,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  idempotency_key text NOT NULL
    CHECK (length(btrim(idempotency_key)) BETWEEN 1 AND 500),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 20),
  lease_token uuid,
  lease_owner text CHECK (
    lease_owner IS NULL OR length(btrim(lease_owner)) BETWEEN 1 AND 200
  ),
  lease_expires_at timestamptz,
  heartbeat_at timestamptz,
  result_summary jsonb CHECK (
    result_summary IS NULL OR jsonb_typeof(result_summary) = 'object'
  ),
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  UNIQUE (guild_id, authorization_evidence_id),
  FOREIGN KEY (guild_id, requested_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, authorization_evidence_id)
    REFERENCES server_authorization_evidence(guild_id, id),
  FOREIGN KEY (guild_id, planned_chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  FOREIGN KEY (guild_id, terminal_chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (NOT dry_run OR authorization_evidence_id IS NULL),
  CHECK (
    (status = 'queued'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND result_summary IS NULL AND error_summary IS NULL
      AND completed_at IS NULL AND terminal_chronicle_event_id IS NULL)
    OR (status = 'processing'
      AND lease_token IS NOT NULL AND lease_owner IS NOT NULL
      AND lease_expires_at IS NOT NULL AND heartbeat_at IS NOT NULL
      AND result_summary IS NULL AND error_summary IS NULL
      AND completed_at IS NULL AND terminal_chronicle_event_id IS NULL)
    OR (status = 'completed'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND result_summary IS NOT NULL AND error_summary IS NULL
      AND completed_at IS NOT NULL AND terminal_chronicle_event_id IS NOT NULL)
    OR (status = 'failed'
      AND lease_token IS NULL AND lease_owner IS NULL AND lease_expires_at IS NULL
      AND heartbeat_at IS NULL AND result_summary IS NULL AND error_summary IS NOT NULL
      AND completed_at IS NOT NULL AND terminal_chronicle_event_id IS NOT NULL)
  )
);

ALTER TABLE server_authorization_evidence
  ADD CONSTRAINT server_authorization_evidence_consumed_run_fk
  FOREIGN KEY (guild_id, consumed_by_retention_run_id)
  REFERENCES retention_runs(guild_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE retention_actions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  retention_run_id uuid NOT NULL,
  category text NOT NULL,
  action text NOT NULL CHECK (action IN ('retain', 'archive', 'purge')),
  cutoff_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
  checkpoint_cursor text CHECK (
    checkpoint_cursor IS NULL OR length(checkpoint_cursor) <= 1000
  ),
  candidate_count bigint NOT NULL DEFAULT 0 CHECK (candidate_count >= 0),
  affected_count bigint NOT NULL DEFAULT 0 CHECK (affected_count >= 0),
  error_summary text CHECK (error_summary IS NULL OR length(error_summary) <= 2000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, retention_run_id, category),
  FOREIGN KEY (guild_id, retention_run_id)
    REFERENCES retention_runs(guild_id, id) ON DELETE RESTRICT,
  CHECK (guild_runtime.valid_retention_categories(ARRAY[category])),
  CHECK (
    (status IN ('pending', 'processing') AND error_summary IS NULL)
    OR (status = 'completed' AND error_summary IS NULL)
    OR (status = 'failed' AND error_summary IS NOT NULL)
  )
);

CREATE INDEX retention_runs_claim_idx
  ON retention_runs (guild_id, created_at, id) WHERE status = 'queued';
CREATE INDEX retention_runs_stale_lease_idx
  ON retention_runs (guild_id, lease_expires_at, id) WHERE status = 'processing';

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'data_export_jobs', 'server_authorization_evidence',
    'retention_runs', 'retention_actions'
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

CREATE FUNCTION guild_runtime.active_human_actor(target_guild_id uuid, target_actor_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM actors actor
      JOIN actor_memberships membership
        ON membership.guild_id = target_guild_id AND membership.actor_id = actor.id
     WHERE actor.id = target_actor_id AND actor.kind = 'human' AND actor.status = 'active'
       AND membership.state IN ('joined', 'active') AND membership.operational = true
  )
$$;

CREATE FUNCTION guild_runtime.enforce_export_job_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Data export job history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT guild_runtime.active_human_actor(NEW.guild_id, NEW.requester_actor_id) THEN
      RAISE EXCEPTION 'A data export must be requested by an active Human Actor';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.requester_actor_id IS DISTINCT FROM OLD.requester_actor_id
     OR NEW.format_version IS DISTINCT FROM OLD.format_version
     OR NEW.requested_categories IS DISTINCT FROM OLD.requested_categories
     OR NEW.include_requester_personal IS DISTINCT FROM OLD.include_requester_personal
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.max_attempts IS DISTINCT FROM OLD.max_attempts
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Data export request identity and scope are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Data export job version must advance by exactly one';
  END IF;
  IF OLD.status IN ('completed', 'expired') AND (
       NEW.r2_object_key IS DISTINCT FROM OLD.r2_object_key
       OR NEW.sha256 IS DISTINCT FROM OLD.sha256
       OR NEW.byte_count IS DISTINCT FROM OLD.byte_count
       OR NEW.row_count IS DISTINCT FROM OLD.row_count
       OR NEW.file_count IS DISTINCT FROM OLD.file_count
       OR NEW.completed_at IS DISTINCT FROM OLD.completed_at
       OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     ) THEN
    RAISE EXCEPTION 'A completed data export manifest is immutable';
  END IF;
  IF OLD.status = 'completed' AND NEW.status <> 'expired' THEN
    RAISE EXCEPTION 'A completed data export can only expire';
  END IF;
  IF OLD.status = 'expired' THEN
    RAISE EXCEPTION 'An expired data export is terminal';
  END IF;
  IF OLD.status = 'failed' AND NEW.status = 'queued'
     AND (NOT OLD.retryable OR OLD.attempt_count >= OLD.max_attempts) THEN
    RAISE EXCEPTION 'Only a retryable data export with attempts remaining can be retried';
  END IF;
  IF OLD.status = 'processing' AND NEW.status = 'processing'
     AND NEW.lease_token IS DISTINCT FROM OLD.lease_token
     AND OLD.lease_expires_at > now() THEN
    RAISE EXCEPTION 'A live data export lease cannot be stolen';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status = 'processing')
    OR (OLD.status = 'processing' AND NEW.status IN ('processing', 'completed', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'queued')
    OR (OLD.status = 'completed' AND NEW.status = 'expired')
  ) THEN
    RAISE EXCEPTION 'Invalid data export job state transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER data_export_job_transition
BEFORE INSERT OR UPDATE OR DELETE ON data_export_jobs
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_export_job_transition();

CREATE FUNCTION guild_runtime.enforce_server_authorization_evidence()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Server authorization evidence is append-only';
  END IF;
  IF TG_OP = 'INSERT' THEN
    NEW.verified_at := statement_timestamp();
    NEW.created_at := statement_timestamp();
    IF NOT guild_runtime.active_human_actor(NEW.guild_id, NEW.subject_human_actor_id) THEN
      RAISE EXCEPTION 'Authorization evidence must name an active Human Actor';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM actors actor
        JOIN actor_memberships membership
          ON membership.guild_id = NEW.guild_id AND membership.actor_id = actor.id
       WHERE actor.id = NEW.verified_by_service_actor_id
         AND actor.kind = 'service' AND actor.status = 'active'
         AND membership.state IN ('joined', 'active') AND membership.operational = true
    ) THEN
      RAISE EXCEPTION 'Authorization evidence must be issued by an active verifier Service';
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.consumed_by_retention_run_id IS NOT NULL
     OR NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.subject_human_actor_id IS DISTINCT FROM OLD.subject_human_actor_id
     OR NEW.verified_by_service_actor_id IS DISTINCT FROM OLD.verified_by_service_actor_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.verification_method IS DISTINCT FROM OLD.verification_method
     OR NEW.verifier_assertion_sha256 IS DISTINCT FROM OLD.verifier_assertion_sha256
     OR NEW.chronicle_event_id IS DISTINCT FROM OLD.chronicle_event_id
     OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
     OR NEW.expires_at IS DISTINCT FROM OLD.expires_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.consumed_by_retention_run_id IS NULL OR NEW.consumed_at IS NULL THEN
    RAISE EXCEPTION 'Authorization evidence can only be consumed once';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM retention_runs run
     WHERE run.guild_id = NEW.guild_id
       AND run.id = NEW.consumed_by_retention_run_id
       AND run.requested_by_actor_id = NEW.subject_human_actor_id
       AND run.authorization_evidence_id = NEW.id AND NOT run.dry_run
  ) THEN
    RAISE EXCEPTION 'Authorization evidence can only be consumed by its matching retention run';
  END IF;
  NEW.consumed_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER server_authorization_evidence_guard
BEFORE INSERT OR UPDATE OR DELETE ON server_authorization_evidence
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_server_authorization_evidence();

CREATE FUNCTION guild_runtime.verify_server_authorization_evidence_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id AND event.id = NEW.chronicle_event_id
       AND event.actor_identity_id = NEW.verified_by_service_actor_id
       AND event.action = 'authorization.verified'
       AND event.subject_type = 'server_authorization_evidence'
       AND event.subject_id = NEW.id
       AND event.details ->> 'purpose' = NEW.purpose
  ) THEN
    RAISE EXCEPTION 'Server authorization evidence requires its verifier Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER server_authorization_evidence_audit
AFTER INSERT ON server_authorization_evidence
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_server_authorization_evidence_audit();

CREATE FUNCTION guild_runtime.enforce_retention_run_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Retention run history cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT guild_runtime.active_human_actor(NEW.guild_id, NEW.requested_by_actor_id) THEN
      RAISE EXCEPTION 'A retention run must be requested by an active Human Actor';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
     OR NEW.dry_run IS DISTINCT FROM OLD.dry_run
     OR NEW.policy_version IS DISTINCT FROM OLD.policy_version
     OR NEW.categories IS DISTINCT FROM OLD.categories
     OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
     OR NEW.authorization_evidence_id IS DISTINCT FROM OLD.authorization_evidence_id
     OR NEW.planned_chronicle_event_id IS DISTINCT FROM OLD.planned_chronicle_event_id
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Retention plan identity, policy, and authorization are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Retention run version must advance by exactly one';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'A completed or failed retention run is terminal';
  END IF;
  IF OLD.status = 'processing' AND NEW.status = 'processing'
     AND NEW.lease_token IS DISTINCT FROM OLD.lease_token
     AND OLD.lease_expires_at > now() THEN
    RAISE EXCEPTION 'A live retention lease cannot be stolen';
  END IF;
  IF NOT (
    (OLD.status = 'queued' AND NEW.status = 'processing')
    OR (OLD.status = 'processing' AND NEW.status IN ('processing', 'completed', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid retention run state transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER retention_run_transition
BEFORE INSERT OR UPDATE OR DELETE ON retention_runs
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_retention_run_transition();

CREATE FUNCTION guild_runtime.enforce_retention_action_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent retention_runs%ROWTYPE;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Retention action history cannot be deleted';
  END IF;
  SELECT * INTO parent FROM retention_runs run
   WHERE run.guild_id = NEW.guild_id AND run.id = NEW.retention_run_id;
  IF NOT FOUND OR NOT NEW.category = ANY(parent.categories)
     OR NEW.cutoff_at IS DISTINCT FROM parent.cutoff_at THEN
    RAISE EXCEPTION 'Retention action must match its immutable run plan';
  END IF;
  IF NEW.action = 'purge' AND NOT parent.dry_run THEN
    IF parent.authorization_evidence_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM server_authorization_evidence evidence
       WHERE evidence.guild_id = parent.guild_id
         AND evidence.id = parent.authorization_evidence_id
         AND evidence.subject_human_actor_id = parent.requested_by_actor_id
         AND evidence.purpose = 'retention.purge'
         AND evidence.expires_at > parent.created_at
         AND (evidence.consumed_by_retention_run_id IS NULL
              OR evidence.consumed_by_retention_run_id = parent.id)
    ) THEN
      RAISE EXCEPTION 'Irreversible retention purge requires current server authorization evidence';
    END IF;
  END IF;
  IF parent.dry_run AND NEW.affected_count <> 0 THEN
    RAISE EXCEPTION 'A dry retention run cannot report affected rows';
  END IF;
  IF TG_OP = 'INSERT' THEN RETURN NEW; END IF;
  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.retention_run_id IS DISTINCT FROM OLD.retention_run_id
     OR NEW.category IS DISTINCT FROM OLD.category
     OR NEW.action IS DISTINCT FROM OLD.action
     OR NEW.cutoff_at IS DISTINCT FROM OLD.cutoff_at
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Retention action identity and plan are immutable';
  END IF;
  IF NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Retention action version must advance by exactly one';
  END IF;
  IF OLD.status IN ('completed', 'failed') THEN
    RAISE EXCEPTION 'A completed or failed retention action is terminal';
  END IF;
  IF NOT (
    (OLD.status = 'pending' AND NEW.status IN ('processing', 'completed', 'failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('processing', 'completed', 'failed'))
  ) THEN
    RAISE EXCEPTION 'Invalid retention action state transition';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER retention_action_transition
BEFORE INSERT OR UPDATE OR DELETE ON retention_actions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_retention_action_transition();

CREATE FUNCTION guild_runtime.verify_retention_run_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_action text;
  expected_event_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    expected_action := 'retention.planned';
    expected_event_id := NEW.planned_chronicle_event_id;
  ELSIF NEW.status = 'completed' THEN
    expected_action := 'retention.completed';
    expected_event_id := NEW.terminal_chronicle_event_id;
  ELSIF NEW.status = 'failed' THEN
    expected_action := 'retention.failed';
    expected_event_id := NEW.terminal_chronicle_event_id;
  ELSE
    RETURN NEW;
  END IF;
  IF expected_event_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id AND event.id = expected_event_id
       AND event.actor_identity_id = NEW.requested_by_actor_id
       AND event.action = expected_action
       AND event.subject_type = 'retention_run' AND event.subject_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Retention transition requires its matching Chronicle event';
  END IF;
  IF EXISTS (
    SELECT 1 FROM retention_actions action
     WHERE action.guild_id = NEW.guild_id AND action.retention_run_id = NEW.id
       AND action.action = 'purge' AND NOT NEW.dry_run
  ) AND NOT EXISTS (
    SELECT 1 FROM server_authorization_evidence evidence
     WHERE evidence.guild_id = NEW.guild_id AND evidence.id = NEW.authorization_evidence_id
       AND evidence.subject_human_actor_id = NEW.requested_by_actor_id
       AND evidence.consumed_by_retention_run_id = NEW.id
       AND evidence.consumed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Irreversible retention purge requires consumed server authorization evidence';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER retention_run_audit
AFTER INSERT OR UPDATE ON retention_runs
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_retention_run_audit();
