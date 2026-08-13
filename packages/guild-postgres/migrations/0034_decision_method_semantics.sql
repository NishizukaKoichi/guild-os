-- Freeze the electorate and governing policy when a Decision is proposed, then
-- enforce method-specific outcomes in the database as well as the application.

ALTER TABLE decisions
  ADD COLUMN participation_count integer NOT NULL DEFAULT 0
    CHECK (participation_count >= 0);

CREATE TABLE decision_participant_snapshots (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL,
  identity_id uuid NOT NULL,
  is_custodian boolean NOT NULL DEFAULT false,
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, decision_id, identity_id),
  FOREIGN KEY (guild_id, decision_id) REFERENCES decisions(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id) ON DELETE RESTRICT
);

CREATE TABLE decision_method_snapshots (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  decision_id uuid NOT NULL,
  method text NOT NULL CHECK (method IN (
    'custodian', 'consent', 'vote', 'review', 'editorial', 'policy', 'hybrid'
  )),
  constitution_version integer NOT NULL CHECK (constitution_version > 0),
  required_participation integer NOT NULL CHECK (required_participation > 0),
  eligible_participant_count integer NOT NULL CHECK (eligible_participant_count > 0),
  policy_gate_passed boolean NOT NULL,
  policy_evidence jsonb NOT NULL CHECK (jsonb_typeof(policy_evidence) = 'object'),
  captured_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, decision_id),
  FOREIGN KEY (guild_id, decision_id) REFERENCES decisions(guild_id, id) ON DELETE RESTRICT
);

CREATE INDEX decision_participant_identity_idx
  ON decision_participant_snapshots (guild_id, identity_id, decision_id);

-- Preserve in-flight Decisions during upgrade. Legacy proposed Decisions retain
-- their existing threshold; only participation by a captured eligible Human can
-- affect their outcome after this migration.
INSERT INTO decision_participant_snapshots (
  guild_id, decision_id, identity_id, is_custodian, captured_at
)
SELECT decision_row.guild_id, decision_row.id, identity_row.id,
       identity_row.id = decision_row.owner_identity_id, now()
  FROM decisions decision_row
  JOIN identities identity_row
    ON identity_row.guild_id = decision_row.guild_id
  JOIN memberships membership_row
    ON membership_row.guild_id = identity_row.guild_id
   AND membership_row.identity_id = identity_row.id
  JOIN guilds guild_row ON guild_row.id = decision_row.guild_id
 WHERE decision_row.status = 'proposed'
   AND decision_row.method NOT IN ('custodian', 'editorial')
   AND identity_row.kind = 'human'
   AND identity_row.status = 'active'
   AND membership_row.state = 'active'
   AND CASE decision_row.classification
         WHEN 'public' THEN 0 WHEN 'internal' THEN 1
         WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
       END <= CASE membership_row.clearance
         WHEN 'public' THEN 0 WHEN 'internal' THEN 1
         WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
       END
   AND (decision_row.visibility NOT IN ('private', 'restricted')
     OR decision_row.owner_identity_id = identity_row.id
     OR identity_row.id = ANY(decision_row.allowed_identity_ids))
   AND (
     guild_row.root_owner_identity_id = identity_row.id
     OR EXISTS (
       SELECT 1
         FROM role_bindings binding_row
         JOIN role_permissions permission_row
           ON permission_row.guild_id = binding_row.guild_id
          AND permission_row.role_id = binding_row.role_id
        WHERE binding_row.guild_id = identity_row.guild_id
          AND binding_row.identity_id = identity_row.id
          AND permission_row.permission = 'decision.approve'
          AND (binding_row.space_id IS NULL
            OR decision_row.space_id IS NOT NULL
               AND guild_runtime.space_contains(
                 decision_row.guild_id,
                 binding_row.space_id,
                 decision_row.space_id
               ))
     )
   )
ON CONFLICT DO NOTHING;

