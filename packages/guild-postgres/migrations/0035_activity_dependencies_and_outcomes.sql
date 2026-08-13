-- Make Activity ordering inspectable, versioned, and enforceable at the database boundary.

-- The migration owner must see every Guild while backfilling existing rows. RLS remains
-- enabled throughout and FORCE is restored before the migration commits.
ALTER TABLE activity_dependencies NO FORCE ROW LEVEL SECURITY;
ALTER TABLE activities NO FORCE ROW LEVEL SECURITY;

ALTER TABLE activity_dependencies
  ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN status text NOT NULL DEFAULT 'active',
  ADD COLUMN version integer NOT NULL DEFAULT 1,
  ADD COLUMN updated_by_actor_id uuid,
  ADD COLUMN revoked_by_actor_id uuid,
  ADD COLUMN revoked_at timestamptz,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

UPDATE activity_dependencies
   SET updated_by_actor_id = created_by_actor_id,
       updated_at = created_at;

ALTER TABLE activity_dependencies
  ALTER COLUMN updated_by_actor_id SET NOT NULL,
  ADD CONSTRAINT activity_dependencies_id_unique UNIQUE (guild_id, id),
  ADD CONSTRAINT activity_dependencies_status_check
    CHECK (status IN ('active', 'revoked')),
  ADD CONSTRAINT activity_dependencies_version_check CHECK (version > 0),
  ADD CONSTRAINT activity_dependencies_revoke_state_check CHECK (
    (status = 'active' AND revoked_by_actor_id IS NULL AND revoked_at IS NULL)
    OR
    (status = 'revoked' AND revoked_by_actor_id IS NOT NULL AND revoked_at IS NOT NULL)
  ),
  ADD CONSTRAINT activity_dependencies_updated_by_fk
    FOREIGN KEY (guild_id, updated_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  ADD CONSTRAINT activity_dependencies_revoked_by_fk
    FOREIGN KEY (guild_id, revoked_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id);

CREATE TABLE activity_dependency_versions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  dependency_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  activity_id uuid NOT NULL,
  depends_on_activity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('blocks', 'relates_to', 'follows')),
  status text NOT NULL CHECK (status IN ('active', 'revoked')),
  changed_by_actor_id uuid NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, dependency_id, version),
  FOREIGN KEY (guild_id, dependency_id)
    REFERENCES activity_dependencies(guild_id, id),
  FOREIGN KEY (guild_id, activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, depends_on_activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, changed_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (activity_id <> depends_on_activity_id)
);

INSERT INTO activity_dependency_versions (
  guild_id, dependency_id, version, activity_id, depends_on_activity_id,
  kind, status, changed_by_actor_id, occurred_at
)
SELECT guild_id, id, version, activity_id, depends_on_activity_id,
       kind, status, updated_by_actor_id, updated_at
  FROM activity_dependencies;

