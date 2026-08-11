ALTER TABLE root_ownership_transfers
  DROP CONSTRAINT root_ownership_transfers_state_check;
ALTER TABLE root_ownership_transfers
  ADD CONSTRAINT root_ownership_transfers_state_check
  CHECK (state IN ('pending', 'accepted', 'cancelled', 'expired', 'superseded'));

CREATE TABLE break_glass_code_sets (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  generation integer NOT NULL CHECK (generation > 0),
  created_by_identity_id uuid NOT NULL,
  outgoing_role_id uuid NOT NULL,
  reason text NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 2000 AND reason = btrim(reason)),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, generation),
  FOREIGN KEY (guild_id, created_by_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, outgoing_role_id) REFERENCES roles(guild_id, id),
  CHECK (expires_at >= created_at + interval '7 days'),
  CHECK (expires_at <= created_at + interval '730 days')
);

CREATE TABLE break_glass_codes (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  code_set_id uuid NOT NULL,
  code_hash char(64) NOT NULL CHECK (code_hash ~ '^[a-f0-9]{64}$'),
  code_hint text NOT NULL CHECK (code_hint ~ '^[A-Za-z0-9_-]{6}$'),
  consumed_by_identity_id uuid,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, code_hash),
  UNIQUE (guild_id, code_set_id, id),
  FOREIGN KEY (guild_id, code_set_id) REFERENCES break_glass_code_sets(guild_id, id),
  FOREIGN KEY (guild_id, consumed_by_identity_id) REFERENCES identities(guild_id, id),
  CHECK (
    (consumed_by_identity_id IS NULL AND consumed_at IS NULL)
    OR (consumed_by_identity_id IS NOT NULL AND consumed_at IS NOT NULL)
  )
);

CREATE TABLE break_glass_configurations (
  guild_id uuid PRIMARY KEY REFERENCES guilds(id) ON DELETE RESTRICT,
  current_code_set_id uuid,
  version integer NOT NULL CHECK (version > 0),
  updated_by_identity_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, current_code_set_id) REFERENCES break_glass_code_sets(guild_id, id),
  FOREIGN KEY (guild_id, updated_by_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE break_glass_recoveries (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  code_set_id uuid NOT NULL,
  code_id uuid NOT NULL,
  previous_root_identity_id uuid NOT NULL,
  new_root_identity_id uuid NOT NULL,
  outgoing_role_id uuid NOT NULL,
  reason text NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 2000 AND reason = btrim(reason)),
  actor_was_existing_identity boolean NOT NULL,
  viewed_information text NOT NULL
    CHECK (length(viewed_information) BETWEEN 1 AND 2000),
  changes_made text NOT NULL
    CHECK (length(changes_made) BETWEEN 1 AND 2000),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'completed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, code_set_id, code_id)
    REFERENCES break_glass_codes(guild_id, code_set_id, id),
  FOREIGN KEY (guild_id, previous_root_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, new_root_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, outgoing_role_id) REFERENCES roles(guild_id, id),
  CHECK (previous_root_identity_id <> new_root_identity_id),
  CHECK (
    (state = 'pending' AND completed_at IS NULL)
    OR (state = 'completed' AND completed_at IS NOT NULL)
  )
);

CREATE INDEX break_glass_codes_lookup_idx
  ON break_glass_codes (guild_id, code_hash)
  WHERE consumed_at IS NULL;
