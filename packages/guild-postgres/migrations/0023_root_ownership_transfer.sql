CREATE TABLE root_ownership_transfers (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  from_identity_id uuid NOT NULL,
  to_identity_id uuid NOT NULL,
  outgoing_role_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'pending'
    CHECK (state IN ('pending', 'accepted', 'cancelled', 'expired')),
  reason text NOT NULL
    CHECK (length(reason) BETWEEN 1 AND 2000 AND reason = btrim(reason)),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at timestamptz NOT NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, from_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, to_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, outgoing_role_id) REFERENCES roles(guild_id, id),
  CHECK (from_identity_id <> to_identity_id),
  CHECK (expires_at > created_at),
  CHECK (
    (state = 'pending' AND resolved_at IS NULL)
    OR (state <> 'pending' AND resolved_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX root_ownership_transfers_one_pending_idx
  ON root_ownership_transfers (guild_id) WHERE state = 'pending';

CREATE INDEX root_ownership_transfers_participant_idx
  ON root_ownership_transfers (guild_id, from_identity_id, to_identity_id, created_at DESC);

CREATE INDEX identities_active_human_name_search_idx
  ON identities (guild_id, lower(display_name) text_pattern_ops, id)
  WHERE kind = 'human' AND status = 'active';

ALTER TABLE root_ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE root_ownership_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON root_ownership_transfers
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

CREATE TRIGGER touch_updated_at
BEFORE UPDATE ON root_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at();

CREATE FUNCTION guild_runtime.enforce_root_ownership_transfer_record() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  current_root_id uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Root ownership transfer history is append-only';
  END IF;

  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  SELECT root_owner_identity_id INTO current_root_id
    FROM guilds WHERE id = NEW.guild_id;

  IF TG_OP = 'INSERT' THEN
    IF actor_identity_id IS NULL OR actor_identity_id <> current_root_id
       OR NEW.from_identity_id <> current_root_id OR NEW.state <> 'pending'
       OR NEW.version <> 1 OR NEW.resolved_at IS NOT NULL THEN
      RAISE EXCEPTION 'Only the current Root Owner can propose an ownership transfer';
    END IF;
    IF NOT EXISTS (
      SELECT 1
        FROM identities i
        JOIN memberships m ON m.guild_id = i.guild_id AND m.identity_id = i.id
       WHERE i.guild_id = NEW.guild_id AND i.id = NEW.to_identity_id
         AND i.kind = 'human' AND i.status = 'active' AND m.state = 'active'
    ) THEN
      RAISE EXCEPTION 'Root ownership can transfer only to an active human member';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.guild_id <> OLD.guild_id
     OR NEW.from_identity_id <> OLD.from_identity_id
     OR NEW.to_identity_id <> OLD.to_identity_id
     OR NEW.outgoing_role_id <> OLD.outgoing_role_id
     OR NEW.reason <> OLD.reason
     OR NEW.expires_at <> OLD.expires_at
     OR NEW.created_at <> OLD.created_at THEN
    RAISE EXCEPTION 'Root ownership transfer terms are immutable';
  END IF;
  IF OLD.state <> 'pending' OR NEW.state NOT IN ('accepted', 'cancelled', 'expired')
     OR NEW.version <> OLD.version + 1 OR NEW.resolved_at IS NULL THEN
    RAISE EXCEPTION 'Invalid Root ownership transfer transition';
  END IF;
  IF (NEW.state = 'expired' AND OLD.expires_at > now())
     OR (NEW.state IN ('accepted', 'cancelled') AND OLD.expires_at <= now()) THEN
    RAISE EXCEPTION 'Root ownership transfer state does not match its expiry';
  END IF;
  IF NEW.state = 'accepted' THEN
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

CREATE TRIGGER root_ownership_transfer_record_guard
BEFORE INSERT OR UPDATE OR DELETE ON root_ownership_transfers
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_root_ownership_transfer_record();

CREATE FUNCTION guild_runtime.verify_root_ownership_transfer_audit() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  expected_action text;
  expected_actor_id uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    expected_action := 'root_ownership.transfer.proposed';
    expected_actor_id := NEW.from_identity_id;
  ELSE
    expected_action := 'root_ownership.transfer.' || NEW.state;
    expected_actor_id := CASE
      WHEN NEW.state = 'accepted' THEN NEW.to_identity_id
      ELSE NEW.from_identity_id
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM chronicle_events event
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

CREATE CONSTRAINT TRIGGER root_ownership_transfer_audit
AFTER INSERT OR UPDATE ON root_ownership_transfers
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_root_ownership_transfer_audit();

CREATE FUNCTION guild_runtime.prevent_pending_transfer_role_mutation() RETURNS trigger
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
       AND transfer.state = 'pending'
       AND transfer.expires_at > now()
  ) THEN
    RAISE EXCEPTION 'A Role in a pending Root ownership transfer is immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER pending_transfer_role_guard
BEFORE UPDATE OR DELETE ON roles
FOR EACH ROW EXECUTE FUNCTION guild_runtime.prevent_pending_transfer_role_mutation();

CREATE FUNCTION guild_runtime.prevent_pending_transfer_permission_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  touches_pending_transfer boolean;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT EXISTS (
      SELECT 1 FROM root_ownership_transfers transfer
       WHERE transfer.guild_id = NEW.guild_id
         AND transfer.outgoing_role_id = NEW.role_id
         AND transfer.state = 'pending' AND transfer.expires_at > now()
    ) INTO touches_pending_transfer;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT EXISTS (
      SELECT 1 FROM root_ownership_transfers transfer
       WHERE transfer.guild_id = OLD.guild_id
         AND transfer.outgoing_role_id = OLD.role_id
         AND transfer.state = 'pending' AND transfer.expires_at > now()
    ) INTO touches_pending_transfer;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM root_ownership_transfers transfer
       WHERE transfer.state = 'pending' AND transfer.expires_at > now()
         AND (
           (transfer.guild_id = OLD.guild_id AND transfer.outgoing_role_id = OLD.role_id)
           OR (transfer.guild_id = NEW.guild_id AND transfer.outgoing_role_id = NEW.role_id)
         )
    ) INTO touches_pending_transfer;
  END IF;
  IF touches_pending_transfer THEN
    RAISE EXCEPTION 'Permissions for a Role in a pending Root ownership transfer are immutable';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