CREATE FUNCTION guild_runtime.enforce_activity_dependency_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  dependent_status text;
  predecessor_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('activity_dependencies'),
    hashtext(NEW.guild_id::text)
  );

  IF TG_OP = 'INSERT' THEN
    IF NEW.version <> 1 OR NEW.status <> 'active' THEN
      RAISE EXCEPTION 'A new Activity dependency must begin as active version 1';
    END IF;
    IF NEW.updated_by_actor_id <> NEW.created_by_actor_id THEN
      RAISE EXCEPTION 'A new Activity dependency must be attributed to its creator';
    END IF;
  ELSE
    IF NEW.guild_id <> OLD.guild_id
       OR NEW.id <> OLD.id
       OR NEW.activity_id <> OLD.activity_id
       OR NEW.depends_on_activity_id <> OLD.depends_on_activity_id
       OR NEW.kind <> OLD.kind
       OR NEW.created_by_actor_id <> OLD.created_by_actor_id
       OR NEW.created_at <> OLD.created_at THEN
      RAISE EXCEPTION 'Activity dependency identity and endpoints are immutable';
    END IF;
    IF NEW.version <> OLD.version + 1 THEN
      RAISE EXCEPTION 'Activity dependency version must advance by exactly one';
    END IF;
    IF NEW.status = OLD.status THEN
      RAISE EXCEPTION 'Activity dependency status must change when a new version is recorded';
    END IF;
  END IF;

  IF NEW.activity_id = NEW.depends_on_activity_id THEN
    RAISE EXCEPTION 'An Activity cannot depend on itself';
  END IF;

  IF NEW.status = 'active' THEN
    NEW.revoked_by_actor_id := NULL;
    NEW.revoked_at := NULL;

    SELECT activity.status
      INTO dependent_status
      FROM activities activity
     WHERE activity.guild_id = NEW.guild_id AND activity.id = NEW.activity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Dependent Activity does not exist in this Guild';
    END IF;

    SELECT activity.status
      INTO predecessor_status
      FROM activities activity
     WHERE activity.guild_id = NEW.guild_id
       AND activity.id = NEW.depends_on_activity_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Predecessor Activity does not exist in this Guild';
    END IF;

    IF NEW.kind = 'blocks'
       AND dependent_status IN ('ready', 'active', 'completed')
       AND predecessor_status <> 'completed' THEN
      RAISE EXCEPTION 'An incomplete blocking predecessor cannot be attached to an Activity already in progress';
    END IF;

    IF NEW.kind IN ('blocks', 'follows') AND EXISTS (
      WITH RECURSIVE dependency_path(activity_id, visited) AS (
        SELECT NEW.depends_on_activity_id,
               ARRAY[NEW.depends_on_activity_id]::uuid[]
        UNION ALL
        SELECT edge.depends_on_activity_id,
               path.visited || edge.depends_on_activity_id
          FROM dependency_path path
          JOIN activity_dependencies edge
            ON edge.guild_id = NEW.guild_id
           AND edge.activity_id = path.activity_id
           AND edge.status = 'active'
           AND edge.kind IN ('blocks', 'follows')
           AND edge.id <> NEW.id
         WHERE NOT edge.depends_on_activity_id = ANY(path.visited)
      )
      SELECT 1
        FROM dependency_path
       WHERE activity_id = NEW.activity_id
    ) THEN
      RAISE EXCEPTION 'Activity dependencies cannot contain a cycle';
    END IF;
  ELSE
    IF NEW.revoked_by_actor_id IS NULL THEN
      RAISE EXCEPTION 'Revoking an Activity dependency requires an Actor';
    END IF;
    NEW.revoked_at := COALESCE(NEW.revoked_at, now());
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_dependency_integrity
BEFORE INSERT OR UPDATE ON activity_dependencies
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_activity_dependency_mutation();

CREATE FUNCTION guild_runtime.reject_activity_dependency_delete()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Activity dependencies are versioned and cannot be deleted';
END;
$$;

CREATE TRIGGER activity_dependency_no_delete
BEFORE DELETE ON activity_dependencies
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_activity_dependency_delete();

CREATE FUNCTION guild_runtime.capture_activity_dependency_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO activity_dependency_versions (
    guild_id, dependency_id, version, activity_id, depends_on_activity_id,
    kind, status, changed_by_actor_id, occurred_at
  ) VALUES (
    NEW.guild_id, NEW.id, NEW.version, NEW.activity_id,
    NEW.depends_on_activity_id, NEW.kind, NEW.status,
    NEW.updated_by_actor_id, NEW.updated_at
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_dependency_capture_version
AFTER INSERT OR UPDATE ON activity_dependencies
FOR EACH ROW EXECUTE FUNCTION guild_runtime.capture_activity_dependency_version();

CREATE FUNCTION guild_runtime.reject_activity_dependency_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Activity dependency versions are append-only';
END;
$$;

CREATE TRIGGER activity_dependency_versions_immutable
BEFORE UPDATE OR DELETE ON activity_dependency_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_activity_dependency_version_mutation();

CREATE TABLE activity_outcomes (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  activity_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  activity_version integer NOT NULL CHECK (activity_version > 0),
  summary text NOT NULL CHECK (length(btrim(summary)) BETWEEN 1 AND 10000),
  evidence_source_ids uuid[] NOT NULL DEFAULT '{}',
  completed_by_actor_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, activity_id, version),
  UNIQUE (guild_id, activity_id, activity_version),
  FOREIGN KEY (guild_id, activity_id) REFERENCES activities(guild_id, id),
  FOREIGN KEY (guild_id, completed_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (cardinality(evidence_source_ids) <= 100)
);

-- Preserve a usable outcome for Activities that were already completed before this migration.
INSERT INTO activity_outcomes (
  guild_id, activity_id, version, activity_version, summary,
  evidence_source_ids, completed_by_actor_id, completed_at
)
SELECT guild_id, id, 1, version,
       COALESCE(NULLIF(btrim(description), ''), title),
       source_ids, creator_actor_id, updated_at
  FROM activities
 WHERE status = 'completed';

CREATE FUNCTION guild_runtime.enforce_activity_outcome_insert()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_status text;
  current_version integer;
  expected_outcome_version integer;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('activity_dependencies'),
    hashtext(NEW.guild_id::text)
  );

  SELECT activity.status, activity.version
    INTO current_status, current_version
    FROM activities activity
   WHERE activity.guild_id = NEW.guild_id AND activity.id = NEW.activity_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Outcome Activity does not exist in this Guild';
  END IF;
  IF current_status <> 'completed' OR current_version <> NEW.activity_version THEN
    RAISE EXCEPTION 'An Activity outcome must describe the current completed Activity version';
  END IF;

  SELECT COALESCE(max(outcome.version), 0) + 1
    INTO expected_outcome_version
    FROM activity_outcomes outcome
   WHERE outcome.guild_id = NEW.guild_id AND outcome.activity_id = NEW.activity_id;
  IF NEW.version <> expected_outcome_version THEN
    RAISE EXCEPTION 'Activity outcome version must advance by exactly one';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM actor_memberships membership
      JOIN actors actor ON actor.id = membership.actor_id
     WHERE membership.guild_id = NEW.guild_id
       AND membership.actor_id = NEW.completed_by_actor_id
       AND membership.state IN ('joined', 'active')
       AND membership.operational = true
       AND actor.status = 'active'
  ) THEN
    RAISE EXCEPTION 'Activity outcome must be completed by an operational Actor';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_outcome_insert_integrity