CREATE INDEX break_glass_recoveries_history_idx
  ON break_glass_recoveries (guild_id, created_at DESC, id DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'break_glass_code_sets', 'break_glass_codes', 'break_glass_configurations',
    'break_glass_recoveries'
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

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON break_glass_configurations
FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at();

CREATE FUNCTION guild_runtime.reject_break_glass_code_set_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Break Glass code sets are immutable';
END;
$$;

CREATE TRIGGER break_glass_code_set_no_update_or_delete
BEFORE UPDATE OR DELETE ON break_glass_code_sets
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_break_glass_code_set_mutation();

CREATE FUNCTION guild_runtime.enforce_break_glass_code_consumption() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  recovery_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Break Glass codes are append-only';
  END IF;
  IF NEW.guild_id <> OLD.guild_id OR NEW.code_set_id <> OLD.code_set_id
     OR NEW.code_hash <> OLD.code_hash OR NEW.code_hint <> OLD.code_hint
     OR NEW.created_at <> OLD.created_at OR OLD.consumed_at IS NOT NULL
     OR NEW.consumed_at IS NULL OR NEW.consumed_by_identity_id IS NULL THEN
    RAISE EXCEPTION 'Invalid Break Glass code mutation';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  IF actor_identity_id IS NULL OR recovery_id IS NULL
     OR NEW.consumed_by_identity_id <> actor_identity_id
     OR NOT EXISTS (
       SELECT 1 FROM break_glass_recoveries recovery
        WHERE recovery.guild_id = NEW.guild_id AND recovery.id = recovery_id
          AND recovery.code_set_id = NEW.code_set_id AND recovery.code_id = NEW.id
          AND recovery.new_root_identity_id = actor_identity_id
          AND recovery.state = 'pending'
     ) THEN
    RAISE EXCEPTION 'Break Glass code consumption requires its recovery transaction';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER break_glass_code_consumption_guard
BEFORE UPDATE OR DELETE ON break_glass_codes
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_break_glass_code_consumption();

CREATE FUNCTION guild_runtime.enforce_break_glass_recovery_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  recovery_id uuid;
  current_root_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Break Glass recovery history is append-only';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  SELECT root_owner_identity_id INTO current_root_id FROM guilds WHERE id = NEW.guild_id;

  IF TG_OP = 'INSERT' THEN
    IF recovery_id IS NULL OR recovery_id <> NEW.id OR actor_identity_id IS NULL
       OR actor_identity_id <> NEW.new_root_identity_id OR NEW.state <> 'pending'
       OR NEW.completed_at IS NOT NULL OR current_root_id <> NEW.previous_root_identity_id
       OR NOT EXISTS (
         SELECT 1
           FROM break_glass_configurations configuration
           JOIN break_glass_code_sets code_set
             ON code_set.guild_id = configuration.guild_id
            AND code_set.id = configuration.current_code_set_id
           JOIN break_glass_codes code
             ON code.guild_id = code_set.guild_id AND code.code_set_id = code_set.id
          WHERE configuration.guild_id = NEW.guild_id
            AND code_set.id = NEW.code_set_id AND code.id = NEW.code_id
            AND code_set.outgoing_role_id = NEW.outgoing_role_id
            AND code_set.expires_at > now() AND code.consumed_at IS NULL
       ) THEN
      RAISE EXCEPTION 'Break Glass recovery requires a current unconsumed recovery code';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id <> OLD.guild_id OR NEW.code_set_id <> OLD.code_set_id
     OR NEW.code_id <> OLD.code_id
     OR NEW.previous_root_identity_id <> OLD.previous_root_identity_id
     OR NEW.new_root_identity_id <> OLD.new_root_identity_id
     OR NEW.outgoing_role_id <> OLD.outgoing_role_id OR NEW.reason <> OLD.reason
     OR NEW.actor_was_existing_identity <> OLD.actor_was_existing_identity
     OR NEW.viewed_information <> OLD.viewed_information
     OR NEW.changes_made <> OLD.changes_made OR NEW.created_at <> OLD.created_at
     OR OLD.state <> 'pending' OR NEW.state <> 'completed' OR NEW.completed_at IS NULL
     OR actor_identity_id <> NEW.new_root_identity_id
     OR current_root_id <> NEW.new_root_identity_id THEN
    RAISE EXCEPTION 'Invalid Break Glass recovery transition';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER break_glass_recovery_record_guard
BEFORE INSERT OR UPDATE OR DELETE ON break_glass_recoveries
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_break_glass_recovery_record();

CREATE FUNCTION guild_runtime.enforce_break_glass_configuration() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  recovery_id uuid;
  current_root_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Break Glass configuration cannot be deleted';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  SELECT root_owner_identity_id INTO current_root_id FROM guilds WHERE id = NEW.guild_id;

  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.current_code_set_id IS NULL THEN
      RAISE EXCEPTION 'Initial Break Glass configuration requires generation one';
    END IF;
  ELSE
    IF NEW.guild_id <> OLD.guild_id OR NEW.version <> OLD.version + 1
       OR NEW.current_code_set_id IS NOT DISTINCT FROM OLD.current_code_set_id THEN
      RAISE EXCEPTION 'Break Glass configuration must advance exactly one generation';
    END IF;
  END IF;

  IF actor_identity_id IS NULL OR NEW.updated_by_identity_id <> actor_identity_id THEN
    RAISE EXCEPTION 'Break Glass configuration requires an authenticated Human actor';
  END IF;
  IF recovery_id IS NOT NULL THEN
    IF TG_OP <> 'UPDATE' OR NEW.current_code_set_id IS NOT NULL
       OR current_root_id <> actor_identity_id
       OR NOT EXISTS (
         SELECT 1 FROM break_glass_recoveries recovery
          WHERE recovery.guild_id = NEW.guild_id AND recovery.id = recovery_id
            AND recovery.code_set_id = OLD.current_code_set_id
            AND recovery.new_root_identity_id = actor_identity_id
            AND recovery.state = 'pending'
       ) THEN
      RAISE EXCEPTION 'Break Glass recovery did not invalidate its code generation';
    END IF;
  ELSE
    IF current_root_id <> actor_identity_id OR NOT EXISTS (
      SELECT 1
        FROM identities identity_row
        JOIN memberships membership_row
          ON membership_row.guild_id = identity_row.guild_id
         AND membership_row.identity_id = identity_row.id
       WHERE identity_row.guild_id = NEW.guild_id AND identity_row.id = actor_identity_id
         AND identity_row.kind = 'human' AND identity_row.status = 'active'
         AND membership_row.state = 'active'
    ) THEN
      RAISE EXCEPTION 'Only the active human Root Owner can configure Break Glass';
    END IF;
    IF NEW.current_code_set_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM break_glass_code_sets code_set
       WHERE code_set.guild_id = NEW.guild_id AND code_set.id = NEW.current_code_set_id
         AND code_set.generation = NEW.version
         AND code_set.created_by_identity_id = actor_identity_id
         AND code_set.expires_at > now()
    ) THEN
      RAISE EXCEPTION 'Break Glass configuration requires a new matching code generation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER break_glass_configuration_guard
