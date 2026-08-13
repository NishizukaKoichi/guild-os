-- Govern explicit promotion out of private messages and evidence-backed Contribution
-- correction review. Private plaintext remains in the private thread unless a current
-- participant deliberately creates one governed destination draft.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE FUNCTION guild_runtime.actor_has_capability(
  target_guild_id uuid,
  target_actor_id uuid,
  target_permission text,
  target_space_id uuid
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM actors actor
      JOIN actor_memberships membership
        ON membership.guild_id = target_guild_id
       AND membership.actor_id = actor.id
      JOIN guilds guild_row ON guild_row.id = target_guild_id
     WHERE actor.id = target_actor_id
       AND actor.status = 'active'
       AND membership.state = 'active'
       AND membership.operational = true
       AND (
         guild_row.root_owner_identity_id = actor.id
         OR EXISTS (
           SELECT 1
             FROM actor_role_bindings binding_row
             JOIN role_permissions permission_row
               ON permission_row.guild_id = binding_row.guild_id
              AND permission_row.role_id = binding_row.role_id
            WHERE binding_row.guild_id = target_guild_id
              AND binding_row.actor_id = target_actor_id
              AND permission_row.permission = target_permission
              AND (
                binding_row.space_id IS NULL
                OR target_space_id IS NOT NULL
                   AND guild_runtime.space_contains(
                     target_guild_id,
                     binding_row.space_id,
                     target_space_id
                   )
              )
         )
       )
  )
$$;

CREATE FUNCTION guild_runtime.is_active_private_participant(
  target_guild_id uuid,
  target_thread_id uuid,
  target_actor_id uuid
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM private_thread_participants participant
      JOIN actor_memberships membership
        ON membership.guild_id = participant.guild_id
       AND membership.actor_id = participant.actor_id
      JOIN actors actor ON actor.id = participant.actor_id
     WHERE participant.guild_id = target_guild_id
       AND participant.thread_id = target_thread_id
       AND participant.actor_id = target_actor_id
       AND participant.state = 'active'
       AND actor.status = 'active'
       AND membership.state = 'active'
       AND membership.operational = true
  )
$$;

