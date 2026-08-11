ALTER TABLE decisions
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN required_approvals integer NOT NULL DEFAULT 1,
  ADD COLUMN approval_count integer NOT NULL DEFAULT 0,
  ADD COLUMN selected_option_id uuid,
  ADD COLUMN decided_at timestamptz,
  ADD COLUMN superseded_by_decision_id uuid;

ALTER TABLE decisions
  ADD CONSTRAINT decisions_superseded_by_fk
    FOREIGN KEY (guild_id, superseded_by_decision_id) REFERENCES decisions(guild_id, id),
  ADD CONSTRAINT decisions_title_check CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  ADD CONSTRAINT decisions_description_check CHECK (length(btrim(description)) BETWEEN 1 AND 10000),
  ADD CONSTRAINT decisions_rationale_check CHECK (length(rationale) <= 10000),
  ADD CONSTRAINT decisions_allowed_limit CHECK (cardinality(allowed_identity_ids) <= 100),
  ADD CONSTRAINT decisions_sources_limit CHECK (cardinality(source_ids) <= 100),
  ADD CONSTRAINT decisions_required_approvals_check CHECK (required_approvals BETWEEN 1 AND 20),
  ADD CONSTRAINT decisions_approval_count_check CHECK (approval_count BETWEEN 0 AND 20),
  ADD CONSTRAINT decisions_terminal_shape_check CHECK (
    (status IN ('approved', 'superseded') AND selected_option_id IS NOT NULL AND decided_at IS NOT NULL)
    OR (status = 'rejected' AND selected_option_id IS NULL AND decided_at IS NOT NULL)
    OR (status IN ('draft', 'proposed') AND selected_option_id IS NULL AND decided_at IS NULL)
  ),
  ADD CONSTRAINT decisions_supersession_shape_check CHECK (
    (status = 'superseded' AND superseded_by_decision_id IS NOT NULL)
    OR (status <> 'superseded' AND superseded_by_decision_id IS NULL)
  );

ALTER TABLE decision_options ADD COLUMN position integer;

WITH ranked AS (
  SELECT guild_id, id,
         row_number() OVER (PARTITION BY guild_id, decision_id ORDER BY id) - 1 AS position
    FROM decision_options
)
UPDATE decision_options option_row
   SET position = ranked.position
  FROM ranked
 WHERE option_row.guild_id = ranked.guild_id AND option_row.id = ranked.id;

ALTER TABLE decision_options
  ALTER COLUMN position SET NOT NULL,
  ADD CONSTRAINT decision_options_position_check CHECK (position BETWEEN 0 AND 19),
  ADD CONSTRAINT decision_options_label_check CHECK (length(btrim(label)) BETWEEN 1 AND 200),
  ADD CONSTRAINT decision_options_description_check CHECK (length(description) <= 5000),
  ADD CONSTRAINT decision_options_unique_position UNIQUE (guild_id, decision_id, position);

ALTER TABLE decisions
  ADD CONSTRAINT decisions_selected_option_fk
    FOREIGN KEY (guild_id, selected_option_id) REFERENCES decision_options(guild_id, id);

ALTER TABLE decision_approvals
  ADD COLUMN selected_option_id uuid,
  ADD CONSTRAINT decision_approvals_selected_option_fk
    FOREIGN KEY (guild_id, selected_option_id) REFERENCES decision_options(guild_id, id),
  ADD CONSTRAINT decision_approvals_reason_check CHECK (length(btrim(reason)) BETWEEN 1 AND 5000),
  ADD CONSTRAINT decision_approvals_option_shape_check CHECK (
    (verdict = 'approve' AND selected_option_id IS NOT NULL)
    OR (verdict = 'reject' AND selected_option_id IS NULL)
  );

CREATE INDEX decisions_recent_idx ON decisions (guild_id, updated_at DESC, id DESC);
CREATE INDEX decision_approvals_result_idx
  ON decision_approvals (guild_id, decision_id, verdict, selected_option_id);

CREATE FUNCTION guild_runtime.enforce_decision_option_mutability() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  parent_guild_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  parent_decision_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.decision_id ELSE NEW.decision_id END;
  parent_status text;
BEGIN
  SELECT status INTO parent_status
    FROM decisions
   WHERE guild_id = parent_guild_id AND id = parent_decision_id
   FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Decision was not found in this Guild'; END IF;
  IF parent_status <> 'draft' THEN
    RAISE EXCEPTION 'Decision options are immutable after proposal';
  END IF;
  IF TG_OP = 'UPDATE' AND (
    OLD.guild_id IS DISTINCT FROM NEW.guild_id
    OR OLD.decision_id IS DISTINCT FROM NEW.decision_id
  ) THEN
    RAISE EXCEPTION 'Decision option parent is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER decision_options_mutability
BEFORE INSERT OR UPDATE OR DELETE ON decision_options
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_option_mutability();