BEFORE INSERT OR UPDATE OR DELETE ON break_glass_configurations
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_break_glass_configuration();

CREATE FUNCTION guild_runtime.verify_break_glass_configuration_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  recovery_id uuid;
  expected_action text;
  expected_subject_id uuid;
BEGIN
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  IF recovery_id IS NOT NULL THEN
    expected_action := 'break_glass.used';
    expected_subject_id := recovery_id;
  ELSIF NEW.current_code_set_id IS NOT NULL THEN
    expected_action := 'break_glass.codes.rotated';
    expected_subject_id := NEW.current_code_set_id;
  ELSE
    expected_action := 'break_glass.codes.revoked';
    expected_subject_id := OLD.current_code_set_id;
  END IF;
  IF expected_subject_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.actor_identity_id = NEW.updated_by_identity_id
       AND event.action = expected_action
       AND event.subject_id = expected_subject_id
  ) THEN
    RAISE EXCEPTION 'Break Glass configuration requires an atomic Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER break_glass_configuration_audit
AFTER INSERT OR UPDATE ON break_glass_configurations
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_break_glass_configuration_audit();

CREATE FUNCTION guild_runtime.verify_break_glass_recovery_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM break_glass_recoveries recovery
      JOIN break_glass_codes code
        ON code.guild_id = recovery.guild_id AND code.id = recovery.code_id
      JOIN break_glass_configurations configuration
        ON configuration.guild_id = recovery.guild_id
      JOIN guilds guild_row ON guild_row.id = recovery.guild_id
     WHERE recovery.guild_id = NEW.guild_id AND recovery.id = NEW.id
       AND recovery.state = 'completed'
       AND code.consumed_by_identity_id = recovery.new_root_identity_id
       AND code.consumed_at IS NOT NULL
       AND configuration.current_code_set_id IS NULL
       AND guild_row.root_owner_identity_id = recovery.new_root_identity_id
       AND EXISTS (
         SELECT 1 FROM chronicle_events event
          WHERE event.guild_id = recovery.guild_id
            AND event.actor_identity_id = recovery.new_root_identity_id
            AND event.action = 'break_glass.used'
            AND event.subject_type = 'break_glass_recovery'
            AND event.subject_id = recovery.id
       )
  ) THEN
    RAISE EXCEPTION 'Break Glass recovery did not complete atomically';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER break_glass_recovery_completed