BEFORE INSERT ON activity_outcomes
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_activity_outcome_insert();

CREATE FUNCTION guild_runtime.reject_activity_outcome_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Activity outcomes are append-only';
END;
$$;

CREATE TRIGGER activity_outcomes_immutable
BEFORE UPDATE OR DELETE ON activity_outcomes
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_activity_outcome_mutation();

CREATE FUNCTION guild_runtime.enforce_activity_blocking_status()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_status text;
BEGIN
  PERFORM pg_advisory_xact_lock(
    hashtext('activity_dependencies'),
    hashtext(NEW.guild_id::text)
  );

  IF TG_OP = 'UPDATE' THEN
    previous_status := OLD.status;
  END IF;

  IF NEW.status IS DISTINCT FROM previous_status
     AND NEW.status IN ('ready', 'active', 'completed')
     AND EXISTS (
       SELECT 1
         FROM activity_dependencies dependency
         JOIN activities predecessor
           ON predecessor.guild_id = dependency.guild_id
          AND predecessor.id = dependency.depends_on_activity_id
        WHERE dependency.guild_id = NEW.guild_id
          AND dependency.activity_id = NEW.id
          AND dependency.kind = 'blocks'
          AND dependency.status = 'active'
          AND predecessor.status <> 'completed'
     ) THEN
    RAISE EXCEPTION 'Activity has an incomplete blocking predecessor';
  END IF;

  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW.status <> 'completed'
     AND EXISTS (
       SELECT 1
         FROM activity_dependencies dependency
         JOIN activities dependent
           ON dependent.guild_id = dependency.guild_id
          AND dependent.id = dependency.activity_id
        WHERE dependency.guild_id = NEW.guild_id
          AND dependency.depends_on_activity_id = NEW.id
          AND dependency.kind = 'blocks'
          AND dependency.status = 'active'
          AND dependent.status IN ('ready', 'active', 'completed')
     ) THEN
    RAISE EXCEPTION 'A completed predecessor cannot be reopened while progressed Activities depend on it';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_blocking_status_integrity
BEFORE INSERT OR UPDATE OF status ON activities
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_activity_blocking_status();

CREATE FUNCTION guild_runtime.require_activity_completion_outcome()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.legacy_source_type IS NULL
     AND NEW.status = 'completed'
     AND (TG_OP = 'INSERT' OR OLD.status <> 'completed')
     AND NOT EXISTS (
       SELECT 1
         FROM activity_outcomes outcome
        WHERE outcome.guild_id = NEW.guild_id
          AND outcome.activity_id = NEW.id
          AND outcome.activity_version = NEW.version
     ) THEN
    RAISE EXCEPTION 'Completing an Activity requires an append-only outcome';
  END IF;
  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER activity_completion_requires_outcome
AFTER INSERT OR UPDATE ON activities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION guild_runtime.require_activity_completion_outcome();

CREATE INDEX activity_dependencies_active_activity_idx
  ON activity_dependencies (guild_id, activity_id, kind, depends_on_activity_id)
  WHERE status = 'active';
CREATE INDEX activity_dependencies_active_predecessor_idx
  ON activity_dependencies (guild_id, depends_on_activity_id, kind, activity_id)
  WHERE status = 'active';
CREATE INDEX activity_outcomes_latest_idx
  ON activity_outcomes (guild_id, activity_id, version DESC);

ALTER TABLE activity_dependency_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_dependency_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON activity_dependency_versions
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

ALTER TABLE activity_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE activity_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON activity_outcomes
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

ALTER TABLE activity_dependencies FORCE ROW LEVEL SECURITY;
ALTER TABLE activities FORCE ROW LEVEL SECURITY;
