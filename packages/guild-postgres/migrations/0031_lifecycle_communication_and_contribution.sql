-- Add the Human/Agent lifecycle, private communication, audited emergency access,
-- and evidence-backed contribution views required by the complete Guild OS contract.

ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;

ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_known_permission;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_known_permission CHECK (permission IN (
    'actor.read', 'actor.manage',
    'memory.read', 'memory.create', 'memory.govern',
    'activity.read', 'activity.create', 'activity.assign',
    'connection.read', 'connection.execute', 'connection.manage',
    'run.read', 'run.create', 'run.approve', 'run.stop',
    'event.read', 'template.read', 'template.manage',
    'stewardship.manage', 'stewardship.recover',
    'relation.read', 'relation.manage',
    'lifecycle.read', 'lifecycle.manage',
    'message.read', 'message.create',
    'contribution.read', 'contribution.correct',
    'automation.read', 'automation.manage',
    'federation.read', 'federation.manage',
    'data.read', 'data.manage',
    'guild.read', 'guild.manage', 'constitution.read', 'constitution.update',
    'space.read', 'space.manage', 'identity.read', 'identity.manage',
    'membership.read', 'membership.manage', 'role.read', 'role.manage',
    'knowledge.read', 'knowledge.create', 'knowledge.propose', 'knowledge.approve',
    'file.read', 'file.create', 'file.delete',
    'work.read', 'work.create', 'work.assign',
    'decision.read', 'decision.propose', 'decision.approve',
    'conversation.read', 'conversation.create', 'conversation.moderate',
    'announcement.read', 'announcement.manage',
    'agent.read', 'agent.manage', 'agent.run', 'agent.approve', 'agent.stop',
    'inbox.read', 'chronicle.read', 'integration.read', 'integration.manage',
    'integration.execute', 'break-glass.use'
  ));

-- Existing Guilds receive the neutral capabilities equivalent to their established
-- product permissions. New Guilds are seeded from the current Template definitions.
INSERT INTO role_permissions (guild_id, role_id, permission)
SELECT existing.guild_id, existing.role_id, mapping.new_permission
  FROM role_permissions existing
  JOIN (VALUES
    ('identity.read', 'actor.read'),
    ('membership.read', 'lifecycle.read'),
    ('membership.manage', 'lifecycle.manage'),
    ('conversation.read', 'message.read'),
    ('conversation.create', 'message.create'),
    ('conversation.create', 'contribution.correct'),
    ('chronicle.read', 'contribution.read'),
    ('integration.read', 'connection.read'),
    ('integration.execute', 'connection.execute'),
    ('integration.manage', 'connection.manage'),
    ('work.read', 'automation.read'),
    ('agent.manage', 'automation.manage')
  ) AS mapping(old_permission, new_permission)
    ON mapping.old_permission = existing.permission
ON CONFLICT (guild_id, role_id, permission) DO NOTHING;

CREATE OR REPLACE FUNCTION guild_runtime.permission_is_human_only(candidate text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT candidate IN (
    'actor.manage', 'memory.govern', 'connection.manage',
    'run.approve', 'run.stop', 'template.manage',
    'stewardship.manage', 'stewardship.recover',
    'lifecycle.manage', 'contribution.correct',
    'automation.manage', 'federation.manage', 'data.manage',
    'guild.manage', 'constitution.update', 'space.manage', 'identity.manage',
    'membership.manage', 'role.manage', 'knowledge.approve',
    'decision.approve', 'conversation.moderate', 'announcement.manage',
    'agent.manage', 'agent.approve', 'agent.stop', 'integration.manage',
    'break-glass.use'
  )
$$;

CREATE TABLE private_threads (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  space_id uuid,
  created_by_actor_id uuid NOT NULL,
  subject text NOT NULL DEFAULT '' CHECK (length(subject) <= 200),
  classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE TABLE private_thread_participants (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL,
  actor_id uuid NOT NULL,
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'left')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  left_at timestamptz,
  PRIMARY KEY (guild_id, thread_id, actor_id),
  FOREIGN KEY (guild_id, thread_id) REFERENCES private_threads(guild_id, id),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  CHECK ((state = 'active' AND left_at IS NULL) OR (state = 'left' AND left_at IS NOT NULL))
);

CREATE TABLE private_messages (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL,
  author_actor_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 20000),
  state text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'redacted')),
  redacted_by_actor_id uuid,
  redacted_at timestamptz,
  redaction_reason text CHECK (redaction_reason IS NULL OR length(redaction_reason) <= 5000),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, thread_id) REFERENCES private_threads(guild_id, id),
  FOREIGN KEY (guild_id, author_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, redacted_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (
    (state = 'active' AND redacted_by_actor_id IS NULL AND redacted_at IS NULL AND redaction_reason IS NULL)
    OR (state = 'redacted' AND redacted_by_actor_id IS NOT NULL AND redacted_at IS NOT NULL
        AND redaction_reason IS NOT NULL)
  )
);