AFTER INSERT ON break_glass_recoveries
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_break_glass_recovery_completion();

CREATE OR REPLACE FUNCTION guild_runtime.enforce_root_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  transfer_id uuid;
  recovery_id uuid;
BEGIN
  IF NEW.root_owner_identity_id = OLD.root_owner_identity_id THEN
    RETURN NEW;
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  transfer_id := NULLIF(current_setting('app.root_transfer_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;

  IF actor_identity_id IS NULL OR actor_identity_id <> NEW.root_owner_identity_id
     OR ((transfer_id IS NULL) = (recovery_id IS NULL)) THEN
    RAISE EXCEPTION 'Root ownership change requires one authorized governance path';
  END IF;
  IF transfer_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM root_ownership_transfers transfer
      JOIN identities target
        ON target.guild_id = transfer.guild_id AND target.id = transfer.to_identity_id
      JOIN memberships membership
        ON membership.guild_id = target.guild_id AND membership.identity_id = target.id
     WHERE transfer.guild_id = NEW.id AND transfer.id = transfer_id
       AND transfer.state = 'pending' AND transfer.expires_at > now()
       AND transfer.from_identity_id = OLD.root_owner_identity_id
       AND transfer.to_identity_id = NEW.root_owner_identity_id
       AND target.kind = 'human' AND target.status = 'active'
       AND membership.state = 'active'
  ) THEN
    RAISE EXCEPTION 'Root ownership change requires an accepted two-party transfer';
  END IF;
  IF recovery_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
      FROM break_glass_recoveries recovery
      JOIN break_glass_configurations configuration
        ON configuration.guild_id = recovery.guild_id
       AND configuration.current_code_set_id = recovery.code_set_id
      JOIN break_glass_code_sets code_set
        ON code_set.guild_id = recovery.guild_id AND code_set.id = recovery.code_set_id
      JOIN break_glass_codes code
        ON code.guild_id = recovery.guild_id AND code.id = recovery.code_id
      JOIN identities target
        ON target.guild_id = recovery.guild_id AND target.id = recovery.new_root_identity_id
      JOIN memberships membership
        ON membership.guild_id = target.guild_id AND membership.identity_id = target.id
     WHERE recovery.guild_id = NEW.id AND recovery.id = recovery_id
       AND recovery.state = 'pending'
       AND recovery.previous_root_identity_id = OLD.root_owner_identity_id
       AND recovery.new_root_identity_id = NEW.root_owner_identity_id
       AND code_set.expires_at > now() AND code.consumed_at IS NULL
       AND target.kind = 'human' AND target.status = 'active'
       AND membership.state = 'active'
  ) THEN
    RAISE EXCEPTION 'Root ownership change requires a valid Break Glass recovery';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.verify_root_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transfer_id uuid;
  recovery_id uuid;
