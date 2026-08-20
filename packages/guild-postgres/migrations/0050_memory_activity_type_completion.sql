-- Promote the remaining authoritative neutral Memory and Activity aliases to
-- first-class values. Namespaced custom values remain available for purchaser
-- extensions, and existing rows continue to satisfy the widened constraints.

ALTER TABLE memories
  DROP CONSTRAINT memories_type_check,
  ADD CONSTRAINT memories_type_check CHECK (
    type IN (
      'fact', 'document', 'conversation', 'event', 'experience', 'rule',
      'decision', 'artifact', 'research', 'data', 'manual', 'failure',
      'learning', 'external', 'external_source', 'agent_output', 'knowledge'
    ) OR type ~ '^custom:[a-z0-9][a-z0-9_-]{1,62}$'
  );

ALTER TABLE activities
  DROP CONSTRAINT activities_type_check,
  ADD CONSTRAINT activities_type_check CHECK (
    type IN (
      'task', 'project', 'quest', 'event', 'discussion', 'experiment',
      'study', 'campaign', 'ritual', 'session', 'creation', 'maintenance',
      'investigation', 'mission', 'goal', 'step'
    ) OR type ~ '^custom:[a-z0-9][a-z0-9_-]{1,62}$'
  );
