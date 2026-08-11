CREATE FUNCTION guild_runtime.enforce_decision_terminal_integrity() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  replacement decisions%ROWTYPE;
BEGIN
  IF OLD.status IN ('approved', 'rejected', 'superseded') AND (
    OLD.approval_count IS DISTINCT FROM NEW.approval_count
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

CREATE TRIGGER decisions_terminal_integrity
BEFORE UPDATE ON decisions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_decision_terminal_integrity();
