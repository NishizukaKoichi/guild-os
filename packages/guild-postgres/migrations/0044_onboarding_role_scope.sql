CREATE TABLE onboarding_path_roles (
  guild_id uuid NOT NULL REFERENCES guilds(id) ON DELETE RESTRICT,
  path_id uuid NOT NULL,
  role_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, path_id, role_id),
  FOREIGN KEY (guild_id, path_id)
    REFERENCES onboarding_paths(guild_id, id) ON DELETE CASCADE,
  FOREIGN KEY (guild_id, role_id)
    REFERENCES roles(guild_id, id) ON DELETE RESTRICT
);

CREATE INDEX onboarding_path_roles_role_idx
  ON onboarding_path_roles (guild_id, role_id, path_id);

ALTER TABLE onboarding_path_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_path_roles FORCE ROW LEVEL SECURITY;

CREATE POLICY guild_scope ON onboarding_path_roles
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

COMMENT ON TABLE onboarding_path_roles IS
  'Optional Role applicability for onboarding paths. No rows means any Role in the path Space.';
