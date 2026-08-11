ALTER TABLE identities
  ADD COLUMN preferred_locale text NOT NULL DEFAULT 'en'
    CHECK (preferred_locale IN ('en', 'ja', 'zh-CN'));

UPDATE identities
   SET access_subject = 'cloudflare-os-account:' || id::text
 WHERE kind = 'human' AND access_subject IS NULL;

ALTER TABLE files
  ADD COLUMN allowed_identity_ids uuid[] NOT NULL DEFAULT '{}';

ALTER TABLE goals
  ADD COLUMN creator_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN source_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD FOREIGN KEY (guild_id, creator_identity_id) REFERENCES identities(guild_id, id);

UPDATE goals SET creator_identity_id = owner_identity_id WHERE creator_identity_id IS NULL;
ALTER TABLE goals ALTER COLUMN creator_identity_id SET NOT NULL;

ALTER TABLE projects
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN creator_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN source_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD FOREIGN KEY (guild_id, creator_identity_id) REFERENCES identities(guild_id, id);

UPDATE projects p
   SET owner_identity_id = g.owner_identity_id,
       creator_identity_id = g.creator_identity_id
  FROM goals g
 WHERE p.guild_id = g.guild_id AND p.goal_id = g.id;
ALTER TABLE projects ALTER COLUMN owner_identity_id SET NOT NULL;
ALTER TABLE projects ALTER COLUMN creator_identity_id SET NOT NULL;

ALTER TABLE quests
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN creator_identity_id uuid,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN source_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD FOREIGN KEY (guild_id, creator_identity_id) REFERENCES identities(guild_id, id);

UPDATE quests q
   SET owner_identity_id = p.owner_identity_id,
       creator_identity_id = p.creator_identity_id
  FROM projects p
 WHERE q.guild_id = p.guild_id AND q.project_id = p.id;
ALTER TABLE quests ALTER COLUMN owner_identity_id SET NOT NULL;
ALTER TABLE quests ALTER COLUMN creator_identity_id SET NOT NULL;

ALTER TABLE steps
  ADD COLUMN creator_identity_id uuid,
  ADD COLUMN description text NOT NULL DEFAULT '',
  ADD FOREIGN KEY (guild_id, creator_identity_id) REFERENCES identities(guild_id, id);

UPDATE steps s
   SET creator_identity_id = q.creator_identity_id
  FROM quests q
 WHERE s.guild_id = q.guild_id AND s.quest_id = q.id;
ALTER TABLE steps ALTER COLUMN creator_identity_id SET NOT NULL;

ALTER TABLE decisions
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  ADD COLUMN classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  ADD COLUMN source_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id);

UPDATE decisions SET owner_identity_id = proposer_identity_id WHERE owner_identity_id IS NULL;
ALTER TABLE decisions ALTER COLUMN owner_identity_id SET NOT NULL;

ALTER TABLE agent_runs
  ADD COLUMN plan jsonb,
  ADD COLUMN result jsonb,
  ADD COLUMN error_message text,
  ADD COLUMN workflow_instance_id text,
  ADD COLUMN kill_requested_at timestamptz,
  ADD COLUMN estimated_budget_minor integer CHECK (estimated_budget_minor >= 0);

ALTER TABLE connectors
  ADD COLUMN owner_identity_id uuid,
  ADD COLUMN endpoint_url text,
  ADD FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  ADD CHECK (endpoint_url IS NULL OR endpoint_url ~ '^https://');

UPDATE connectors c
   SET owner_identity_id = g.root_owner_identity_id
  FROM guilds g
 WHERE c.guild_id = g.id;
ALTER TABLE connectors ALTER COLUMN owner_identity_id SET NOT NULL;

ALTER TABLE outbox
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();