CREATE FUNCTION guild_runtime.enforce_decision_content_lock() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.proposer_identity_id IS DISTINCT FROM NEW.proposer_identity_id
     OR OLD.owner_identity_id IS DISTINCT FROM NEW.owner_identity_id THEN
    RAISE EXCEPTION 'Decision proposer and owner are immutable';
  END IF;
  IF OLD.status <> 'draft' AND (
    OLD.space_id IS DISTINCT FROM NEW.space_id
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

CREATE TRIGGER decisions_content_lock
BEFORE UPDATE ON decisions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_content_lock();

CREATE FUNCTION guild_runtime.enforce_decision_approval() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  decision_row decisions%ROWTYPE;
  approver_allowed boolean := false;
BEGIN
  SELECT * INTO decision_row
    FROM decisions
   WHERE guild_id = NEW.guild_id AND id = NEW.decision_id
   FOR UPDATE;
  IF NOT FOUND OR decision_row.status <> 'proposed' THEN
    RAISE EXCEPTION 'Only a proposed Decision can receive approval';
  END IF;
  IF NEW.verdict = 'approve' AND NOT EXISTS (
    SELECT 1 FROM decision_options option_row
     WHERE option_row.guild_id = NEW.guild_id
       AND option_row.decision_id = NEW.decision_id
       AND option_row.id = NEW.selected_option_id
  ) THEN
    RAISE EXCEPTION 'Decision approval option does not belong to this Decision';
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
       AND CASE decision_row.classification
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
           END <= CASE membership_row.clearance
             WHEN 'public' THEN 0 WHEN 'internal' THEN 1
             WHEN 'confidential' THEN 2 WHEN 'restricted' THEN 3
           END
       AND (decision_row.visibility NOT IN ('private', 'restricted')
         OR decision_row.owner_identity_id = NEW.approver_identity_id
         OR NEW.approver_identity_id = ANY(decision_row.allowed_identity_ids))
       AND (
         guild_row.root_owner_identity_id = NEW.approver_identity_id
         OR EXISTS (
           SELECT 1 FROM role_bindings binding_row
           JOIN role_permissions permission_row
             ON permission_row.guild_id = binding_row.guild_id
            AND permission_row.role_id = binding_row.role_id
          WHERE binding_row.guild_id = NEW.guild_id
            AND binding_row.identity_id = NEW.approver_identity_id
            AND permission_row.permission = 'decision.approve'
            AND (
              binding_row.space_id IS NULL
              OR decision_row.space_id IS NOT NULL
                 AND guild_runtime.space_contains(
                   NEW.guild_id,
                   binding_row.space_id,
                   decision_row.space_id
                 )
            )
         )
       )
  ) INTO approver_allowed;
  IF NOT approver_allowed THEN
    RAISE EXCEPTION 'Decision approval requires an authorized active Human';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER decision_approvals_integrity
BEFORE INSERT ON decision_approvals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_approval();

CREATE FUNCTION guild_runtime.reject_decision_approval_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Decision approvals are append-only';
END;
$$;

CREATE TRIGGER decision_approvals_no_update_or_delete
BEFORE UPDATE OR DELETE ON decision_approvals
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_decision_approval_mutation();

CREATE FUNCTION guild_runtime.enforce_decision_transition() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  allowed boolean := false;
  matching_approvals integer := 0;
BEGIN
  IF OLD.status = NEW.status THEN RETURN NEW; END IF;
  allowed := (OLD.status = 'draft' AND NEW.status = 'proposed')
    OR (OLD.status = 'proposed' AND NEW.status IN ('approved', 'rejected'))
    OR (OLD.status = 'approved' AND NEW.status = 'superseded');
  IF NOT allowed THEN
    RAISE EXCEPTION 'Invalid Decision status transition from % to %', OLD.status, NEW.status;
  END IF;
  IF NEW.status = 'proposed' AND (
    SELECT count(*) FROM decision_options option_row
     WHERE option_row.guild_id = NEW.guild_id AND option_row.decision_id = NEW.id
  ) NOT BETWEEN 2 AND 20 THEN
    RAISE EXCEPTION 'A proposed Decision requires between 2 and 20 options';
  END IF;
  IF NEW.status = 'approved' THEN
    IF NOT EXISTS (
      SELECT 1 FROM decision_options option_row
       WHERE option_row.guild_id = NEW.guild_id
         AND option_row.decision_id = NEW.id
         AND option_row.id = NEW.selected_option_id
    ) THEN
      RAISE EXCEPTION 'Selected option does not belong to this Decision';
    END IF;
    SELECT count(*) INTO matching_approvals
      FROM decision_approvals approval_row
     WHERE approval_row.guild_id = NEW.guild_id
       AND approval_row.decision_id = NEW.id
       AND approval_row.verdict = 'approve'
       AND approval_row.selected_option_id = NEW.selected_option_id;
    IF matching_approvals < NEW.required_approvals THEN
      RAISE EXCEPTION 'Decision approval quorum has not been reached';
    END IF;
  ELSIF NEW.status = 'rejected' AND NOT EXISTS (
    SELECT 1 FROM decision_approvals approval_row
     WHERE approval_row.guild_id = NEW.guild_id
       AND approval_row.decision_id = NEW.id
       AND approval_row.verdict = 'reject'
  ) THEN
    RAISE EXCEPTION 'A rejected Decision requires a recorded rejection';
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

CREATE TRIGGER decisions_status_transition
BEFORE UPDATE OF status ON decisions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_transition();

CREATE FUNCTION guild_runtime.enforce_decision_version() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (to_jsonb(OLD) - 'version' - 'updated_at') IS DISTINCT FROM
     (to_jsonb(NEW) - 'version' - 'updated_at') THEN
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Decision version must increment exactly once';
    END IF;
  ELSIF NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Decision version cannot change without a material update';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER decisions_version_integrity
BEFORE UPDATE ON decisions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_version();