CREATE FUNCTION guild_runtime.private_message_selection_sha256(
  target_guild_id uuid,
  target_message_id uuid,
  selection_start integer,
  selection_length integer
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(
           digest(
             convert_to(
               substring(message.body FROM selection_start + 1 FOR selection_length),
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
    FROM private_messages message
   WHERE message.guild_id = target_guild_id
     AND message.id = target_message_id
     AND message.state = 'active'
     AND selection_start >= 0
     AND selection_length > 0
     AND selection_start + selection_length <= char_length(message.body)
$$;

CREATE TABLE private_message_promotions (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL,
  source_message_id uuid NOT NULL,
  promoted_by_actor_id uuid NOT NULL,
  selection_start integer NOT NULL CHECK (selection_start >= 0),
  selection_length integer NOT NULL CHECK (selection_length BETWEEN 1 AND 20000),
  source_sha256 text NOT NULL CHECK (source_sha256 ~ '^[a-f0-9]{64}$'),
  destination_kind text NOT NULL
    CHECK (destination_kind IN ('memory', 'activity', 'decision', 'handover')),
  destination_draft_id uuid NOT NULL,
  idempotency_key text NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$'),
  chronicle_event_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, promoted_by_actor_id, idempotency_key),
  UNIQUE (
    guild_id,
    source_message_id,
    selection_start,
    selection_length,
    destination_kind
  ),
  FOREIGN KEY (guild_id, thread_id)
    REFERENCES private_threads(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, source_message_id)
    REFERENCES private_messages(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, promoted_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX private_message_promotions_source_idx
  ON private_message_promotions (guild_id, source_message_id, created_at, id);
CREATE INDEX private_message_promotions_destination_idx
  ON private_message_promotions (guild_id, destination_kind, destination_draft_id);

ALTER TABLE private_message_promotions ENABLE ROW LEVEL SECURITY;
ALTER TABLE private_message_promotions FORCE ROW LEVEL SECURITY;

CREATE POLICY private_message_promotions_select
  ON private_message_promotions FOR SELECT
  USING (
    guild_id = guild_runtime.current_guild_id()
    AND guild_runtime.is_active_private_participant(
      guild_id,
      thread_id,
      guild_runtime.current_actor_id()
    )
  );

CREATE POLICY private_message_promotions_insert
  ON private_message_promotions FOR INSERT
  WITH CHECK (
    guild_id = guild_runtime.current_guild_id()
    AND promoted_by_actor_id = guild_runtime.current_actor_id()
    AND guild_runtime.is_active_private_participant(
      guild_id,
      thread_id,
      promoted_by_actor_id
    )
  );

CREATE FUNCTION guild_runtime.enforce_private_message_promotion()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_digest text;
  destination_space_id uuid;
  required_permission text;
  destination_valid boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Private message promotion history is append-only';
  END IF;
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'Private message promotion history is immutable';
  END IF;

  IF guild_runtime.current_actor_id() IS NULL
     OR NEW.promoted_by_actor_id <> guild_runtime.current_actor_id() THEN
    RAISE EXCEPTION 'A promotion must be authored by the current Actor';
  END IF;
  IF NOT guild_runtime.is_active_private_participant(
    NEW.guild_id,
    NEW.thread_id,
    NEW.promoted_by_actor_id
  ) THEN
    RAISE EXCEPTION 'Only a current private-thread participant can promote a message';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM private_messages message
     WHERE message.guild_id = NEW.guild_id
       AND message.id = NEW.source_message_id
       AND message.thread_id = NEW.thread_id
       AND message.state = 'active'
  ) THEN
    RAISE EXCEPTION 'The selected private message is unavailable in this thread';
  END IF;

  expected_digest := guild_runtime.private_message_selection_sha256(
    NEW.guild_id,
    NEW.source_message_id,
    NEW.selection_start,
    NEW.selection_length
  );
  IF expected_digest IS NULL OR expected_digest <> NEW.source_sha256 THEN
    RAISE EXCEPTION 'The private-message selection digest does not match its immutable source';
  END IF;

  IF NEW.destination_kind = 'memory' THEN
    required_permission := 'memory.create';
    SELECT memory.space_id,
           (SELECT count(*) = 1 FROM jsonb_each_text(version_row.body))
           AND EXISTS (
             SELECT 1
               FROM jsonb_each_text(version_row.body) localized(locale, content)
              WHERE encode(digest(convert_to(localized.content, 'UTF8'), 'sha256'), 'hex')
                    = NEW.source_sha256
           )
      INTO destination_space_id, destination_valid
      FROM memories memory
      JOIN memory_versions version_row
        ON version_row.guild_id = memory.guild_id
       AND version_row.memory_id = memory.id
       AND version_row.version = memory.current_version
     WHERE memory.guild_id = NEW.guild_id
       AND memory.id = NEW.destination_draft_id
       AND memory.creator_actor_id = NEW.promoted_by_actor_id
       AND memory.status = 'active'
       AND memory.workflow = 'canonical'
       AND memory.governance_state = 'draft';
  ELSIF NEW.destination_kind = 'activity' THEN
    required_permission := 'activity.create';
    SELECT activity.space_id,
           encode(digest(convert_to(activity.description, 'UTF8'), 'sha256'), 'hex')
             = NEW.source_sha256
      INTO destination_space_id, destination_valid
      FROM activities activity
     WHERE activity.guild_id = NEW.guild_id
       AND activity.id = NEW.destination_draft_id
       AND activity.creator_actor_id = NEW.promoted_by_actor_id
       AND activity.status = 'proposed';
  ELSIF NEW.destination_kind = 'decision' THEN
    required_permission := 'decision.propose';
    SELECT decision_row.space_id,
           encode(digest(convert_to(decision_row.description, 'UTF8'), 'sha256'), 'hex')
             = NEW.source_sha256
      INTO destination_space_id, destination_valid
      FROM decisions decision_row
     WHERE decision_row.guild_id = NEW.guild_id
       AND decision_row.id = NEW.destination_draft_id
       AND decision_row.proposer_identity_id = NEW.promoted_by_actor_id
       AND decision_row.status = 'draft';
  ELSE
    required_permission := 'lifecycle.manage';
    SELECT NULL::uuid,
           encode(digest(convert_to(handover.reason, 'UTF8'), 'sha256'), 'hex')
             = NEW.source_sha256
      INTO destination_space_id, destination_valid
      FROM handover_cases handover
     WHERE handover.guild_id = NEW.guild_id
       AND handover.id = NEW.destination_draft_id
       AND handover.initiated_by_actor_id = NEW.promoted_by_actor_id
       AND handover.status = 'open';
  END IF;

  IF NOT FOUND OR NOT destination_valid THEN
    RAISE EXCEPTION 'The governed destination draft does not contain the selected message content';
  END IF;
  IF NOT guild_runtime.actor_has_capability(
    NEW.guild_id,
    NEW.promoted_by_actor_id,
    'message.read',
    (SELECT thread.space_id FROM private_threads thread
      WHERE thread.guild_id = NEW.guild_id AND thread.id = NEW.thread_id)
  ) OR NOT guild_runtime.actor_has_capability(
    NEW.guild_id,
    NEW.promoted_by_actor_id,
    required_permission,
    destination_space_id
  ) THEN
    RAISE EXCEPTION 'The current Actor lacks permission to promote to this destination';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER private_message_promotion_guard
BEFORE INSERT OR UPDATE OR DELETE ON private_message_promotions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_private_message_promotion();

CREATE FUNCTION guild_runtime.verify_private_message_promotion_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.id = NEW.chronicle_event_id
       AND event.actor_identity_id = NEW.promoted_by_actor_id
       AND event.action = 'private_message.promoted'
       AND event.subject_type = 'private_message_promotion'
       AND event.subject_id = NEW.id
       AND event.details = jsonb_build_object(
         'sourceDigest', NEW.source_sha256,
         'destinationKind', NEW.destination_kind,
         'destinationDraftId', NEW.destination_draft_id::text,
         'plaintextRecorded', false
       )
  ) THEN
    RAISE EXCEPTION 'A private-message promotion requires its metadata-only Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER private_message_promotion_audit
AFTER INSERT ON private_message_promotions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_private_message_promotion_audit();

-- Upgrade the existing correction request shell into a reviewed, evidence-bound
-- workflow. Historical rows remain readable; every new request must carry the new
-- evidence and audit columns enforced below.
ALTER TABLE contribution_correction_requests NO FORCE ROW LEVEL SECURITY;

ALTER TABLE contribution_correction_requests
  DROP CONSTRAINT contribution_correction_requests_status_check,
  DROP CONSTRAINT contribution_correction_requests_check;

UPDATE contribution_correction_requests SET status = 'pending' WHERE status = 'open';

ALTER TABLE contribution_correction_requests
  ALTER COLUMN status SET DEFAULT 'pending',
  ADD COLUMN evidence_sha256 text
    CHECK (evidence_sha256 IS NULL OR evidence_sha256 ~ '^[a-f0-9]{64}$'),
  ADD COLUMN request_chronicle_event_id uuid,
  ADD COLUMN resolution_chronicle_event_id uuid,
  ADD CONSTRAINT contribution_correction_requests_status_v2_check
    CHECK (status IN ('pending', 'accepted', 'rejected')),
  ADD CONSTRAINT contribution_correction_requests_shape_v2_check CHECK (
    (status = 'pending' AND reviewed_by_actor_id IS NULL
      AND review_reason IS NULL AND reviewed_at IS NULL
      AND resolution_chronicle_event_id IS NULL)
    OR (status IN ('accepted', 'rejected') AND reviewed_by_actor_id IS NOT NULL
      AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  ADD CONSTRAINT contribution_correction_request_audit_fk
    FOREIGN KEY (guild_id, request_chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED,
  ADD CONSTRAINT contribution_correction_resolution_audit_fk
    FOREIGN KEY (guild_id, resolution_chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id)
    DEFERRABLE INITIALLY DEFERRED;

DROP INDEX contribution_corrections_open_idx;
CREATE INDEX contribution_corrections_pending_idx
  ON contribution_correction_requests (guild_id, created_at, id)
  WHERE status = 'pending';
CREATE UNIQUE INDEX contribution_corrections_one_pending_evidence_idx
  ON contribution_correction_requests (guild_id, subject_actor_id, chronicle_event_id)
  WHERE status = 'pending' AND chronicle_event_id IS NOT NULL;

CREATE FUNCTION guild_runtime.chronicle_event_sha256(
  target_guild_id uuid,
  target_event_id uuid
) RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT encode(
           digest(
             convert_to(
               jsonb_build_object(
                 'sequence', event.sequence,
                 'id', event.id,
                 'actorIdentityId', event.actor_identity_id,
                 'action', event.action,
                 'subjectType', event.subject_type,
                 'subjectId', event.subject_id,
                 'correlationId', event.correlation_id,
                 'occurredAtEpoch', extract(epoch FROM event.occurred_at),
                 'details', event.details,
                 'spaceId', event.space_id,
                 'ownerIdentityId', event.owner_identity_id,
                 'visibility', event.visibility,
                 'classification', event.classification,
                 'allowedIdentityIds', event.allowed_identity_ids
               )::text,
               'UTF8'
             ),
             'sha256'
           ),
           'hex'
         )
    FROM chronicle_events event
   WHERE event.guild_id = target_guild_id AND event.id = target_event_id
$$;

CREATE FUNCTION guild_runtime.is_contribution_correction_manager(
  target_guild_id uuid,
  target_actor_id uuid,
  target_evidence_event_id uuid
) RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1
      FROM actors actor
      JOIN actor_memberships membership
        ON membership.guild_id = target_guild_id
       AND membership.actor_id = actor.id
      JOIN guilds guild_row ON guild_row.id = target_guild_id
      JOIN chronicle_events evidence
        ON evidence.guild_id = target_guild_id
       AND evidence.id = target_evidence_event_id
     WHERE actor.id = target_actor_id
       AND actor.kind = 'human'
       AND actor.status = 'active'
       AND membership.state = 'active'
       AND membership.operational = true
       AND (
         guild_row.root_owner_identity_id = actor.id
         OR (
           guild_runtime.actor_has_capability(
             target_guild_id,
             target_actor_id,
             'contribution.correct',
             evidence.space_id
           )
           AND guild_runtime.actor_has_capability(
             target_guild_id,
             target_actor_id,
             'actor.manage',
             evidence.space_id
           )
         )
       )
  )
$$;

DROP POLICY guild_scope ON contribution_correction_requests;

CREATE POLICY contribution_correction_select
  ON contribution_correction_requests FOR SELECT
  USING (
    guild_id = guild_runtime.current_guild_id()
    AND (
      requested_by_actor_id = guild_runtime.current_actor_id()
      OR guild_runtime.is_contribution_correction_manager(
        guild_id,
        guild_runtime.current_actor_id(),
        chronicle_event_id
      )
    )
  );

CREATE POLICY contribution_correction_insert
  ON contribution_correction_requests FOR INSERT
  WITH CHECK (
    guild_id = guild_runtime.current_guild_id()
    AND requested_by_actor_id = guild_runtime.current_actor_id()
    AND subject_actor_id = requested_by_actor_id
  );

CREATE POLICY contribution_correction_update
  ON contribution_correction_requests FOR UPDATE
  USING (
    guild_id = guild_runtime.current_guild_id()
    AND guild_runtime.is_contribution_correction_manager(
      guild_id,
      guild_runtime.current_actor_id(),
      chronicle_event_id
    )
  )
  WITH CHECK (
    guild_id = guild_runtime.current_guild_id()
    AND guild_runtime.is_contribution_correction_manager(
      guild_id,
      guild_runtime.current_actor_id(),
      chronicle_event_id
    )
  );

CREATE FUNCTION guild_runtime.enforce_contribution_correction_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  expected_digest text;
  current_actor uuid := guild_runtime.current_actor_id();
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Contribution correction history is append-preserving and cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF current_actor IS NULL
       OR NEW.requested_by_actor_id <> current_actor
       OR NEW.subject_actor_id <> current_actor THEN
      RAISE EXCEPTION 'A requester can create only their own Contribution correction';
    END IF;
    IF NEW.status <> 'pending' OR NEW.version <> 1
       OR NEW.chronicle_event_id IS NULL
       OR NEW.evidence_sha256 IS NULL
       OR NEW.request_chronicle_event_id IS NULL
       OR NEW.resolution_chronicle_event_id IS NOT NULL THEN
      RAISE EXCEPTION 'A new Contribution correction requires pending evidence and request audit';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM actors actor
        JOIN actor_memberships membership
          ON membership.guild_id = NEW.guild_id AND membership.actor_id = actor.id
       WHERE actor.id = NEW.requested_by_actor_id
         AND actor.kind = 'human'
         AND actor.status = 'active'
         AND membership.state = 'active'
         AND membership.operational = true
    ) OR NOT guild_runtime.actor_has_capability(
      NEW.guild_id,
      NEW.requested_by_actor_id,
      'contribution.correct',
      (SELECT event.space_id FROM chronicle_events event
        WHERE event.guild_id = NEW.guild_id AND event.id = NEW.chronicle_event_id)
    ) THEN
      RAISE EXCEPTION 'A Contribution correction requires an authorized active Human';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM chronicle_events event
       WHERE event.guild_id = NEW.guild_id
         AND event.id = NEW.chronicle_event_id
         AND event.actor_identity_id = NEW.subject_actor_id
    ) THEN
      RAISE EXCEPTION 'Correction evidence must be an event attributed to the requester';
    END IF;
    expected_digest := guild_runtime.chronicle_event_sha256(
      NEW.guild_id,
      NEW.chronicle_event_id
    );
    IF expected_digest IS NULL OR expected_digest <> NEW.evidence_sha256 THEN
      RAISE EXCEPTION 'Contribution correction evidence digest does not match Chronicle';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.id IS DISTINCT FROM OLD.id
     OR NEW.subject_actor_id IS DISTINCT FROM OLD.subject_actor_id
     OR NEW.requested_by_actor_id IS DISTINCT FROM OLD.requested_by_actor_id
     OR NEW.chronicle_event_id IS DISTINCT FROM OLD.chronicle_event_id
     OR NEW.reason IS DISTINCT FROM OLD.reason
     OR NEW.evidence_sha256 IS DISTINCT FROM OLD.evidence_sha256
     OR NEW.request_chronicle_event_id IS DISTINCT FROM OLD.request_chronicle_event_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Contribution correction request and evidence are immutable';
  END IF;
  IF OLD.status <> 'pending' OR NEW.status NOT IN ('accepted', 'rejected') THEN
    RAISE EXCEPTION 'A Contribution correction can be reviewed exactly once';
  END IF;
  IF current_actor IS NULL OR NEW.reviewed_by_actor_id <> current_actor THEN
    RAISE EXCEPTION 'The current manager must be recorded as reviewer';
  END IF;
  IF NEW.reviewed_by_actor_id IN (OLD.requested_by_actor_id, OLD.subject_actor_id) THEN
    RAISE EXCEPTION 'A Contribution correction cannot be self-reviewed';
  END IF;
  IF NOT guild_runtime.is_contribution_correction_manager(
    OLD.guild_id,
    NEW.reviewed_by_actor_id,
    OLD.chronicle_event_id
  ) THEN
    RAISE EXCEPTION 'Contribution correction review requires manager authority';
  END IF;
  IF NEW.version <> OLD.version + 1
     OR NEW.review_reason IS NULL
     OR length(btrim(NEW.review_reason)) < 1
     OR NEW.resolution_chronicle_event_id IS NULL THEN
    RAISE EXCEPTION 'Contribution correction review requires reason, audit, and one version increment';
  END IF;
  NEW.reviewed_at := statement_timestamp();
  RETURN NEW;
END;
$$;

CREATE TRIGGER contribution_correction_review_guard
BEFORE INSERT OR UPDATE OR DELETE ON contribution_correction_requests
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_contribution_correction_review();

CREATE FUNCTION guild_runtime.verify_contribution_correction_audit()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  audit_event_id uuid;
  expected_action text;
  expected_details jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    audit_event_id := NEW.request_chronicle_event_id;
    expected_action := 'contribution.correction.requested';
    expected_details := jsonb_build_object(
      'evidenceEventId', NEW.chronicle_event_id::text,
      'evidenceDigest', NEW.evidence_sha256,
      'originalEventPreserved', true
    );
  ELSE
    audit_event_id := NEW.resolution_chronicle_event_id;
    expected_action := 'contribution.correction.' || NEW.status;
    expected_details := jsonb_build_object(
      'evidenceEventId', NEW.chronicle_event_id::text,
      'evidenceDigest', NEW.evidence_sha256,
      'outcome', NEW.status,
      'originalEventPreserved', true
    );
  END IF;

  IF audit_event_id IS NULL OR NOT EXISTS (
    SELECT 1
      FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.id = audit_event_id
       AND event.actor_identity_id = CASE
         WHEN TG_OP = 'INSERT' THEN NEW.requested_by_actor_id
         ELSE NEW.reviewed_by_actor_id
       END
       AND event.action = expected_action
       AND event.subject_type = 'contribution_correction'
       AND event.subject_id = NEW.id
       AND event.details = expected_details
  ) THEN
    RAISE EXCEPTION 'Contribution correction transition requires its targeted Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER contribution_correction_audit
AFTER INSERT OR UPDATE ON contribution_correction_requests
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_contribution_correction_audit();

ALTER TABLE contribution_correction_requests FORCE ROW LEVEL SECURITY;