CREATE TABLE guild_invitations (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  token_hash text NOT NULL CHECK (token_hash ~ '^[a-f0-9]{64}$'),
  invitee_label text NOT NULL CHECK (length(btrim(invitee_label)) BETWEEN 1 AND 200),
  role_id uuid NOT NULL,
  space_id uuid,
  initial_membership_state text NOT NULL DEFAULT 'preboarding'
    CHECK (initial_membership_state IN ('preboarding', 'active')),
  state text NOT NULL CHECK (state IN ('pending', 'accepted', 'revoked', 'expired')),
  expires_at timestamptz NOT NULL,
  created_by_identity_id uuid NOT NULL,
  accepted_by_identity_id uuid,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  UNIQUE (guild_id, token_hash),
  FOREIGN KEY (guild_id, role_id) REFERENCES roles(guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, created_by_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, accepted_by_identity_id) REFERENCES identities(guild_id, id),
  CHECK (
    (state = 'accepted' AND accepted_by_identity_id IS NOT NULL AND accepted_at IS NOT NULL)
    OR (state <> 'accepted' AND accepted_by_identity_id IS NULL AND accepted_at IS NULL)
  ),
  CHECK (expires_at > created_at)
);

CREATE TABLE announcements (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  target_role_id uuid,
  owner_identity_id uuid NOT NULL,
  creator_identity_id uuid NOT NULL,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
  status text NOT NULL CHECK (status IN ('draft', 'published', 'archived')),
  visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  published_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, target_role_id) REFERENCES roles(guild_id, id),
  FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id),
  FOREIGN KEY (guild_id, creator_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE inbox_notifications (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  recipient_identity_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN (
    'announcement', 'mention', 'quest', 'approval', 'knowledge_update', 'agent_question', 'system'
  )),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  body text NOT NULL CHECK (length(body) <= 2000),
  resource_type text,
  resource_id uuid,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, recipient_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE knowledge_acknowledgements (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  knowledge_id uuid NOT NULL,
  knowledge_version integer NOT NULL,
  identity_id uuid NOT NULL,
  acknowledged_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, knowledge_id, knowledge_version, identity_id),
  FOREIGN KEY (guild_id, knowledge_id, knowledge_version)
    REFERENCES knowledge_versions(guild_id, knowledge_id, version),
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE conversations (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  space_id uuid,
  owner_identity_id uuid NOT NULL,
  subject_type text NOT NULL,
  subject_id uuid NOT NULL,
  visibility text NOT NULL DEFAULT 'space'
    CHECK (visibility IN ('guild', 'space', 'restricted', 'private')),
  classification text NOT NULL DEFAULT 'internal'
    CHECK (classification IN ('public', 'internal', 'confidential', 'restricted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id),
  FOREIGN KEY (guild_id, owner_identity_id) REFERENCES identities(guild_id, id)
);

CREATE TABLE conversation_messages (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  author_identity_id uuid NOT NULL,
  body text NOT NULL CHECK (length(btrim(body)) BETWEEN 1 AND 10000),
  created_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz,
  UNIQUE (guild_id, id),
  FOREIGN KEY (guild_id, conversation_id) REFERENCES conversations(guild_id, id),
  FOREIGN KEY (guild_id, author_identity_id) REFERENCES identities(guild_id, id)
);

ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_known_permission CHECK (permission IN (
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
    'integration.execute',
    'break-glass.use'
  ));

CREATE INDEX guild_invitations_pending_idx
  ON guild_invitations (guild_id, token_hash, expires_at) WHERE state = 'pending';
CREATE INDEX inbox_recipient_idx
  ON inbox_notifications (guild_id, recipient_identity_id, read_at, created_at DESC);
CREATE INDEX announcements_active_idx
  ON announcements (guild_id, status, space_id, published_at DESC);
CREATE INDEX conversations_subject_idx
  ON conversations (guild_id, subject_type, subject_id, created_at);
CREATE INDEX conversation_messages_thread_idx
  ON conversation_messages (guild_id, conversation_id, created_at);
CREATE INDEX knowledge_versions_search_idx ON knowledge_versions USING GIN (
  to_tsvector('simple',
    coalesce(title::text, '') || ' ' ||
    coalesce(summary::text, '') || ' ' ||
    coalesce(body::text, '')
  )
);

CREATE FUNCTION guild_runtime.touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'guilds', 'identities', 'constitutions', 'spaces', 'memberships', 'roles', 'knowledge',
    'goals', 'projects', 'quests', 'steps', 'decisions', 'agent_profiles', 'agent_runs',
    'approval_requests', 'connectors', 'outbox', 'guild_invitations', 'announcements', 'conversations'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'guild_invitations', 'announcements', 'inbox_notifications', 'knowledge_acknowledgements',
    'conversations', 'conversation_messages'
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
