import assert from "node:assert/strict";
import test from "node:test";
import { loadMigrations, migrationChecksum } from "./migrate.mjs";

test("migration checksums are deterministic and content-sensitive", () => {
  assert.equal(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 1"));
  assert.notEqual(migrationChecksum("SELECT 1"), migrationChecksum("SELECT 2"));
});

test("migration files load in lexical order with SHA-256 checksums", async () => {
  const migrations = await loadMigrations();
  assert.deepEqual(migrations.map((migration) => migration.name), [
    "0001_guild_core.sql",
    "0002_product_v1.sql",
    "0003_identity_governance.sql",
    "0004_identity_profile_integrity.sql",
    "0005_fix_identity_pair_triggers.sql",
    "0006_knowledge_lifecycle.sql",
    "0007_knowledge_file_version_reuse.sql",
    "0008_human_approval_boundary.sql",
    "0009_knowledge_file_policy_history.sql",
    "0010_published_knowledge_security_lock.sql",
    "0011_work_governance.sql",
    "0012_work_parent_concurrency.sql",
    "0013_decision_governance.sql",
    "0014_decision_approval_scale.sql",
    "0015_decision_terminal_integrity.sql",
    "0016_communications_and_chronicle.sql",
    "0017_chronicle_search_tokens.sql",
    "0018_archived_announcement_provenance.sql",
    "0019_agent_execution.sql",
    "0020_agent_execution_compatibility.sql",
    "0021_agent_approval_trigger_fix.sql",
    "0022_constitution_governance.sql",
    "0023_root_ownership_transfer.sql",
    "0024_break_glass_recovery.sql",
    "0025_context_bound_conversations.sql",
    "0026_actor_collective_core.sql",
    "0027_memory_activity_core.sql",
    "0028_collective_compatibility.sql",
    "0029_agent_token_limits.sql",
    "0030_memory_context_and_custody.sql",
    "0031_lifecycle_communication_and_contribution.sql",
    "0032_connections_automation_and_federation.sql",
    "0033_agent_action_levels_and_models.sql",
    "0034_decision_method_semantics.sql",
    "0035_activity_dependencies_and_outcomes.sql",
    "0036_data_portability_and_retention.sql",
    "0037_intent_proposals.sql",
    "0038_private_promotion_and_contribution_review.sql",
    "0039_durable_automation_execution.sql",
    "0040_production_federation_transport.sql",
    "0041_purchaser_connection_agent_action.sql",
    "0042_access_verifier_service_backfill.sql",
    "0043_federation_runtime_service.sql",
    "0044_onboarding_role_scope.sql",
    "0045_private_promotion_request_fingerprint.sql",
    "0046_personal_context_profile.sql",
    "0047_purpose_blueprint_builder.sql",
    "0048_extended_decision_methods.sql",
    "0049_purchaser_connection_profiles.sql",
    "0050_memory_activity_type_completion.sql",
    "0051_backup_safe_function_search_path.sql",
  ]);
  for (const migration of migrations) {
    assert.match(migration.checksum, /^[a-f0-9]{64}$/);
  }
  assert.match(migrations[0].sql, /CREATE TABLE guilds/);
  assert.match(migrations[1].sql, /CREATE TABLE guild_invitations/);
  assert.match(migrations[2].sql, /role_binding_machine_boundary/);
  assert.match(migrations[3].sql, /identity_agent_profile_pair/);
  assert.match(migrations[4].sql, /CREATE OR REPLACE FUNCTION/);
  assert.match(migrations[5].sql, /CREATE TABLE knowledge_reviews/);
  assert.match(migrations[6].sql, /A file cannot cross Knowledge records/);
  assert.match(migrations[7].sql, /knowledge\.approve/);
  assert.match(migrations[11].sql, /Terminal Work requires every child Work item to be terminal/);
  assert.match(migrations[12].sql, /Decision approval quorum has not been reached/);
  assert.match(migrations[13].sql, /decisions_approval_count_check CHECK \(approval_count >= 0\)/);
  assert.match(migrations[14].sql, /A terminal Decision result is immutable/);
  assert.match(migrations[15].sql, /Inbox notification payload is immutable/);
  assert.match(migrations[16].sql, /translate\(action, '\._-'/);
  assert.match(migrations[17].sql, /OR status = 'archived'/);
  assert.match(migrations[18].sql, /Agent approval requires an authorized active Human/);
  assert.match(migrations[19].sql, /secret_was_cleared_on_revoke/);
  assert.match(migrations[20].sql, /IF TG_TABLE_NAME = 'approval_votes'/);
  assert.match(migrations[21].sql, /role_permissions_no_root_authority/);
  assert.match(migrations[21].sql, /app\.actor_identity_id/);
  assert.match(migrations[21].sql, /Constitution version must increment exactly once/);
  assert.match(migrations[22].sql, /Root ownership change requires an accepted two-party transfer/);
  assert.match(migrations[22].sql, /Root ownership transfer requires an atomic Chronicle event/);
  assert.match(migrations[22].sql, /pending_transfer_role_permission_guard/);
  assert.match(migrations[22].sql, /identities_active_human_name_search_idx/);
  assert.match(migrations[23].sql, /CREATE TABLE break_glass_code_sets/);
  assert.match(migrations[23].sql, /Break Glass recovery did not complete atomically/);
  assert.match(migrations[23].sql, /Root ownership change requires one authorized governance path/);
  assert.match(migrations[23].sql, /NEW\.state = 'superseded'/);
  assert.match(migrations[24].sql, /identity_can_access_conversation_subject/);
  assert.match(migrations[24].sql, /Conversation message mutation requires an atomic Chronicle event/);
  assert.match(migrations[25].sql, /CREATE TABLE actors/);
  assert.match(migrations[26].sql, /CREATE TABLE memories/);
  assert.match(migrations[26].sql, /CREATE TABLE activities/);
  assert.match(migrations[27].sql, /sync_identity_actor/);
  assert.match(migrations[28].sql, /agent_usage_within_limits/);
  assert.match(migrations[28].sql, /maxTokens/);
  assert.match(migrations[29].sql, /CREATE TABLE resource_custody/);
  assert.match(migrations[30].sql, /CREATE TABLE private_threads/);
  assert.match(migrations[30].sql, /CREATE TABLE onboarding_paths/);
  assert.match(migrations[30].sql, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(migrations[31].sql, /ALTER TABLE connectors/);
  assert.match(migrations[31].sql, /CREATE TABLE workflow_definitions/);
  assert.match(migrations[31].sql, /CREATE TABLE federation_links/);
  assert.match(migrations[32].sql, /agent_runs_action_kind_check/);
  assert.match(migrations[33].sql, /CREATE TABLE decision_method_snapshots/);
  assert.match(migrations[34].sql, /CREATE TABLE activity_dependency_versions/);
  assert.match(migrations[35].sql, /CREATE TABLE retention_runs/);
  assert.match(migrations[36].sql, /CREATE TABLE intent_proposals/);
  assert.match(migrations[37].sql, /CREATE TABLE private_message_promotions/);
  assert.match(migrations[38].sql, /ALTER TABLE workflow_run_requests/);
  assert.match(migrations[38].sql, /enforce_workflow_run_execution_transition/);
  assert.match(migrations[39].sql, /CREATE TABLE federation_inbound_resources/);
  assert.match(migrations[39].sql, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(migrations[40].sql, /connection\.invoke/);
  assert.match(migrations[41].sql, /Access verification Service backfill/);
  assert.match(migrations[42].sql, /Federation runtime Service backfill/);
  assert.match(migrations[43].sql, /CREATE TABLE onboarding_path_roles/);
  assert.match(migrations[45].sql, /Personal with AI Context Profile/);
  assert.match(migrations[46].sql, /CREATE TABLE collective_template_versions/);
  assert.match(migrations[46].sql, /Collective Blueprint version history is append-only/);
  assert.match(migrations[47].sql, /WHEN 'custom' THEN 'hybrid'/);
  assert.match(migrations[47].sql, /Decision quorum is below the Constitution requirement/);
  assert.match(migrations[48].sql, /cloudflare_gatekeeper/);
  assert.match(migrations[49].sql, /external_source/);
  assert.match(migrations[50].sql, /SET search_path TO pg_catalog, public/);
});