INSERT INTO decision_participant_snapshots (
  guild_id, decision_id, identity_id, is_custodian, captured_at
)
SELECT decision_row.guild_id, decision_row.id, identity_row.id, true, now()
  FROM decisions decision_row
  JOIN identities identity_row
    ON identity_row.guild_id = decision_row.guild_id
   AND identity_row.id = decision_row.owner_identity_id
  JOIN memberships membership_row
    ON membership_row.guild_id = identity_row.guild_id
   AND membership_row.identity_id = identity_row.id
 WHERE decision_row.status = 'proposed'
   AND decision_row.method IN ('custodian', 'editorial')
   AND identity_row.kind = 'human'
   AND identity_row.status = 'active'
   AND membership_row.state = 'active'
   AND CASE decision_row.classification
         WHEN 'public' THEN 0 WHEN 'internal' THEN 1
         WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
       END <= CASE membership_row.clearance
         WHEN 'public' THEN 0 WHEN 'internal' THEN 1
         WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
       END
ON CONFLICT DO NOTHING;

INSERT INTO decision_method_snapshots (
  guild_id, decision_id, method, constitution_version,
  required_participation, eligible_participant_count,
  policy_gate_passed, policy_evidence, captured_at
)
SELECT decision_row.guild_id, decision_row.id, decision_row.method,
       constitution_row.version, decision_row.required_approvals,
       participant_count.count, true,
       jsonb_build_object(
         'migration', 'legacy-proposed-decision',
         'sourceCount', cardinality(decision_row.source_ids),
         'rationalePresent', length(btrim(decision_row.rationale)) > 0
       ),
       now()
  FROM decisions decision_row
  JOIN constitutions constitution_row
    ON constitution_row.guild_id = decision_row.guild_id
  JOIN LATERAL (
    SELECT count(*)::integer AS count
      FROM decision_participant_snapshots participant_row
     WHERE participant_row.guild_id = decision_row.guild_id
       AND participant_row.decision_id = decision_row.id
  ) participant_count ON participant_count.count > 0
 WHERE decision_row.status = 'proposed'
ON CONFLICT DO NOTHING;

CREATE FUNCTION guild_runtime.reject_decision_snapshot_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Decision governance snapshots are append-only';
END;
$$;

CREATE TRIGGER decision_participant_snapshots_append_only
BEFORE UPDATE OR DELETE ON decision_participant_snapshots
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_decision_snapshot_mutation();

CREATE TRIGGER decision_method_snapshots_append_only
BEFORE UPDATE OR DELETE ON decision_method_snapshots
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_decision_snapshot_mutation();

CREATE FUNCTION guild_runtime.enforce_decision_snapshot_insert() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM decisions decision_row
     WHERE decision_row.guild_id = NEW.guild_id
       AND decision_row.id = NEW.decision_id
       AND decision_row.status = 'draft'
  ) THEN
    RAISE EXCEPTION 'Decision governance can be captured only while the Decision is a draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER decision_participant_snapshot_insert_guard
BEFORE INSERT ON decision_participant_snapshots
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_snapshot_insert();

CREATE TRIGGER decision_method_snapshot_insert_guard
BEFORE INSERT ON decision_method_snapshots
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_snapshot_insert();

CREATE FUNCTION guild_runtime.evaluate_decision_resolution(
  target_guild_id uuid,
  target_decision_id uuid
) RETURNS TABLE (
  resolution_status text,
  resolution_option_id uuid,
  approval_count integer,
  participation_count integer,
  rejection_count integer,
  matching_count integer,
  eligible_count integer,
  policy_gate_passed boolean,
  resolution_reason text
)
LANGUAGE plpgsql STABLE AS $$
DECLARE
  decision_row decisions%ROWTYPE;
  snapshot_row decision_method_snapshots%ROWTYPE;
  total_approvals integer := 0;
  total_participation integer := 0;
  total_rejections integer := 0;
  leading_option_id uuid;
  leading_count integer := 0;
  distinct_approved_options integer := 0;
  remaining_participants integer := 0;
  computed_status text := 'proposed';
  computed_option_id uuid := NULL;
  computed_reason text := 'awaiting_participation';