CREATE TRIGGER pending_transfer_role_permission_guard
BEFORE INSERT OR UPDATE OR DELETE ON role_permissions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.prevent_pending_transfer_permission_mutation();

CREATE FUNCTION guild_runtime.enforce_root_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  actor_identity_id uuid;
  transfer_id uuid;
BEGIN
  IF NEW.root_owner_identity_id = OLD.root_owner_identity_id THEN
    RETURN NEW;
  END IF;

  actor_identity_id := NULLIF(current_setting('app.actor_identity_id', true), '')::uuid;
  transfer_id := NULLIF(current_setting('app.root_transfer_id', true), '')::uuid;
  IF actor_identity_id IS NULL OR transfer_id IS NULL OR actor_identity_id <> NEW.root_owner_identity_id
     OR NOT EXISTS (
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
  RETURN NEW;
END;
$$;

CREATE TRIGGER root_owner_change_guard
BEFORE UPDATE OF root_owner_identity_id ON guilds
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_root_owner_change();

CREATE FUNCTION guild_runtime.verify_root_owner_change() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  transfer_id uuid;
BEGIN
  IF NEW.root_owner_identity_id = OLD.root_owner_identity_id THEN
    RETURN NEW;
  END IF;
  transfer_id := NULLIF(current_setting('app.root_transfer_id', true), '')::uuid;
  IF transfer_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM root_ownership_transfers transfer
     WHERE transfer.guild_id = NEW.id AND transfer.id = transfer_id
       AND transfer.state = 'accepted'
       AND transfer.from_identity_id = OLD.root_owner_identity_id
       AND transfer.to_identity_id = NEW.root_owner_identity_id
  ) THEN
    RAISE EXCEPTION 'Root ownership transfer did not finish atomically';
  END IF;
  RETURN NEW;
END;
$$;

CREATE CONSTRAINT TRIGGER root_owner_change_committed
AFTER UPDATE OF root_owner_identity_id ON guilds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.verify_root_owner_change();