CREATE INDEX private_threads_recent_idx
  ON private_threads (guild_id, updated_at DESC, id DESC);
CREATE INDEX private_messages_thread_idx
  ON private_messages (guild_id, thread_id, created_at DESC, id DESC);

CREATE FUNCTION guild_runtime.enforce_private_message_author() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM private_thread_participants participant
      JOIN actor_memberships membership
        ON membership.guild_id = participant.guild_id
       AND membership.actor_id = participant.actor_id
     WHERE participant.guild_id = NEW.guild_id
       AND participant.thread_id = NEW.thread_id
       AND participant.actor_id = NEW.author_actor_id
       AND participant.state = 'active'
       AND membership.state IN ('joined', 'active')
       AND membership.operational
  ) THEN
    RAISE EXCEPTION 'Only an active thread participant can post a private message';
  END IF;
  IF (SELECT status FROM private_threads
       WHERE guild_id = NEW.guild_id AND id = NEW.thread_id) <> 'open' THEN
    RAISE EXCEPTION 'A closed private thread cannot accept messages';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER private_message_author_boundary
BEFORE INSERT ON private_messages
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_private_message_author();

CREATE FUNCTION guild_runtime.enforce_private_message_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Private message history follows the Constitution retention policy';
  END IF;
  IF OLD.state <> 'active' OR NEW.state <> 'redacted'
     OR NEW.version <> OLD.version + 1
     OR OLD.guild_id IS DISTINCT FROM NEW.guild_id
     OR OLD.thread_id IS DISTINCT FROM NEW.thread_id
     OR OLD.author_actor_id IS DISTINCT FROM NEW.author_actor_id
     OR OLD.body IS DISTINCT FROM NEW.body
     OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
    RAISE EXCEPTION 'A private message can only be redacted once with an audit reason';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER private_message_governance
BEFORE UPDATE OR DELETE ON private_messages
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_private_message_mutation();

CREATE TABLE emergency_private_access_grants (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  thread_id uuid NOT NULL,
  granted_to_actor_id uuid NOT NULL,
  granted_by_actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 10 AND 5000),
  intended_access text NOT NULL CHECK (length(btrim(intended_access)) BETWEEN 10 AND 5000),
  viewed_information text NOT NULL DEFAULT '' CHECK (length(viewed_information) <= 10000),
  changes_made text NOT NULL DEFAULT '' CHECK (length(changes_made) <= 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed', 'expired')),
  expires_at timestamptz NOT NULL,
  closed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, thread_id) REFERENCES private_threads(guild_id, id),
  FOREIGN KEY (guild_id, granted_to_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, granted_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (expires_at > created_at),
  CHECK ((status = 'active' AND closed_at IS NULL) OR (status <> 'active' AND closed_at IS NOT NULL))
);

CREATE INDEX emergency_private_access_active_idx
  ON emergency_private_access_grants (guild_id, thread_id, expires_at)
  WHERE status = 'active';

CREATE TABLE onboarding_paths (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  space_id uuid,
  template_key text,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_by_actor_id uuid NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, template_key)
    REFERENCES collective_templates(guild_id, key),
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE TABLE onboarding_requirements (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  path_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('memory', 'activity', 'acknowledgement', 'checklist')),
  resource_id uuid,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  instructions text NOT NULL DEFAULT '' CHECK (length(instructions) <= 10000),
  required boolean NOT NULL DEFAULT true,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, path_id, position),
  FOREIGN KEY (guild_id, path_id) REFERENCES onboarding_paths(guild_id, id),
  CHECK ((kind = 'checklist' AND resource_id IS NULL) OR (kind <> 'checklist' AND resource_id IS NOT NULL))
);

