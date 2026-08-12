-- Expand the company-oriented identity model into an Actor-neutral collective substrate.
-- Existing Identity IDs remain the canonical Actor IDs during the compatibility window.

-- The migration connection owns these tables. Temporarily stop forcing RLS so the
-- transaction can backfill every Guild; RLS remains enabled and FORCE is restored below.
ALTER TABLE guilds NO FORCE ROW LEVEL SECURITY;
ALTER TABLE identities NO FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships NO FORCE ROW LEVEL SECURITY;
ALTER TABLE roles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions NO FORCE ROW LEVEL SECURITY;
ALTER TABLE role_bindings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spaces NO FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles NO FORCE ROW LEVEL SECURITY;

ALTER TABLE identities DROP CONSTRAINT identities_kind_check;
ALTER TABLE identities
  ADD CONSTRAINT identities_kind_check
  CHECK (kind IN ('human', 'agent', 'service', 'guild'));

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

ALTER TABLE role_permissions DROP CONSTRAINT role_permissions_no_root_authority;
ALTER TABLE role_permissions
  ADD CONSTRAINT role_permissions_no_root_authority
  CHECK (permission NOT IN (
    'constitution.update', 'break-glass.use',
    'stewardship.manage', 'stewardship.recover'
  ));

CREATE OR REPLACE FUNCTION guild_runtime.permission_is_human_only(candidate text)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT candidate IN (
    'actor.manage', 'memory.govern', 'connection.manage',
    'run.approve', 'run.stop', 'template.manage',
    'stewardship.manage', 'stewardship.recover',
    'guild.manage', 'constitution.update', 'space.manage', 'identity.manage',
    'membership.manage', 'role.manage', 'knowledge.approve',
    'decision.approve', 'conversation.moderate', 'announcement.manage',
    'agent.manage', 'agent.approve', 'agent.stop', 'integration.manage',
    'break-glass.use'
  )
$$;

CREATE TABLE actors (
  id uuid PRIMARY KEY,
  home_guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  kind text NOT NULL CHECK (kind IN ('human', 'agent', 'service', 'guild')),
  display_name text NOT NULL CHECK (length(btrim(display_name)) BETWEEN 1 AND 200),
  status text NOT NULL CHECK (status IN ('active', 'disabled')),
  access_subject text,
  verified_email text,
  preferred_locale text NOT NULL DEFAULT 'en'
    CHECK (preferred_locale IN ('en', 'ja', 'zh-CN')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (home_guild_id, access_subject),
  UNIQUE (home_guild_id, verified_email),
  CHECK (kind = 'human' OR (access_subject IS NULL AND verified_email IS NULL))
);

CREATE TABLE actor_memberships (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN (
    'invited', 'joined', 'active', 'paused', 'left', 'blocked'
  )),
  clearance text NOT NULL CHECK (clearance IN (
    'public', 'internal', 'confidential', 'restricted'
  )),
  operational boolean NOT NULL DEFAULT true,
  joined_at timestamptz,
  left_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, actor_id),
  CHECK ((state = 'left' AND left_at IS NOT NULL) OR state <> 'left'),
  CHECK (state NOT IN ('left', 'blocked') OR operational = false)
);

CREATE TABLE identity_actor_links (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  identity_id uuid NOT NULL,
  actor_id uuid NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, identity_id),
  UNIQUE (guild_id, actor_id),
  FOREIGN KEY (guild_id, identity_id) REFERENCES identities(guild_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id)
    DEFERRABLE INITIALLY DEFERRED,
  CHECK (identity_id = actor_id)
);

CREATE TABLE actor_role_bindings (
  id uuid PRIMARY KEY,
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  role_id uuid NOT NULL,
  space_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id),
  FOREIGN KEY (guild_id, role_id) REFERENCES roles(guild_id, id),
  FOREIGN KEY (guild_id, space_id) REFERENCES spaces(guild_id, id)
);

