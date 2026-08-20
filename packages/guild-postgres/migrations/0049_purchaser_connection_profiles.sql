-- Add semantic purchaser-owned Connection profiles without changing the
-- existing immutable Connection or forced-RLS boundaries. Each executable
-- profile is still mediated by the Gatekeeper capability allowlist.

ALTER TABLE connectors
  DROP CONSTRAINT connectors_kind_known,
  ADD CONSTRAINT connectors_kind_known CHECK (kind IN (
    'https_webhook', 'mcp', 'oauth', 'webhook', 'api',
    'cloudflare_gatekeeper', 'cloudflare_service', 'email', 'calendar',
    'file_storage', 'git_repository', 'external_api', 'model_provider',
    'database', 'storage'
  ));