CREATE TABLE onboarding_assignments (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  path_id uuid NOT NULL,
  manager_actor_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'ready', 'completed', 'cancelled')),
  due_at timestamptz,
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, actor_id, path_id),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, path_id) REFERENCES onboarding_paths(guild_id, id),
  FOREIGN KEY (guild_id, manager_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE TABLE onboarding_completions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  assignment_id uuid NOT NULL,
  requirement_id uuid NOT NULL,
  completed_by_actor_id uuid NOT NULL,
  evidence text NOT NULL DEFAULT '' CHECK (length(evidence) <= 5000),
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, assignment_id, requirement_id),
  FOREIGN KEY (guild_id, assignment_id) REFERENCES onboarding_assignments(guild_id, id),
  FOREIGN KEY (guild_id, requirement_id) REFERENCES onboarding_requirements(guild_id, id),
  FOREIGN KEY (guild_id, completed_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE FUNCTION guild_runtime.enforce_preboarding_completion() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.state = 'preboarding' AND NEW.state = 'active' AND EXISTS (
    SELECT 1
      FROM onboarding_assignments assignment
     WHERE assignment.guild_id = NEW.guild_id
       AND assignment.actor_id = NEW.identity_id
       AND assignment.status NOT IN ('completed', 'cancelled')
  ) THEN
    RAISE EXCEPTION 'Preboarding requirements must be completed before activation';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER membership_preboarding_completion
BEFORE UPDATE OF state ON memberships
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_preboarding_completion();

CREATE TABLE handover_cases (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  departing_actor_id uuid NOT NULL,
  successor_actor_id uuid,
  initiated_by_actor_id uuid NOT NULL,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'completed', 'cancelled')),
  completed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, departing_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, successor_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, initiated_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (departing_actor_id IS DISTINCT FROM successor_actor_id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE UNIQUE INDEX handover_cases_one_open_idx
  ON handover_cases (guild_id, departing_actor_id)
  WHERE status = 'open';

CREATE TABLE handover_items (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  case_id uuid NOT NULL,
  resource_type text NOT NULL CHECK (
    resource_type IN ('memory', 'activity', 'knowledge', 'file', 'decision', 'connection', 'schedule')
  ),
  resource_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 500),
  disposition text NOT NULL DEFAULT 'transfer'
    CHECK (disposition IN ('transfer', 'retain', 'archive')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'completed', 'failed')),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 5000),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, case_id, resource_type, resource_id),
  FOREIGN KEY (guild_id, case_id) REFERENCES handover_cases(guild_id, id),
  CHECK ((status = 'completed' AND completed_at IS NOT NULL) OR status <> 'completed')
);

CREATE TABLE contribution_correction_requests (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  subject_actor_id uuid NOT NULL,
  requested_by_actor_id uuid NOT NULL,
  chronicle_event_id uuid,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 1 AND 5000),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'accepted', 'rejected')),
  reviewed_by_actor_id uuid,
  review_reason text CHECK (review_reason IS NULL OR length(review_reason) <= 5000),
  reviewed_at timestamptz,
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, subject_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, requested_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, chronicle_event_id)
    REFERENCES chronicle_events(guild_id, id),
  FOREIGN KEY (guild_id, reviewed_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id),
  CHECK (
    (status = 'open' AND reviewed_by_actor_id IS NULL AND review_reason IS NULL AND reviewed_at IS NULL)
    OR (status <> 'open' AND reviewed_by_actor_id IS NOT NULL
        AND review_reason IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE INDEX contribution_corrections_open_idx
  ON contribution_correction_requests (guild_id, status, created_at DESC);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'private_threads', 'private_thread_participants', 'private_messages',
    'emergency_private_access_grants', 'onboarding_paths',
    'onboarding_requirements', 'onboarding_assignments', 'onboarding_completions',
    'handover_cases', 'handover_items', 'contribution_correction_requests'
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

CREATE OR REPLACE FUNCTION guild_runtime.current_actor_id()
RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.actor_identity_id', true), '')::uuid
$$;

-- The application role cannot retrieve private message plaintext merely by knowing
-- the Guild and thread ID. Participation or a live, explicit Break Glass grant is
-- required before PostgreSQL returns the row.
DROP POLICY guild_scope ON private_messages;
CREATE POLICY private_message_actor_scope ON private_messages
  USING (
    guild_id = guild_runtime.current_guild_id()
    AND (
      EXISTS (SELECT 1 FROM private_thread_participants participant
               WHERE participant.guild_id = private_messages.guild_id
                 AND participant.thread_id = private_messages.thread_id
                 AND participant.actor_id = guild_runtime.current_actor_id()
                 AND participant.state = 'active')
      OR EXISTS (SELECT 1 FROM emergency_private_access_grants emergency
                  WHERE emergency.guild_id = private_messages.guild_id
                    AND emergency.thread_id = private_messages.thread_id
                    AND emergency.granted_to_actor_id = guild_runtime.current_actor_id()
                    AND emergency.status = 'active' AND emergency.expires_at > now())
    )
  )
  WITH CHECK (
    guild_id = guild_runtime.current_guild_id()
    AND author_actor_id = guild_runtime.current_actor_id()
    AND EXISTS (SELECT 1 FROM private_thread_participants participant
                 WHERE participant.guild_id = private_messages.guild_id
                   AND participant.thread_id = private_messages.thread_id
                   AND participant.actor_id = guild_runtime.current_actor_id()
                   AND participant.state = 'active')
  );

ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