CREATE UNIQUE INDEX actor_role_bindings_unique_scope_idx
  ON actor_role_bindings (
    guild_id, actor_id, role_id,
    COALESCE(space_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

CREATE TABLE human_profiles (
  actor_id uuid PRIMARY KEY REFERENCES actors(id) ON DELETE RESTRICT,
  biography text NOT NULL DEFAULT '' CHECK (length(biography) <= 10000),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE actor_agent_profiles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  instructions text NOT NULL CHECK (length(btrim(instructions)) BETWEEN 1 AND 20000),
  model text NOT NULL CHECK (length(btrim(model)) BETWEEN 1 AND 200),
  tool_ids text[] NOT NULL DEFAULT '{}',
  limits jsonb NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'stopped')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, actor_id),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE TABLE service_profiles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  service_type text NOT NULL DEFAULT 'service'
    CHECK (length(btrim(service_type)) BETWEEN 1 AND 100),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, actor_id),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE TABLE guild_actor_profiles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  actor_id uuid NOT NULL,
  represented_guild_id uuid REFERENCES guilds(id) ON DELETE RESTRICT,
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 10000),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, actor_id),
  FOREIGN KEY (guild_id, actor_id) REFERENCES actor_memberships(guild_id, actor_id)
);

CREATE TABLE collective_templates (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL CHECK (length(description) <= 2000),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, key)
);

CREATE TABLE vocabulary_profiles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  key text NOT NULL CHECK (key ~ '^[a-z][a-z0-9-]{1,62}$'),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  labels jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(labels) = 'object'),
  template_key text,
  system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, key),
  FOREIGN KEY (guild_id, template_key)
    REFERENCES collective_templates(guild_id, key) ON DELETE RESTRICT
);

CREATE TABLE guild_collective_settings (
  guild_id uuid PRIMARY KEY REFERENCES guilds(id) ON DELETE RESTRICT,
  template_key text NOT NULL,
  template_version integer NOT NULL DEFAULT 1 CHECK (template_version > 0),
  vocabulary_overrides jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(vocabulary_overrides) = 'object'),
  onboarding_answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(onboarding_answers) = 'object'),
  updated_by_actor_id uuid REFERENCES actors(id) ON DELETE RESTRICT,
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (guild_id, template_key)
    REFERENCES collective_templates(guild_id, key) ON DELETE RESTRICT
);

ALTER TABLE spaces
  ADD COLUMN vocabulary_profile_key text,
  ADD CONSTRAINT spaces_vocabulary_profile_fk
    FOREIGN KEY (guild_id, vocabulary_profile_key)
    REFERENCES vocabulary_profiles(guild_id, key) ON DELETE RESTRICT;

