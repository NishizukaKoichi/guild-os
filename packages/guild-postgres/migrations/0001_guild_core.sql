BEGIN;

CREATE SCHEMA IF NOT EXISTS guild_runtime;

CREATE FUNCTION guild_runtime.current_guild_id() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.guild_id', true), '')::uuid
$$;

CREATE TABLE guilds (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  purpose text NOT NULL CHECK (length(btrim(purpose)) BETWEEN 1 AND 2000),
  root_owner_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE identities (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('human', 'agent', 'service')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  access_subject text,
  verified_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, access_subject),
  UNIQUE (guild_id, verified_email),
  CHECK (kind = 'human' OR (access_subject IS NULL AND verified_email IS NULL))
);

ALTER TABLE guilds ADD CONSTRAINT guild_root_owner_fk
  FOREIGN KEY (id, root_owner_identity_id) REFERENCES identities(guild_id, id)
  DEFERRABLE INITIALLY DEFERRED;

CREATE TABLE constitutions (
  guild_id uuid PRIMARY KEY REFERENCES guilds(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  level2_approval_quorum integer NOT NULL CHECK (level2_approval_quorum > 0),
  level3_approval_quorum integer NOT NULL CHECK (level3_approval_quorum > 0),
  data_retention_days integer NOT NULL CHECK (data_retention_days > 0),
  agent_defaults jsonb NOT NULL,
  updated_by_identity_id uuid NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, updated_by_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE spaces (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  parent_space_id uuid,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, parent_space_id) REFERENCES spaces(guild_id, id)
);

CREATE TABLE memberships (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('invited', 'preboarding', 'active', 'suspended', 'departed')),
  clearance text NOT NULL CHECK (clearance IN ('public', 'internal', 'confidential', 'restricted')),
  joined_at timestamptz,
  departed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, identity_id),
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE roles (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, name)
);

CREATE TABLE role_permissions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  role_id uuid NOT NULL,
  permission text NOT NULL,
  PRIMARY KEY (guild_id, role_id, permission),
  FOREIGN KEY (guild_id, role_id) REFERENCES roles(guild_id, id)
);

CREATE TABLE role_bindings (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL,
  role_id uuid NOT NULL,
  space_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, role_id) REFERENCES roles(guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id)
);

CREATE TABLE files (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  owner_identity_id uuid NOT NULL,
  r2_key text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
  media_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size >= 0),
  visibility text NOT NULL CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, r2_key),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE knowledge (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  owner_identity_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'proposed', 'canonical', 'deprecated', 'archived')),
  visibility text NOT NULL CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  classification text NOT NULL CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  allowed_identity_ids uuid[] NOT NULL DEFAULT '{}',
  current_version integer NOT NULL CHECK (current_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE knowledge_versions (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  knowledge_id uuid NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  title jsonb NOT NULL,
  summary jsonb NOT NULL,
  body jsonb NOT NULL,
  source_ids uuid[] NOT NULL DEFAULT '{}',
  created_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, knowledge_id, version),
  FOREIGN KEY (guild_id, knowledge_id) REFERENCES knowledge(guild_id, id),
  FOREIGN KEY (guild_id, created_by_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE goals (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  owner_identity_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE projects (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  goal_id uuid NOT NULL,
  space_id uuid,
  title text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, goal_id) REFERENCES goals(guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id)
);

CREATE TABLE quests (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  project_id uuid NOT NULL,
  space_id uuid,
  assignee_identity_id uuid,
  title text NOT NULL,
  status text NOT NULL,
  due_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, project_id) REFERENCES projects(guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, assignee_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE steps (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  quest_id uuid NOT NULL,
  assignee_identity_id uuid,
  title text NOT NULL,
  status text NOT NULL,
  position integer NOT NULL CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, quest_id, position),
  FOREIGN KEY (guild_id, quest_id) REFERENCES quests(guild_id, id),
  FOREIGN KEY (guild_id, assignee_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE decisions (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  proposer_identity_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'proposed', 'approved', 'rejected', 'superseded')),
  rationale text NOT NULL DEFAULT '',
  review_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, proposer_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE decision_options (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL,
  label text NOT NULL,
  description text NOT NULL,
  selected boolean NOT NULL DEFAULT false,
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, decision_id) REFERENCES decisions(guild_id, id)
);

CREATE TABLE decision_approvals (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  decision_id uuid NOT NULL,
  approver_identity_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('approve', 'reject')),
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, decision_id, approver_identity_id),
  FOREIGN KEY (guild_id, decision_id) REFERENCES decisions(guild_id, id),
  FOREIGN KEY (guild_id, approver_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE agent_profiles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  identity_id uuid NOT NULL,
  instructions text NOT NULL,
  model text NOT NULL,
  tool_ids text[] NOT NULL DEFAULT '{}',
  limits jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'stopped')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, identity_id),
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE agent_runs (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  agent_identity_id uuid NOT NULL,
  requester_identity_id uuid NOT NULL,
  quest_id uuid,
  risk_level smallint NOT NULL CHECK (risk_level BETWEEN 0 AND 3),
  status text NOT NULL CHECK (status IN ('planning', 'awaiting_approval', 'running', 'succeeded', 'failed', 'killed')),
  limits jsonb NOT NULL,
  usage jsonb NOT NULL,
  idempotency_key text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, agent_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, requester_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, quest_id) REFERENCES quests(guild_id, id)
);

