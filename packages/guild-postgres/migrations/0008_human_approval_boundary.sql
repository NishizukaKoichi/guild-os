CREATE OR REPLACE FUNCTION guild_runtime.permission_is_human_only(candidate text) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT candidate IN (
    'guild.manage', 'constitution.update', 'space.manage', 'identity.manage',
    'membership.manage', 'role.manage', 'knowledge.approve', 'decision.approve',
    'agent.manage', 'agent.approve', 'agent.stop', 'integration.manage', 'break-glass.use'
  )
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM role_bindings rb
      JOIN identities i ON i.guild_id = rb.guild_id AND i.id = rb.identity_id
      JOIN role_permissions rp ON rp.guild_id = rb.guild_id AND rp.role_id = rb.role_id
     WHERE i.kind <> 'human'
       AND guild_runtime.permission_is_human_only(rp.permission)
  ) THEN
    RAISE EXCEPTION 'Existing machine Role bindings contain human-only approval permissions';
  END IF;
END;
$$;