BEGIN
  IF NEW.root_owner_identity_id = OLD.root_owner_identity_id THEN
    RETURN NEW;
  END IF;
  transfer_id := NULLIF(current_setting('app.root_transfer_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  IF transfer_id IS NOT NULL AND recovery_id IS NULL AND EXISTS (
    SELECT 1 FROM root_ownership_transfers transfer
     WHERE transfer.guild_id = NEW.id AND transfer.id = transfer_id
       AND transfer.state = 'accepted'
       AND transfer.from_identity_id = OLD.root_owner_identity_id
       AND transfer.to_identity_id = NEW.root_owner_identity_id
  ) THEN
    IF EXISTS (
      SELECT 1 FROM break_glass_configurations configuration
       WHERE configuration.guild_id = NEW.id
         AND configuration.current_code_set_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Root ownership change must invalidate existing Break Glass codes';
    END IF;
    RETURN NEW;
  END IF;
  IF recovery_id IS NOT NULL AND transfer_id IS NULL AND EXISTS (
    SELECT 1 FROM break_glass_recoveries recovery
     WHERE recovery.guild_id = NEW.id AND recovery.id = recovery_id
       AND recovery.state = 'completed'
       AND recovery.previous_root_identity_id = OLD.root_owner_identity_id
       AND recovery.new_root_identity_id = NEW.root_owner_identity_id
  ) THEN
    IF EXISTS (
      SELECT 1 FROM break_glass_configurations configuration
       WHERE configuration.guild_id = NEW.id
         AND configuration.current_code_set_id IS NOT NULL
    ) THEN
      RAISE EXCEPTION 'Root ownership change must invalidate existing Break Glass codes';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Root ownership governance path did not finish atomically';
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.enforce_root_ownership_transfer_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  current_root_id uuid;
  recovery_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Root ownership transfer history is append-only';
  END IF;
  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
  SELECT root_owner_identity_id INTO current_root_id FROM guilds WHERE id = NEW.guild_id;

  IF TG_OP = 'INSERT' THEN
    IF actor_identity_id IS NULL OR actor_identity_id <> current_root_id
       OR NEW.from_identity_id <> current_root_id OR NEW.state <> 'pending'
       OR NEW.version <> 1 OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only the current Root Owner can propose an ownership transfer';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM identities i
      JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
      WHERE i.guild_id = NEW.guild_id AND i.id = NEW.to_identity_id
        AND i.kind = 'human' AND i.status = 'active' AND m.state = 'active'
    ) THEN
      RAISE EXCEPTION 'Root ownership can transfer only to an active human member';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id <> OLD.guild_id OR NEW.from_identity_id <> OLD.from_identity_id
     OR NEW.to_identity_id <> OLD.to_identity_id
     OR NEW.outgoing_role_id <> OLD.outgoing_role_id OR NEW.reason <> OLD.reason
     OR NEW.expires_at <> OLD.expires_at OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Root ownership transfer terms are immutable';
  END IF;
  IF OLD.state <> 'pending'
     OR NEW.state NOT IN ('accepted', 'cancelled', 'expired', 'superseded')
     OR NEW.version <> OLD.version + 1 OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'Invalid Root ownership transfer transition';
  END IF;
  IF (NEW.state = 'expired' AND OLD.expires_at > now())
     OR (NEW.state IN ('accepted', 'cancelled') AND OLD.expires_at <= now()) THEN
    RAISE EXCEPTION 'Root ownership transfer state does not match its expiry';
  END IF;
  IF NEW.state = 'superseded' THEN
    IF recovery_id IS NULL OR actor_identity_id IS NULL OR current_root_id <> actor_identity_id
       OR NOT EXISTS (
         SELECT 1 FROM break_glass_recoveries recovery
          WHERE recovery.guild_id = NEW.guild_id AND recovery.id = recovery_id
            AND recovery.previous_root_identity_id = OLD.from_identity_id
            AND recovery.new_root_identity_id = actor_identity_id
            AND recovery.state = 'pending'
       ) THEN
      RAISE EXCEPTION 'Only a valid Break Glass recovery can supersede a pending transfer';
    END IF;
  ELSIF NEW.state = 'accepted' THEN
    IF actor_identity_id IS NULL OR actor_identity_id <> OLD.to_identity_id
       OR current_root_id <> OLD.to_identity_id THEN
      RAISE EXCEPTION 'Only the designated active Human can accept Root ownership';
    END IF;
  ELSE
    IF actor_identity_id IS NULL OR actor_identity_id <> OLD.from_identity_id
       OR current_root_id <> OLD.from_identity_id THEN
      RAISE EXCEPTION 'Only the current Root Owner can close a pending transfer';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.verify_root_ownership_transfer_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_action text;
  expected_actor_id uuid;
  recovery_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    expected_action := 'root_ownership.transfer.proposed';
    expected_actor_id := NEW.from_identity_id;
  ELSE
    expected_action := 'root_ownership.transfer.' || NEW.state;
    IF NEW.state = 'accepted' THEN
      expected_actor_id := NEW.to_identity_id;
    ELSIF NEW.state = 'superseded' THEN
      recovery_id := NULLIF(current_setting('app.break_glass_recovery_id', true), '')::uuid;
      SELECT new_root_identity_id INTO expected_actor_id
        FROM break_glass_recoveries
       WHERE guild_id = NEW.guild_id AND id = recovery_id;
    ELSE
      expected_actor_id := NEW.from_identity_id;
    END IF;
  END IF;
  IF expected_actor_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM chronicle_events event
     WHERE event.guild_id = NEW.guild_id
       AND event.actor_identity_id = expected_actor_id
       AND event.action = expected_action
       AND event.subject_type = 'root_ownership_transfer'
       AND event.subject_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'Root ownership transfer requires an atomic Chronicle event';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION guild_runtime.prevent_pending_transfer_role_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target_guild_id uuid;
  target_role_id uuid;
BEGIN
  target_guild_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.guild_id ELSE NEW.guild_id END;
  target_role_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  IF EXISTS (
    SELECT 1 FROM root_ownership_transfers transfer
     WHERE transfer.guild_id = target_guild_id
       AND transfer.outgoing_role_id = target_role_id
       AND transfer.state = 'pending' AND transfer.expires_at > now()
  ) OR EXISTS (
    SELECT 1
      FROM break_glass_configurations configuration
      JOIN break_glass_code_sets code_set
        ON code_set.guild_id = configuration.guild_id
       AND code_set.id = configuration.current_code_set_id
     WHERE configuration.guild_id = target_guild_id
       AND code_set.outgoing_role_id = target_role_id
       AND code_set.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'A Role in an active ownership or recovery ceremony is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE FUNCTION guild_runtime.is_recovery_role_protected(target_guild_id uuid, target_role_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM root_ownership_transfers transfer
     WHERE transfer.guild_id = target_guild_id
       AND transfer.outgoing_role_id = target_role_id
       AND transfer.state = 'pending' AND transfer.expires_at > now()
  ) OR EXISTS (
    SELECT 1
      FROM break_glass_configurations configuration
      JOIN break_glass_code_sets code_set
        ON code_set.guild_id = configuration.guild_id
       AND code_set.id = configuration.current_code_set_id
     WHERE configuration.guild_id = target_guild_id
       AND code_set.outgoing_role_id = target_role_id
       AND code_set.expires_at > now()
  )
$$;

CREATE OR REPLACE FUNCTION guild_runtime.prevent_pending_transfer_permission_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touches_protected_role boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT guild_runtime.is_recovery_role_protected(NEW.guild_id, NEW.role_id)
      INTO touches_protected_role;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT guild_runtime.is_recovery_role_protected(OLD.guild_id, OLD.role_id)
      INTO touches_protected_role;
  ELSE
    SELECT guild_runtime.is_recovery_role_protected(OLD.guild_id, OLD.role_id)
        OR guild_runtime.is_recovery_role_protected(NEW.guild_id, NEW.role_id)
      INTO touches_protected_role;
  END IF;
  IF touches_protected_role THEN
    RAISE EXCEPTION 'Permissions for a Role in an active ownership or recovery ceremony are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;