CREATE TABLE approval_requests (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  agent_run_id uuid,
  risk_level smallint NOT NULL CHECK (risk_level BETWEEN 0 AND 3),
  action_kind text NOT NULL,
  action_payload jsonb NOT NULL,
  required_approvals integer NOT NULL CHECK (required_approvals >= 0),
  reauthentication_required boolean NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'expired', 'applied')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, agent_run_id) REFERENCES agent_runs(guild_id, id)
);

CREATE TABLE approval_votes (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  approval_request_id uuid NOT NULL,
  approver_identity_id uuid NOT NULL,
  verdict text NOT NULL CHECK (verdict IN ('approve', 'reject')),
  reauthenticated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, approval_request_id, approver_identity_id),
  FOREIGN KEY (guild_id, approval_request_id) REFERENCES approval_requests(guild_id, id),
  FOREIGN KEY (guild_id, approver_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE connectors (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  name text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  capability_permissions text[] NOT NULL DEFAULT '{}',
  secret_reference text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id)
);

CREATE TABLE relations (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  from_type text NOT NULL,
  from_id uuid NOT NULL,
  relation_type text NOT NULL,
  to_type text NOT NULL,
  to_id uuid NOT NULL,
  created_by_identity_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, from_type, from_id, relation_type, to_type, to_id),
  FOREIGN KEY (guild_id, created_by_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE chronicle_events (
  sequence bigint GENERATED ALWAYS AS IDENTITY,
  id uuid NOT NULL,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_identity_id uuid NOT NULL,
  action text NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  correlation_id uuid NOT NULL,
  details jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  PRIMARY KEY (guild_id, sequence),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, actor_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE outbox (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  approval_request_id uuid,
  topic text NOT NULL,
  payload jsonb NOT NULL,
  idempotency_key text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, idempotency_key),
  FOREIGN KEY (guild_id, approval_request_id) REFERENCES approval_requests(guild_id, id)
);

CREATE INDEX knowledge_lookup_idx ON knowledge (guild_id, state, space_id, updated_at DESC);
CREATE UNIQUE INDEX role_bindings_unique_scope_idx
  ON role_bindings (guild_id, identity_id, role_id, COALESCE(space_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX quests_assignee_idx ON quests (guild_id, assignee_identity_id, status);
CREATE INDEX agent_runs_status_idx ON agent_runs (guild_id, status, created_at);
CREATE INDEX approvals_status_idx ON approval_requests (guild_id, status, expires_at);
CREATE INDEX chronicle_subject_idx ON chronicle_events (guild_id, subject_type, subject_id, sequence DESC);
CREATE INDEX chronicle_actor_idx ON chronicle_events (guild_id, actor_identity_id, sequence DESC);
CREATE INDEX outbox_ready_idx ON outbox (guild_id, status, available_at) WHERE status = 'pending';

CREATE FUNCTION guild_runtime.reject_chronicle_mutation() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Chronicle events are append-only';
END;
$$;

CREATE TRIGGER chronicle_no_update_or_delete
BEFORE UPDATE OR DELETE ON chronicle_events
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_chronicle_mutation();

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'identities', 'constitutions', 'spaces', 'memberships', 'roles', 'role_permissions',
    'role_bindings', 'files', 'knowledge', 'knowledge_versions', 'goals', 'projects', 'quests',
    'steps', 'decisions', 'decision_options', 'decision_approvals', 'agent_profiles', 'agent_runs',
    'approval_requests', 'approval_votes', 'connectors', 'relations', 'chronicle_events', 'outbox'
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

ALTER TABLE guilds ENABLE ROW LEVEL SECURITY;
ALTER TABLE guilds FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON guilds
  USING (id = guild_runtime.current_guild_id())
  WITH CHECK (id = guild_runtime.current_guild_id());

COMMIT;