BEGIN
  SELECT * INTO decision_row
    FROM decisions decision_value
   WHERE decision_value.guild_id = target_guild_id
     AND decision_value.id = target_decision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decision was not found in this Guild'; END IF;

  SELECT * INTO snapshot_row
    FROM decision_method_snapshots snapshot_value
   WHERE snapshot_value.guild_id = target_guild_id
     AND snapshot_value.decision_id = target_decision_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decision method snapshot is missing'; END IF;

  SELECT count(*) FILTER (WHERE approval_row.verdict = 'approve')::integer,
         count(*)::integer,
         count(*) FILTER (WHERE approval_row.verdict = 'reject')::integer,
         count(DISTINCT approval_row.selected_option_id)
           FILTER (WHERE approval_row.verdict = 'approve')::integer
    INTO total_approvals, total_participation, total_rejections, distinct_approved_options
    FROM decision_approvals approval_row
    JOIN decision_participant_snapshots participant_row
      ON participant_row.guild_id = approval_row.guild_id
     AND participant_row.decision_id = approval_row.decision_id
     AND participant_row.identity_id = approval_row.approver_identity_id
   WHERE approval_row.guild_id = target_guild_id
     AND approval_row.decision_id = target_decision_id;

  SELECT option_row.id, count(approval_row.approver_identity_id)::integer
    INTO leading_option_id, leading_count
    FROM decision_options option_row
    LEFT JOIN decision_approvals approval_row
      ON approval_row.guild_id = option_row.guild_id
     AND approval_row.decision_id = option_row.decision_id
     AND approval_row.selected_option_id = option_row.id
     AND approval_row.verdict = 'approve'
    LEFT JOIN decision_participant_snapshots participant_row
      ON participant_row.guild_id = approval_row.guild_id
     AND participant_row.decision_id = approval_row.decision_id
     AND participant_row.identity_id = approval_row.approver_identity_id
   WHERE option_row.guild_id = target_guild_id
     AND option_row.decision_id = target_decision_id
   GROUP BY option_row.id, option_row.position
   ORDER BY count(participant_row.identity_id) DESC, option_row.position, option_row.id
   LIMIT 1;

  -- The tally above must ignore any legacy row that is not part of the captured electorate.
  SELECT count(*)::integer INTO leading_count
    FROM decision_approvals approval_row
    JOIN decision_participant_snapshots participant_row
      ON participant_row.guild_id = approval_row.guild_id
     AND participant_row.decision_id = approval_row.decision_id
     AND participant_row.identity_id = approval_row.approver_identity_id
   WHERE approval_row.guild_id = target_guild_id
     AND approval_row.decision_id = target_decision_id
     AND approval_row.verdict = 'approve'
     AND approval_row.selected_option_id = leading_option_id;

  remaining_participants := GREATEST(
    snapshot_row.eligible_participant_count - total_participation,
    0
  );

  CASE decision_row.method
    WHEN 'custodian' THEN
      IF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := 'custodian_rejected';
      ELSIF leading_count >= 1 THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'custodian_selected';
      ELSE
        computed_reason := 'awaiting_custodian';
      END IF;
    WHEN 'consent' THEN
      IF total_participation >= snapshot_row.required_participation THEN
        IF total_rejections > 0 THEN
          computed_status := 'rejected';
          computed_reason := 'unresolved_objection';
        ELSIF distinct_approved_options = 1
              AND leading_count = total_participation THEN
          computed_status := 'approved';
          computed_option_id := leading_option_id;
          computed_reason := 'consent_reached';
        ELSE
          computed_status := 'rejected';
          computed_reason := 'consent_not_unanimous';
        END IF;
      ELSE
        computed_reason := CASE WHEN total_rejections > 0
          THEN 'objection_pending_required_participation'
          ELSE 'awaiting_required_participation' END;
      END IF;
    WHEN 'vote' THEN
      IF leading_count >= snapshot_row.required_participation THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'vote_threshold_reached';
      ELSIF total_participation >= snapshot_row.eligible_participant_count
            OR leading_count + remaining_participants < snapshot_row.required_participation THEN
        computed_status := 'rejected';
        computed_reason := 'vote_threshold_unreachable';
      ELSE
        computed_reason := 'awaiting_votes';
      END IF;
    WHEN 'review' THEN
      IF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := 'blocking_review_rejection';
      ELSIF leading_count >= snapshot_row.required_participation THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'review_approval_threshold_reached';
      ELSE
        computed_reason := 'awaiting_reviews';
      END IF;
    WHEN 'editorial' THEN
      IF NOT snapshot_row.policy_gate_passed THEN
        computed_reason := 'editorial_evidence_gate_failed';
      ELSIF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := 'editor_rejected';
      ELSIF leading_count >= 1 THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'editor_finalized_after_evidence';
      ELSE
        computed_reason := 'awaiting_editor';
      END IF;
    WHEN 'policy' THEN
      IF NOT snapshot_row.policy_gate_passed THEN
        computed_reason := 'policy_gate_failed';
      ELSIF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := 'human_evidence_rejected';
      ELSIF leading_count >= 1 THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'policy_gate_and_human_evidence_passed';
      ELSE
        computed_reason := 'awaiting_human_evidence';
      END IF;
    WHEN 'hybrid' THEN
      IF NOT snapshot_row.policy_gate_passed THEN
        computed_reason := 'policy_gate_failed';
      ELSIF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := 'hybrid_human_rejection';
      ELSIF leading_count >= snapshot_row.required_participation THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := 'policy_gate_and_human_quorum_passed';
      ELSE
        computed_reason := 'awaiting_human_quorum';
      END IF;
  END CASE;

  RETURN QUERY SELECT computed_status, computed_option_id, total_approvals,
    total_participation, total_rejections, leading_count,
    snapshot_row.eligible_participant_count, snapshot_row.policy_gate_passed,
    computed_reason;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enforce_decision_content_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.proposer_identity_id IS DISTINCT FROM NEW.proposer_identity_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id THEN
    RAISE EXCEPTION 'Decision proposer and owner are immutable';
  END IF;
  IF OLD.status <> 'draft' AND (
    OLD.method IS DISTINCT FROM NEW.method
    OR OLD.space_id IS DISTINCT FROM NEW.space_id
    OR OLD.title IS DISTINCT FROM NEW.title
    OR OLD.description IS DISTINCT FROM NEW.description
    OR OLD.rationale IS DISTINCT FROM NEW.rationale
    OR OLD.review_at IS DISTINCT FROM NEW.review_at
    OR OLD.visibility IS DISTINCT FROM NEW.visibility
    OR OLD.classification IS DISTINCT FROM NEW.classification
    OR OLD.allowed_identity_ids IS DISTINCT FROM NEW.allowed_identity_ids
    OR OLD.source_ids IS DISTINCT FROM NEW.source_ids
    OR OLD.required_approvals IS DISTINCT FROM NEW.required_approvals
  ) THEN
    RAISE EXCEPTION 'Decision content is immutable after proposal';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enforce_decision_terminal_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  replacement decisions%ROWTYPE;
