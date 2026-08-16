-- Add purchaser-owned, versioned Purpose-first Blueprints without changing built-in Template keys.

ALTER TABLE collective_templates NO FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_collective_settings NO FORCE ROW LEVEL SECURITY;
ALTER TABLE spaces NO FORCE ROW LEVEL SECURITY;

ALTER TABLE collective_templates
  ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  ADD COLUMN status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  ADD COLUMN locale text NOT NULL DEFAULT 'en'
    CHECK (locale IN ('en', 'ja', 'zh-CN')),
  ADD COLUMN onboarding_answers jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(onboarding_answers) = 'object'),
  ADD COLUMN generation_mode text NOT NULL DEFAULT 'manual'
    CHECK (generation_mode IN ('deterministic', 'model-assisted', 'manual')),
  ADD COLUMN generation_warnings jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(generation_warnings) = 'array'),
  ADD COLUMN created_by_actor_id uuid,
  ADD COLUMN updated_by_actor_id uuid,
  ADD CONSTRAINT collective_templates_custom_key
    CHECK (system OR key ~ '^custom-[a-z0-9][a-z0-9-]{1,55}$'),
  ADD CONSTRAINT collective_templates_created_by_actor_fk
    FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id) ON DELETE RESTRICT,
  ADD CONSTRAINT collective_templates_updated_by_actor_fk
    FOREIGN KEY (guild_id, updated_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id) ON DELETE RESTRICT;

CREATE TABLE collective_template_versions (
  guild_id uuid NOT NULL,
  template_key text NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 100),
  description text NOT NULL CHECK (length(description) <= 2000),
  definition jsonb NOT NULL CHECK (jsonb_typeof(definition) = 'object'),
  locale text NOT NULL CHECK (locale IN ('en', 'ja', 'zh-CN')),
  onboarding_answers jsonb NOT NULL CHECK (jsonb_typeof(onboarding_answers) = 'object'),
  generation_mode text NOT NULL
    CHECK (generation_mode IN ('deterministic', 'model-assisted', 'manual')),
  generation_warnings jsonb NOT NULL CHECK (jsonb_typeof(generation_warnings) = 'array'),
  status text NOT NULL CHECK (status IN ('active', 'archived')),
  created_by_actor_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guild_id, template_key, version),
  FOREIGN KEY (guild_id, template_key)
    REFERENCES collective_templates(guild_id, key) ON DELETE RESTRICT,
  FOREIGN KEY (guild_id, created_by_actor_id)
    REFERENCES actor_memberships(guild_id, actor_id) ON DELETE RESTRICT
);

INSERT INTO collective_template_versions (
  guild_id, template_key, version, name, description, definition, locale,
  onboarding_answers, generation_mode, generation_warnings, status,
  created_by_actor_id, created_at
)
SELECT guild_id, key, 1, name, description, definition, locale,
       onboarding_answers, generation_mode, generation_warnings, status,
       created_by_actor_id, created_at
  FROM collective_templates;

ALTER TABLE guild_collective_settings
  ADD COLUMN blueprint_key text,
  ADD CONSTRAINT guild_collective_settings_blueprint_fk
    FOREIGN KEY (guild_id, blueprint_key)
    REFERENCES collective_templates(guild_id, key) ON DELETE RESTRICT;

ALTER TABLE spaces
  ADD COLUMN blueprint_key text,
  ADD CONSTRAINT spaces_blueprint_fk
    FOREIGN KEY (guild_id, blueprint_key)
    REFERENCES collective_templates(guild_id, key) ON DELETE RESTRICT;

CREATE FUNCTION guild_runtime.guard_collective_template_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  content_changed boolean;
BEGIN
  IF NEW.guild_id IS DISTINCT FROM OLD.guild_id
     OR NEW.key IS DISTINCT FROM OLD.key
     OR NEW.system IS DISTINCT FROM OLD.system
     OR NEW.created_by_actor_id IS DISTINCT FROM OLD.created_by_actor_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Collective Blueprint identity is immutable';
  END IF;
  content_changed := ROW(
    NEW.name, NEW.description, NEW.definition, NEW.status, NEW.locale,
    NEW.onboarding_answers, NEW.generation_mode, NEW.generation_warnings,
    NEW.updated_by_actor_id
  ) IS DISTINCT FROM ROW(
    OLD.name, OLD.description, OLD.definition, OLD.status, OLD.locale,
    OLD.onboarding_answers, OLD.generation_mode, OLD.generation_warnings,
    OLD.updated_by_actor_id
  );
  IF content_changed AND NEW.version <> OLD.version + 1 THEN
    RAISE EXCEPTION 'Collective Blueprint changes must increment version exactly once';
  END IF;
  IF NOT content_changed AND NEW.version <> OLD.version THEN
    RAISE EXCEPTION 'Collective Blueprint version cannot change without content';
  END IF;
  IF NEW.system AND content_changed THEN
    RAISE EXCEPTION 'Built-in Collective Templates cannot be edited through Blueprint storage';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collective_template_version_guard
BEFORE UPDATE ON collective_templates
FOR EACH ROW EXECUTE FUNCTION guild_runtime.guard_collective_template_version();

CREATE FUNCTION guild_runtime.record_collective_template_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.version <> OLD.version THEN
    INSERT INTO collective_template_versions (
      guild_id, template_key, version, name, description, definition, locale,
      onboarding_answers, generation_mode, generation_warnings, status,
      created_by_actor_id, created_at
    ) VALUES (
      NEW.guild_id, NEW.key, NEW.version, NEW.name, NEW.description, NEW.definition,
      NEW.locale, NEW.onboarding_answers, NEW.generation_mode, NEW.generation_warnings,
      NEW.status, NEW.updated_by_actor_id, NEW.updated_at
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER collective_template_version_record
AFTER INSERT OR UPDATE ON collective_templates
FOR EACH ROW EXECUTE FUNCTION guild_runtime.record_collective_template_version();

CREATE FUNCTION guild_runtime.reject_collective_template_version_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Collective Blueprint version history is append-only';
END;
$$;

CREATE TRIGGER collective_template_versions_append_only
BEFORE UPDATE OR DELETE ON collective_template_versions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.reject_collective_template_version_mutation();

ALTER TABLE collective_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE collective_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY guild_scope ON collective_template_versions
  USING (guild_id = guild_runtime.current_guild_id())
  WITH CHECK (guild_id = guild_runtime.current_guild_id());

CREATE INDEX collective_template_versions_recent_idx
  ON collective_template_versions (guild_id, template_key, version DESC);
CREATE INDEX collective_templates_custom_status_idx
  ON collective_templates (guild_id, status, updated_at DESC, key)
  WHERE NOT system;
CREATE INDEX spaces_blueprint_idx
  ON spaces (guild_id, blueprint_key)
  WHERE blueprint_key IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM collective_templates template
     WHERE NOT template.system
       AND NOT EXISTS (
         SELECT 1
           FROM collective_template_versions version
          WHERE version.guild_id = template.guild_id
            AND version.template_key = template.key
            AND version.version = template.version
       )
  ) THEN
    RAISE EXCEPTION 'Every custom Collective Blueprint requires a current immutable version';
  END IF;
END;
$$;

ALTER TABLE collective_templates FORCE ROW LEVEL SECURITY;
ALTER TABLE guild_collective_settings FORCE ROW LEVEL SECURITY;
ALTER TABLE spaces FORCE ROW LEVEL SECURITY;
