-- Add the remaining first-class governance methods while preserving the proven
-- resolution engines. New methods map to an explicit safe engine; Custom is
-- fail-closed behind evidence plus the Constitution quorum.

ALTER TABLE decisions
  DROP CONSTRAINT decisions_method_check,
  ADD CONSTRAINT decisions_method_check CHECK (method IN (
    'custodian', 'consent', 'vote', 'review', 'editorial', 'policy', 'hybrid',
    'quorum_vote', 'council', 'agent_proposal_human_approval', 'custom'
  ));

ALTER TABLE decision_method_snapshots
  DROP CONSTRAINT decision_method_snapshots_method_check,
  ADD CONSTRAINT decision_method_snapshots_method_check CHECK (method IN (
    'custodian', 'consent', 'vote', 'review', 'editorial', 'policy', 'hybrid',
    'quorum_vote', 'council', 'agent_proposal_human_approval', 'custom'
  ));

CREATE OR REPLACE FUNCTION guild_runtime.evaluate_decision_resolution(
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
  effective_method text;
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

  effective_method := CASE decision_row.method
    WHEN 'quorum_vote' THEN 'vote'
    WHEN 'council' THEN 'review'
    WHEN 'agent_proposal_human_approval' THEN 'policy'
    WHEN 'custom' THEN 'hybrid'
    ELSE decision_row.method
  END;

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

  CASE effective_method
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
        ELSIF distinct_approved_options = 1 AND leading_count = total_participation THEN
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
        computed_reason := CASE WHEN decision_row.method = 'quorum_vote'
          THEN 'quorum_vote_threshold_reached' ELSE 'vote_threshold_reached' END;
      ELSIF total_participation >= snapshot_row.eligible_participant_count
            OR leading_count + remaining_participants < snapshot_row.required_participation THEN
        computed_status := 'rejected';
        computed_reason := CASE WHEN decision_row.method = 'quorum_vote'
          THEN 'quorum_vote_threshold_unreachable' ELSE 'vote_threshold_unreachable' END;
      ELSE
        computed_reason := CASE WHEN decision_row.method = 'quorum_vote'
          THEN 'awaiting_quorum_votes' ELSE 'awaiting_votes' END;
      END IF;
    WHEN 'review' THEN
      IF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := CASE WHEN decision_row.method = 'council'
          THEN 'council_blocking_rejection' ELSE 'blocking_review_rejection' END;
      ELSIF leading_count >= snapshot_row.required_participation THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := CASE WHEN decision_row.method = 'council'
          THEN 'council_quorum_reached' ELSE 'review_approval_threshold_reached' END;
      ELSE
        computed_reason := CASE WHEN decision_row.method = 'council'
          THEN 'awaiting_council' ELSE 'awaiting_reviews' END;
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
        computed_reason := CASE WHEN decision_row.method = 'agent_proposal_human_approval'
          THEN 'agent_proposal_human_rejection' ELSE 'human_evidence_rejected' END;
      ELSIF leading_count >= 1 THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := CASE WHEN decision_row.method = 'agent_proposal_human_approval'
          THEN 'agent_proposal_human_approved' ELSE 'policy_gate_and_human_evidence_passed' END;
      ELSE
        computed_reason := CASE WHEN decision_row.method = 'agent_proposal_human_approval'
          THEN 'awaiting_agent_proposal_human_approval' ELSE 'awaiting_human_evidence' END;
      END IF;
    WHEN 'hybrid' THEN
      IF NOT snapshot_row.policy_gate_passed THEN
        computed_reason := 'policy_gate_failed';
      ELSIF total_rejections > 0 THEN
        computed_status := 'rejected';
        computed_reason := CASE WHEN decision_row.method = 'custom'
          THEN 'custom_governance_rejection' ELSE 'hybrid_human_rejection' END;
      ELSIF leading_count >= snapshot_row.required_participation THEN
        computed_status := 'approved';
        computed_option_id := leading_option_id;
        computed_reason := CASE WHEN decision_row.method = 'custom'
          THEN 'custom_evidence_and_quorum_passed' ELSE 'policy_gate_and_human_quorum_passed' END;
      ELSE
        computed_reason := CASE WHEN decision_row.method = 'custom'
          THEN 'awaiting_custom_governance_quorum' ELSE 'awaiting_human_quorum' END;
      END IF;
  END CASE;

  RETURN QUERY SELECT computed_status, computed_option_id, total_approvals,
    total_participation, total_rejections, leading_count,
    snapshot_row.eligible_participant_count, snapshot_row.policy_gate_passed,
    computed_reason;
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
  effective_method text;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  allowed := (OLD.status = 'draft' AND NEW.status = 'proposed')
    OR (OLD.status = 'proposed' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'superseded');
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Decision status transition from % to %', OLD.status, NEW.status;
  END IF;

  effective_method := CASE NEW.method
    WHEN 'quorum_vote' THEN 'vote'
    WHEN 'council' THEN 'review'
    WHEN 'agent_proposal_human_approval' THEN 'policy'
    WHEN 'custom' THEN 'hybrid'
    ELSE NEW.method
  END;

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
    IF effective_method IN ('custodian', 'editorial') AND custodian_count <> 1 THEN
      RAISE EXCEPTION 'Decision requires exactly one designated active Human custodian';
    END IF;

    SELECT * INTO constitution_row FROM constitutions WHERE guild_id = NEW.guild_id;
    minimum_hybrid_quorum := CASE WHEN NEW.classification = 'restricted'
      THEN constitution_row.level3_approval_quorum
      ELSE constitution_row.level2_approval_quorum END;
    IF snapshot_row.constitution_version <> constitution_row.version THEN
      RAISE EXCEPTION 'Decision Constitution changed while governance was being captured';
    END IF;
    IF effective_method IN ('custodian', 'editorial', 'policy')
       AND NEW.required_approvals <> 1 THEN
      RAISE EXCEPTION 'This Decision method requires exactly one Human finalizer';
    END IF;
    IF NEW.method IN ('hybrid', 'quorum_vote', 'council', 'custom')
       AND NEW.required_approvals < minimum_hybrid_quorum THEN
      RAISE EXCEPTION 'Decision quorum is below the Constitution requirement';
    END IF;
    IF NEW.method IN (
      'editorial', 'policy', 'hybrid', 'agent_proposal_human_approval', 'custom'
    ) AND (
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
