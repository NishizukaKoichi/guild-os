-- Make one Human plus governed AI assistants a first-class Collective Template.
-- Existing Guilds receive the Profile without changing their selected Template.

ALTER TABLE guilds NO FORCE ROW LEVEL SECURITY;
ALTER TABLE collective_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_profiles NO FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_collective_settings NO FORCE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION guild_runtime.seed_collective_templates(target_guild_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  template record;
BEGIN
  FOR template IN
    SELECT * FROM (VALUES
      ('personal', 'Personal with AI', 'One Human owner and governed AI assistants.'),
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

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM guilds guild_row
     WHERE NOT EXISTS (
       SELECT 1
         FROM collective_templates template
        WHERE template.guild_id = guild_row.id
          AND template.key = 'personal'
          AND template.system
     ) OR NOT EXISTS (
       SELECT 1
         FROM vocabulary_profiles profile
        WHERE profile.guild_id = guild_row.id
          AND profile.key = 'personal'
          AND profile.template_key = 'personal'
          AND profile.system
     )
  ) THEN
    RAISE EXCEPTION 'Every Guild must have the Personal with AI Context Profile';
  END IF;
END;
$$;

SET CONSTRAINTS ALL IMMEDIATE;

ALTER TABLE guilds FORCE ROW LEVEL SECURITY;
ALTER TABLE collective_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE vocabulary_profiles FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_collective_settings FORCE ROW LEVEL SECURITY;
