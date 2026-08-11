CREATE OR REPLACE FUNCTION guild_runtime.enforce_agent_approval_outcome() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  request_id uuid;
  request_guild_id uuid;
  request_row record;
  approve_count integer;
  reject_count integer;
BEGIN
  IF TG_TABLE_NAME = 'approval_votes' THEN
    IF TG_OP = 'DELETE' THEN
      request_id := OLD.approval_request_id;
      request_guild_id := OLD.guild_id;
    ELSE
      request_id := NEW.approval_request_id;
      request_guild_id := NEW.guild_id;
    END IF;
  ELSE
    IF TG_OP = 'DELETE' THEN
      request_id := OLD.id;
      request_guild_id := OLD.guild_id;
    ELSE
      request_id := NEW.id;
      request_guild_id := NEW.guild_id;
    END IF;
  END IF;

  SELECT * INTO request_row
    FROM approval_requests
   WHERE guild_id = request_guild_id AND id = request_id;
  IF FOUND AND request_row.agent_run_id IS NOT NULL THEN
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
  END IF;

  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
