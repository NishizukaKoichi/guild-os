ALTER TABLE decisions
  DROP CONSTRAINT decisions_required_approvals_check,
  DROP CONSTRAINT decisions_approval_count_check,
  ADD CONSTRAINT decisions_required_approvals_check CHECK (required_approvals > 0),
  ADD CONSTRAINT decisions_approval_count_check CHECK (approval_count >= 0);