CREATE FUNCTION guild_runtime.seed_collective_templates(target_guild_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  template record;
BEGIN
  FOR template IN
    SELECT * FROM (VALUES
      ('blank', 'Blank Guild', 'Neutral primitives with no industry assumptions.'),
      ('company', 'Company', 'People, work, manuals, and operational approvals.'),
      ('community', 'Community', 'Members, initiatives, events, and collective decisions.'),
      ('research', 'Research Collective', 'Researchers, studies, evidence, and peer review.'),
      ('creator', 'Creator Collective', 'Collaborators, creations, reviews, and publishing.'),
      ('open-source', 'Open Source Project', 'Contributors, issues, project memory, and maintainer review.'),
      ('agent-collective', 'Agent Collective', 'Agents, missions, context, policy, and human approval.')
    ) AS value(key, name, description)
  LOOP
    INSERT INTO collective_templates (
      guild_id, key, name, description, definition, system
    ) VALUES (
      target_guild_id, template.key, template.name, template.description,
      jsonb_build_object('source', 'built-in', 'version', 1), true
    ) ON CONFLICT (guild_id, key) DO NOTHING;

    INSERT INTO vocabulary_profiles (
      guild_id, key, name, labels, template_key, system
    ) VALUES (
      target_guild_id, template.key, template.name, '{}'::jsonb, template.key, true
    ) ON CONFLICT (guild_id, key) DO NOTHING;
  END LOOP;

  INSERT INTO guild_collective_settings (guild_id, template_key)
  VALUES (target_guild_id, 'blank')
  ON CONFLICT (guild_id) DO NOTHING;
END;
$$;

SELECT guild_runtime.seed_collective_templates(id) FROM guilds;

INSERT INTO actors (
  id, home_guild_id, kind, display_name, status, access_subject,
  verified_email, preferred_locale, created_at, updated_at
)
SELECT id, guild_id, kind, display_name, status, access_subject,
       verified_email, preferred_locale, created_at, updated_at
  FROM identities
ON CONFLICT (id) DO NOTHING;

INSERT INTO actor_memberships (
  guild_id, actor_id, state, clearance, operational, joined_at, left_at, updated_at
)
SELECT guild_id, identity_id,
       CASE state
         WHEN 'preboarding' THEN 'joined'
         WHEN 'suspended' THEN 'paused'
         WHEN 'departed' THEN 'left'
         ELSE state
       END,
       clearance,
       state NOT IN ('suspended', 'departed'),
       joined_at, departed_at, updated_at
  FROM memberships;

INSERT INTO identity_actor_links (guild_id, identity_id, actor_id, created_at)
SELECT i.guild_id, i.id, i.id, i.created_at FROM identities i;

INSERT INTO actor_role_bindings (id, guild_id, actor_id, role_id, space_id, created_at)
SELECT id, guild_id, identity_id, role_id, space_id, created_at FROM role_bindings;

INSERT INTO human_profiles (actor_id)
SELECT id FROM identities WHERE kind = 'human';

INSERT INTO actor_agent_profiles (
  guild_id, actor_id, instructions, model, tool_ids, limits, status, updated_at
)
SELECT guild_id, identity_id, instructions, model, tool_ids, limits, status, updated_at
  FROM agent_profiles;

INSERT INTO service_profiles (guild_id, actor_id)
SELECT guild_id, id FROM identities WHERE kind = 'service';

INSERT INTO guild_actor_profiles (guild_id, actor_id)
SELECT guild_id, id FROM identities WHERE kind = 'guild';

-- Existing grants continue to work while neutral capability names become first-class.
INSERT INTO role_permissions (guild_id, role_id, permission)
SELECT source.guild_id, source.role_id, alias.permission
  FROM role_permissions source
  JOIN (VALUES
    ('identity.read', 'actor.read'),
    ('identity.manage', 'actor.manage'),
    ('knowledge.read', 'memory.read'),
    ('knowledge.create', 'memory.create'),
    ('knowledge.approve', 'memory.govern'),
    ('work.read', 'activity.read'),
    ('work.create', 'activity.create'),
    ('work.assign', 'activity.assign'),
    ('integration.read', 'connection.read'),
    ('integration.execute', 'connection.execute'),
    ('integration.manage', 'connection.manage'),
    ('agent.read', 'run.read'),
    ('agent.run', 'run.create'),
    ('agent.approve', 'run.approve'),
    ('agent.stop', 'run.stop'),
    ('chronicle.read', 'event.read'),
    ('guild.read', 'template.read')
  ) AS alias(legacy_permission, permission)
    ON source.permission = alias.legacy_permission
ON CONFLICT DO NOTHING;

-- identity_actor_links intentionally uses a deferred pair constraint so both sides can be
-- backfilled in one transaction. Drain those trigger events before ALTER TABLE configures RLS.
SET CONSTRAINTS ALL IMMEDIATE;

-- Reconcile every Guild while the owner can still observe the complete backfill. New tables are
-- forced behind tenant RLS only after these guards succeed.
DO $$
BEGIN
  IF (SELECT count(*) FROM actors) <> (SELECT count(*) FROM identities) THEN
    RAISE EXCEPTION 'Actor backfill count does not match Identity count';
  END IF;
  IF (SELECT count(*) FROM actor_memberships) <> (SELECT count(*) FROM memberships) THEN
    RAISE EXCEPTION 'Actor Membership backfill count does not match Membership count';
  END IF;
  IF (SELECT count(*) FROM identity_actor_links) <> (SELECT count(*) FROM identities) THEN
    RAISE EXCEPTION 'Identity-to-Actor compatibility links are incomplete';
  END IF;
  IF (SELECT count(*) FROM actor_role_bindings) <> (SELECT count(*) FROM role_bindings) THEN
    RAISE EXCEPTION 'Actor Role Binding backfill count does not match legacy bindings';
  END IF;
  IF (SELECT count(*) FROM guild_collective_settings) <> (SELECT count(*) FROM guilds) THEN
    RAISE EXCEPTION 'Every Guild requires Collective settings';
  END IF;
END;
$$;

CREATE INDEX actor_memberships_actor_idx
  ON actor_memberships (actor_id, guild_id, state);
CREATE INDEX actors_home_kind_status_idx
  ON actors (home_guild_id, kind, status, display_name, id);
CREATE INDEX actor_role_bindings_actor_idx
  ON actor_role_bindings (guild_id, actor_id, space_id);

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'actor_memberships', 'identity_actor_links', 'actor_role_bindings',
    'actor_agent_profiles', 'service_profiles', 'guild_actor_profiles',
    'collective_templates', 'vocabulary_profiles', 'guild_collective_settings'
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

ALTER TABLE actors ENABLE ROW LEVEL SECURITY;
ALTER TABLE actors FORCE ROW LEVEL SECURITY;
CREATE POLICY actor_guild_scope ON actors
  USING (
    home_guild_id = guild_runtime.current_guild_id()
    OR EXISTS (
      SELECT 1 FROM actor_memberships membership
       WHERE membership.actor_id = actors.id
         AND membership.guild_id = guild_runtime.current_guild_id()
    )
  )
  WITH CHECK (home_guild_id = guild_runtime.current_guild_id());

ALTER TABLE human_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE human_profiles FORCE ROW LEVEL SECURITY;
CREATE POLICY human_profile_guild_scope ON human_profiles
  USING (EXISTS (
    SELECT 1 FROM actors actor
     WHERE actor.id = human_profiles.actor_id
       AND (
         actor.home_guild_id = guild_runtime.current_guild_id()
         OR EXISTS (
           SELECT 1 FROM actor_memberships membership
            WHERE membership.actor_id = actor.id
              AND membership.guild_id = guild_runtime.current_guild_id()
         )
       )
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM actors actor
     WHERE actor.id = human_profiles.actor_id
       AND actor.home_guild_id = guild_runtime.current_guild_id()
  ));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'actors', 'actor_memberships', 'human_profiles', 'actor_agent_profiles',
    'service_profiles', 'guild_actor_profiles', 'collective_templates',
    'vocabulary_profiles', 'guild_collective_settings'
  ]
  LOOP
    EXECUTE format(
      'CREATE TRIGGER touch_updated_at BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guild_runtime.touch_updated_at()',
      table_name
    );
  END LOOP;
END;
$$;

CREATE FUNCTION guild_runtime.seed_new_guild_collective()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM guild_runtime.seed_collective_templates(NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER seed_new_guild_collective
AFTER INSERT ON guilds
FOR EACH ROW EXECUTE FUNCTION guild_runtime.seed_new_guild_collective();

ALTER TABLE guilds FORCE ROW LEVEL SECURITY;
ALTER TABLE identities FORCE ROW LEVEL SECURITY;
ALTER TABLE memberships FORCE ROW LEVEL SECURITY;
ALTER TABLE roles FORCE ROW LEVEL SECURITY;
ALTER TABLE role_permissions FORCE ROW LEVEL SECURITY;
ALTER TABLE role_bindings FORCE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
ALTER TABLE agent_profiles FORCE ROW LEVEL SECURITY;
