-- Add the missing model-token hard limit without changing IDs or invalidating old runtimes.
-- Older application versions ignore these additional JSON properties, so Worker rollback remains safe.

CREATE FUNCTION guild_runtime.valid_agent_limits(candidate jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(candidate) = 'object'
    AND jsonb_typeof(candidate -> 'currency') = 'string'
    AND (candidate ->> 'currency') ~ '^[A-Z]{3}$'
    AND jsonb_typeof(candidate -> 'maxBudgetMinor') = 'number'
    AND (candidate ->> 'maxBudgetMinor') ~ '^[0-9]+$'
    AND (candidate ->> 'maxBudgetMinor')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'maxTokens') = 'number'
    AND (candidate ->> 'maxTokens') ~ '^[1-9][0-9]*$'
    AND (candidate ->> 'maxTokens')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'maxDurationSeconds') = 'number'
    AND (candidate ->> 'maxDurationSeconds') ~ '^[1-9][0-9]*$'
    AND (candidate ->> 'maxDurationSeconds')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'maxSteps') = 'number'
    AND (candidate ->> 'maxSteps') ~ '^[1-9][0-9]*$'
    AND (candidate ->> 'maxSteps')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'maxRetries') = 'number'
    AND (candidate ->> 'maxRetries') ~ '^[0-9]+$'
    AND (candidate ->> 'maxRetries')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'maxDelegationDepth') = 'number'
    AND (candidate ->> 'maxDelegationDepth') ~ '^[0-9]+$'
    AND (candidate ->> 'maxDelegationDepth')::numeric <= 9007199254740991
$$;

CREATE FUNCTION guild_runtime.valid_agent_usage(candidate jsonb) RETURNS boolean
LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT jsonb_typeof(candidate) = 'object'
    AND jsonb_typeof(candidate -> 'budgetMinor') = 'number'
    AND (candidate ->> 'budgetMinor') ~ '^[0-9]+$'
    AND (candidate ->> 'budgetMinor')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'tokens') = 'number'
    AND (candidate ->> 'tokens') ~ '^[0-9]+$'
    AND (candidate ->> 'tokens')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'durationSeconds') = 'number'
    AND (candidate ->> 'durationSeconds') ~ '^[0-9]+$'
    AND (candidate ->> 'durationSeconds')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'steps') = 'number'
    AND (candidate ->> 'steps') ~ '^[0-9]+$'
    AND (candidate ->> 'steps')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'retries') = 'number'
    AND (candidate ->> 'retries') ~ '^[0-9]+$'
    AND (candidate ->> 'retries')::numeric <= 9007199254740991
    AND jsonb_typeof(candidate -> 'delegationDepth') = 'number'
    AND (candidate ->> 'delegationDepth') ~ '^[0-9]+$'
    AND (candidate ->> 'delegationDepth')::numeric <= 9007199254740991
$$;

CREATE FUNCTION guild_runtime.agent_usage_within_limits(limits jsonb, usage jsonb)
RETURNS boolean LANGUAGE sql IMMUTABLE PARALLEL SAFE AS $$
  SELECT guild_runtime.valid_agent_limits(limits)
    AND guild_runtime.valid_agent_usage(usage)
    AND (usage ->> 'budgetMinor')::numeric <= (limits ->> 'maxBudgetMinor')::numeric
    AND (usage ->> 'tokens')::numeric <= (limits ->> 'maxTokens')::numeric
    AND (usage ->> 'durationSeconds')::numeric <= (limits ->> 'maxDurationSeconds')::numeric
    AND (usage ->> 'steps')::numeric <= (limits ->> 'maxSteps')::numeric
    AND (usage ->> 'retries')::numeric <= (limits ->> 'maxRetries')::numeric
    AND (usage ->> 'delegationDepth')::numeric <= (limits ->> 'maxDelegationDepth')::numeric
$$;

DROP TRIGGER constitution_governance ON constitutions;
UPDATE constitutions
   SET agent_defaults = agent_defaults || '{"maxTokens": 100000}'::jsonb
 WHERE NOT agent_defaults ? 'maxTokens';
CREATE TRIGGER constitution_governance
BEFORE INSERT OR UPDATE ON constitutions
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_constitution_governance();

UPDATE agent_profiles
   SET limits = limits || '{"maxTokens": 100000}'::jsonb
 WHERE NOT limits ? 'maxTokens';

UPDATE actor_agent_profiles
   SET limits = limits || '{"maxTokens": 100000}'::jsonb
 WHERE NOT limits ? 'maxTokens';

DROP TRIGGER agent_run_integrity ON agent_runs;
UPDATE agent_runs
   SET limits = limits || '{"maxTokens": 100000}'::jsonb,
       usage = usage || '{"tokens": 0}'::jsonb,
       plan = CASE
         WHEN jsonb_typeof(plan -> 'estimatedUsage') = 'object'
           THEN jsonb_set(plan, '{estimatedUsage,tokens}', '0'::jsonb, true)
         ELSE plan
       END;
CREATE TRIGGER agent_run_integrity
BEFORE INSERT OR UPDATE ON agent_runs
FOR EACH ROW EXECUTE FUNCTION guild_runtime.enforce_agent_run_integrity();

ALTER TABLE agent_profiles DROP CONSTRAINT agent_profiles_limits_valid;
ALTER TABLE agent_profiles
  ADD CONSTRAINT agent_profiles_limits_valid
  CHECK (guild_runtime.valid_agent_limits(limits));

ALTER TABLE constitutions DROP CONSTRAINT constitution_agent_defaults_valid;
ALTER TABLE constitutions
  ADD CONSTRAINT constitution_agent_defaults_valid
  CHECK (guild_runtime.valid_agent_limits(agent_defaults));

ALTER TABLE actor_agent_profiles
  ADD CONSTRAINT actor_agent_profiles_limits_valid
  CHECK (guild_runtime.valid_agent_limits(limits));

ALTER TABLE agent_runs
  ADD CONSTRAINT agent_runs_limits_valid
    CHECK (guild_runtime.valid_agent_limits(limits)),
  ADD CONSTRAINT agent_runs_usage_valid
    CHECK (guild_runtime.agent_usage_within_limits(limits, usage)),
  ADD CONSTRAINT agent_runs_estimated_usage_valid
    CHECK (
      plan IS NULL OR guild_runtime.agent_usage_within_limits(
        limits,
        plan -> 'estimatedUsage'
      )
    );