BEGIN
  IF OLD.status IN ('approved', 'rejected', 'superseded') AND (
    OLD.approval_count IS DISTINCT FROM NEW.approval_count
    OR OLD.participation_count IS DISTINCT FROM NEW.participation_count
    OR OLD.selected_option_id IS DISTINCT FROM NEW.selected_option_id
    OR OLD.decided_at IS DISTINCT FROM NEW.decided_at
    OR OLD.superseded_by_decision_id IS DISTINCT FROM NEW.superseded_by_decision_id
       AND NOT (
         OLD.status = 'approved' AND NEW.status = 'superseded'
         AND OLD.superseded_by_decision_id IS NULL
         AND NEW.superseded_by_decision_id IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'A terminal Decision result is immutable';
  END IF;

  IF OLD.status = 'approved' AND NEW.status = 'superseded' THEN
    SELECT * INTO replacement
      FROM decisions
     WHERE guild_id = NEW.guild_id AND id = NEW.superseded_by_decision_id;
    IF NOT FOUND
       OR replacement.space_id IS DISTINCT FROM NEW.space_id
       OR replacement.visibility IS DISTINCT FROM NEW.visibility
       OR replacement.classification IS DISTINCT FROM NEW.classification
       OR NOT (
         replacement.allowed_identity_ids @> NEW.allowed_identity_ids
         AND replacement.allowed_identity_ids <@ NEW.allowed_identity_ids
       ) THEN
      RAISE EXCEPTION 'A replacement Decision must preserve the original security boundary';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enforce_decision_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  decision_row decisions%ROWTYPE;
  participant_row decision_participant_snapshots%ROWTYPE;
  currently_authorized boolean := false;
BEGIN
  SELECT * INTO decision_row
    FROM decisions
   WHERE guild_id = NEW.guild_id AND id = NEW.decision_id
   FOR UPDATE;
  IF NOT FOUND OR decision_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'Only a proposed Decision can receive participation';
  END IF;
  IF NEW.verdict = 'approve' AND NOT EXISTS (
    SELECT 1 FROM decision_options option_row
     WHERE option_row.guild_id = NEW.guild_id
       AND option_row.decision_id = NEW.decision_id
       AND option_row.id = NEW.selected_option_id
  ) THEN
    RAISE EXCEPTION 'Decision approval option does not belong to this Decision';
  END IF;

  SELECT * INTO participant_row
    FROM decision_participant_snapshots snapshot_row
   WHERE snapshot_row.guild_id = NEW.guild_id
     AND snapshot_row.decision_id = NEW.decision_id
     AND snapshot_row.identity_id = NEW.approver_identity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Decision participation requires an authorized active Human captured at proposal';
  END IF;
  IF decision_row.method IN ('custodian', 'editorial')
     AND NOT participant_row.is_custodian THEN
    RAISE EXCEPTION 'Only the designated Decision custodian can finalize this method';
  END IF;

  SELECT EXISTS (
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
       AND (
         decision_row.method IN ('custodian', 'editorial')
           AND participant_row.is_custodian
         OR guild_row.root_owner_identity_id = identity_row.id
         OR EXISTS (
           SELECT 1 FROM role_bindings binding_row
           JOIN role_permissions permission_row
             ON permission_row.guild_id = binding_row.guild_id
            AND permission_row.role_id = binding_row.role_id
          WHERE binding_row.guild_id = identity_row.guild_id
            AND binding_row.identity_id = identity_row.id
            AND permission_row.permission = 'decision.approve'
            AND (binding_row.space_id IS NULL
              OR decision_row.space_id IS NOT NULL
                 AND guild_runtime.space_contains(
                   NEW.guild_id,
                   binding_row.space_id,
                   decision_row.space_id
                 ))
         )
       )
  ) INTO currently_authorized;
  IF NOT currently_authorized THEN
    RAISE EXCEPTION 'Decision participation requires an authorized active Human';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enforce_decision_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed boolean := false;
  option_count integer := 0;
  participant_count integer := 0;
  custodian_count integer := 0;
  constitution_row constitutions%ROWTYPE;
  snapshot_row decision_method_snapshots%ROWTYPE;
  evaluation record;
  minimum_hybrid_quorum integer := 1;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  allowed := (OLD.status = 'draft' AND NEW.status = 'proposed')
    OR (OLD.status = 'proposed' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'superseded');
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Decision status transition from % to %', OLD.status, NEW.status;
  END IF;

  IF NEW.status = 'proposed' THEN
    SELECT count(*)::integer INTO option_count
      FROM decision_options option_row
     WHERE option_row.guild_id = NEW.guild_id AND option_row.decision_id = NEW.id;
    IF option_count NOT BETWEEN 2 AND 20 THEN
      RAISE EXCEPTION 'A proposed Decision requires between 2 and 20 options';
    END IF;

    SELECT * INTO snapshot_row
      FROM decision_method_snapshots snapshot_value
     WHERE snapshot_value.guild_id = NEW.guild_id
       AND snapshot_value.decision_id = NEW.id;
    IF NOT FOUND
       OR snapshot_row.method <> NEW.method
       OR snapshot_row.required_participation <> NEW.required_approvals THEN
      RAISE EXCEPTION 'Decision method governance was not captured consistently';
    END IF;

    SELECT count(*)::integer,
           count(*) FILTER (WHERE is_custodian)::integer
      INTO participant_count, custodian_count
      FROM decision_participant_snapshots participant_row
     WHERE participant_row.guild_id = NEW.guild_id
       AND participant_row.decision_id = NEW.id;
    IF participant_count <> snapshot_row.eligible_participant_count
       OR participant_count < NEW.required_approvals THEN
      RAISE EXCEPTION 'Decision participation threshold exceeds the captured electorate';
    END IF;
    IF NEW.method IN ('custodian', 'editorial') AND custodian_count <> 1 THEN
      RAISE EXCEPTION 'Decision requires exactly one designated active Human custodian';
    END IF;

    SELECT * INTO constitution_row FROM constitutions WHERE guild_id = NEW.guild_id;
    minimum_hybrid_quorum := CASE WHEN NEW.classification = 'restricted'
      THEN constitution_row.level3_approval_quorum
      ELSE constitution_row.level2_approval_quorum END;
    IF snapshot_row.constitution_version <> constitution_row.version THEN
      RAISE EXCEPTION 'Decision Constitution changed while governance was being captured';
    END IF;
    IF NEW.method IN ('custodian', 'editorial', 'policy')
       AND NEW.required_approvals <> 1 THEN
      RAISE EXCEPTION 'This Decision method requires exactly one Human finalizer';
    END IF;
    IF NEW.method = 'hybrid' AND NEW.required_approvals < minimum_hybrid_quorum THEN
      RAISE EXCEPTION 'Hybrid Decision quorum is below the Constitution requirement';
    END IF;
    IF NEW.method IN ('editorial', 'policy', 'hybrid') AND (
      cardinality(NEW.source_ids) = 0
      OR length(btrim(NEW.rationale)) = 0
      OR NOT snapshot_row.policy_gate_passed
    ) THEN
      RAISE EXCEPTION 'Decision evidence policy gate has not passed';
    END IF;
  ELSIF NEW.status IN ('approved', 'rejected') THEN
    SELECT * INTO evaluation
      FROM guild_runtime.evaluate_decision_resolution(NEW.guild_id, NEW.id);
    IF evaluation.resolution_status <> NEW.status THEN
      RAISE EXCEPTION 'Decision approval quorum has not been reached for method % (%).',
        NEW.method, evaluation.resolution_reason;
    END IF;
    IF NEW.status = 'approved'
       AND evaluation.resolution_option_id IS DISTINCT FROM NEW.selected_option_id THEN
      RAISE EXCEPTION 'Decision selected option does not match the method result';
    END IF;
    IF NEW.approval_count <> evaluation.approval_count THEN
      RAISE EXCEPTION 'Decision approval count does not match recorded participation';
    END IF;
    IF NEW.participation_count <> evaluation.participation_count THEN
      RAISE EXCEPTION 'Decision participation count does not match recorded participation';
    END IF;
  ELSIF NEW.status = 'superseded' AND (
    NEW.superseded_by_decision_id = NEW.id OR NOT EXISTS (
      SELECT 1 FROM decisions replacement
       WHERE replacement.guild_id = NEW.guild_id
         AND replacement.id = NEW.superseded_by_decision_id
         AND replacement.status = 'approved'
    )
  ) THEN
    RAISE EXCEPTION 'A Decision can be superseded only by another approved Decision';
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'decision_participant_snapshots', 'decision_method_snapshots'
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
