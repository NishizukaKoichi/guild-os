import { createHash } from "node:crypto";
import {
  authorize,
  type AuthorizationSnapshot,
} from "@guild-os/domain";
import {
  GuildPortabilityRepository,
  GuildPostgresRepository,
  RETENTION_CATEGORIES,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
  type RetentionActionKind,
  type RetentionActionPlan,
  type RetentionCategory,
  type RetentionRunDetail,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import { assertRecentReauthentication } from "./reauthentication.js";
import { RETENTION_SQL_ALLOWLIST } from "./retention-runtime.js";

const MAX_RETENTION_HISTORY = 100;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface UiRetentionAction {
  readonly category: RetentionCategory;
  readonly action: RetentionActionKind;
  readonly status: "pending" | "processing" | "completed" | "failed";
  readonly candidateCount: number;
  readonly affectedCount: number;
  readonly errorSummary: string | null;
}

export interface UiRetentionRun {
  readonly id: string;
  readonly dryRun: boolean;
  readonly policyVersion: number;
  readonly cutoffAt: string;
  readonly status: "queued" | "processing" | "completed" | "failed";
  readonly irreversibleAuthorizationRecorded: boolean;
  readonly resultSummary: Readonly<Record<string, unknown>> | null;
  readonly errorSummary: string | null;
  readonly completedAt: string | null;
  readonly createdAt: string;
  readonly actions: readonly UiRetentionAction[];
}

export interface PlanRetentionInput {
  readonly dryRun: boolean;
  readonly cutoffAt: string;
  readonly actions: readonly RetentionActionPlan[];
  readonly previewRunId: string | null;
  readonly confirmation: string;
  readonly idempotencyKey: string;
}

interface NormalizedRetentionPlan extends PlanRetentionInput {
  readonly cutoffAt: string;
  readonly actions: readonly RetentionActionPlan[];
  readonly confirmation: string;
  readonly idempotencyKey: string;
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function supportsAction(category: RetentionCategory, action: RetentionActionKind): boolean {
  const plans: Readonly<Partial<Record<RetentionActionKind, unknown>>> =
    RETENTION_SQL_ALLOWLIST[category];
  return plans[action] !== undefined;
}

export function normalizeRetentionPlan(
  input: PlanRetentionInput,
  dataRetentionDays: number,
  now = Date.now(),
): NormalizedRetentionPlan {
  if (!Number.isSafeInteger(dataRetentionDays) || dataRetentionDays < 1) {
    throw new Error("The Constitution retention period is invalid.");
  }
  const cutoffTimestamp = Date.parse(input.cutoffAt);
  if (!Number.isFinite(cutoffTimestamp)) throw new Error("Retention cutoff is invalid.");
  const newestAllowedCutoff = now - dataRetentionDays * 86_400_000;
  if (cutoffTimestamp > newestAllowedCutoff) {
    throw new Error("Retention cannot affect data newer than the Constitution retention period.");
  }
  if (input.idempotencyKey.trim().length < 8 || input.idempotencyKey.length > 500) {
    throw new Error("Retention request ID must contain between 8 and 500 characters.");
  }
  if (input.actions.length < 1 || input.actions.length > RETENTION_CATEGORIES.length) {
    throw new Error("Select at least one supported retention category.");
  }
  const seen = new Set<RetentionCategory>();
  const actions = input.actions.map((candidate): RetentionActionPlan => {
    if (!(RETENTION_CATEGORIES as readonly string[]).includes(candidate.category) ||
        !(candidate.action === "retain" || candidate.action === "archive" ||
          candidate.action === "purge") ||
        !supportsAction(candidate.category, candidate.action)) {
      throw new Error("The selected retention action is not allowlisted.");
    }
    if (seen.has(candidate.category)) {
      throw new Error("A retention category can appear only once in a plan.");
    }
    seen.add(candidate.category);
    return { category: candidate.category, action: candidate.action };
  });

  const hasPurge = actions.some((action) => action.action === "purge");
  const hasMutation = actions.some((action) => action.action !== "retain");
  if (input.dryRun) {
    if (input.previewRunId !== null) throw new Error("A dry run cannot depend on another preview.");
  } else {
    if (!hasMutation) throw new Error("Use a dry run when every category is retained.");
    if (input.previewRunId === null) {
      throw new Error("Apply requires a completed matching dry run.");
    }
    assertUuid(input.previewRunId, "Retention preview ID");
    const expected = hasPurge ? "PURGE" : "APPLY";
    if (input.confirmation.trim() !== expected) {
      throw new Error(`Type ${expected} to confirm this retention operation.`);
    }
  }
  return {
    ...input,
    cutoffAt: new Date(cutoffTimestamp).toISOString(),
    actions,
    confirmation: input.confirmation.trim(),
    idempotencyKey: input.idempotencyKey.trim(),
  };
}

export function retentionRunForUi(detail: RetentionRunDetail): UiRetentionRun {
  return {
    id: detail.run.id,
    dryRun: detail.run.dryRun,
    policyVersion: detail.run.policyVersion,
    cutoffAt: detail.run.cutoffAt,
    status: detail.run.status,
    irreversibleAuthorizationRecorded: detail.run.authorizationEvidenceId !== null,
    resultSummary: detail.run.resultSummary,
    errorSummary: detail.run.errorSummary,
    completedAt: detail.run.completedAt,
    createdAt: detail.run.createdAt,
    actions: detail.actions.map((action) => ({
      category: action.category,
      action: action.action,
      status: action.status,
      candidateCount: action.candidateCount,
      affectedCount: action.affectedCount,
      errorSummary: action.errorSummary,
    })),
  };
}

function sameImmutablePlan(
  detail: RetentionRunDetail,
  policyVersion: number,
  cutoffAt: string,
  actions: readonly RetentionActionPlan[],
): boolean {
  return detail.run.policyVersion === policyVersion && detail.run.cutoffAt === cutoffAt &&
    detail.actions.length === actions.length && detail.actions.every((action, index) =>
      action.category === actions[index]?.category && action.action === actions[index]?.action);
}

function samePlan(
  preview: RetentionRunDetail,
  policyVersion: number,
  cutoffAt: string,
  actions: readonly RetentionActionPlan[],
): boolean {
  return preview.run.dryRun && preview.run.status === "completed" &&
    sameImmutablePlan(preview, policyVersion, cutoffAt, actions);
}

function isHumanRoot(snapshot: AuthorizationSnapshot, actorId: string): boolean {
  return snapshot.guild.rootOwnerIdentityId === actorId &&
    snapshot.identities.some((identity) =>
      identity.id === actorId && identity.kind === "human" && identity.status === "active");
}

async function loadAccessVerifier(
  connection: GuildTransactionConnection,
  guildId: string,
): Promise<string> {
  const row = (await connection.query<{ actor_id: string }>(
    `SELECT profile.actor_id::text
       FROM service_profiles profile
       JOIN actors actor ON actor.id = profile.actor_id
       JOIN actor_memberships membership
         ON membership.guild_id = profile.guild_id AND membership.actor_id = profile.actor_id
      WHERE profile.guild_id = $1 AND profile.service_type = 'access-verifier'
        AND actor.kind = 'service' AND actor.status = 'active'
        AND membership.state IN ('joined', 'active') AND membership.operational = true
      ORDER BY profile.actor_id LIMIT 1`,
    [guildId],
  )).rows[0];
  if (!row) {
    throw new Error("The Access verification Service is not initialized for this Guild.");
  }
  return row.actor_id;
}

export class GuildRetentionService {
  readonly #env: GuildEnv;
  readonly #accountId: string;
  readonly #verifiedAuthenticatedAt: string | null;

  constructor(env: GuildEnv, accountId: string, verifiedAuthenticatedAt: string | null = null) {
    this.#env = env;
    this.#accountId = accountId;
    this.#verifiedAuthenticatedAt = verifiedAuthenticatedAt;
  }

  async listRuns(): Promise<readonly UiRetentionRun[]> {
    return this.#authorized("data.read", async (connection) =>
      (await new GuildPortabilityRepository(connection, this.#env.GUILD_ID)
        .listRetentionRunDetails(MAX_RETENTION_HISTORY)).map(retentionRunForUi));
  }

  async plan(input: PlanRetentionInput): Promise<string> {
    return this.#authorized("data.manage", async (connection, snapshot) => {
      const plan = normalizeRetentionPlan(
        input,
        snapshot.constitution.dataRetentionDays,
      );
      const repository = new GuildPortabilityRepository(connection, this.#env.GUILD_ID);
      await connection.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [
        `retention-plan:${this.#env.GUILD_ID}:${this.#accountId}:${plan.idempotencyKey}`,
      ]);

      const existing = (await connection.query<{ id: string }>(
        `SELECT id::text FROM retention_runs
          WHERE guild_id = $1 AND idempotency_key = $2`,
        [this.#env.GUILD_ID, plan.idempotencyKey],
      )).rows[0];
      if (existing) {
        const detail = await repository.getRetentionRun(existing.id);
        if (detail.run.requestedByActorId !== this.#accountId ||
            detail.run.dryRun !== plan.dryRun ||
            !sameImmutablePlan(
              detail,
              snapshot.constitution.version,
              plan.cutoffAt,
              plan.actions,
            )) {
          throw new Error("Retention request ID was reused with a different plan.");
        }
        return detail.run.id;
      }

      let authorizationEvidenceId: string | null = null;
      if (!plan.dryRun) {
        if (!isHumanRoot(snapshot, this.#accountId)) {
          throw new Error("Only the active Human Root Owner can apply a retention mutation.");
        }
        const preview = await repository.getRetentionRun(plan.previewRunId!);
        if (!samePlan(preview, snapshot.constitution.version, plan.cutoffAt, plan.actions)) {
          throw new Error("The retention preview is incomplete, stale, or does not match this plan.");
        }
      }

      if (!plan.dryRun && plan.actions.some((action) => action.action === "purge")) {
        const verifiedAt = assertRecentReauthentication(this.#verifiedAuthenticatedAt, {
          missingMessage: "Permanent deletion requires recent identity-provider reauthentication.",
          expiredMessage: "Permanent deletion requires reauthentication within the last five minutes.",
        });
        const verifierActorId = await loadAccessVerifier(connection, this.#env.GUILD_ID);
        authorizationEvidenceId = crypto.randomUUID();
        const verificationEvent = makeChronicleEvent(
          this.#env.GUILD_ID,
          verifierActorId,
          "authorization.verified",
          "server_authorization_evidence",
          authorizationEvidenceId,
          {
            purpose: "retention.purge",
            subjectActorId: this.#accountId,
            verificationMethod: "cloudflare-access-login-iat",
            source: "guild-gatekeeper",
          },
        );
        await new GuildPostgresRepository(connection, this.#env.GUILD_ID)
          .appendChronicle(verificationEvent);
        const assertionSha256 = createHash("sha256").update(JSON.stringify({
          guildId: this.#env.GUILD_ID,
          actorId: this.#accountId,
          purpose: "retention.purge",
          verifiedAt,
        })).digest("hex");
        await connection.query(
          `INSERT INTO server_authorization_evidence
             (id, guild_id, subject_human_actor_id, verified_by_service_actor_id,
              purpose, verification_method, verifier_assertion_sha256,
              chronicle_event_id, expires_at)
           VALUES ($1, $2, $3, $4, 'retention.purge', 'cloudflare-access-login-iat',
                   $5, $6, now() + interval '5 minutes')`,
          [authorizationEvidenceId, this.#env.GUILD_ID, this.#accountId,
            verifierActorId, assertionSha256, verificationEvent.id],
        );
      }

      const runId = crypto.randomUUID();
      const result = await repository.planRetentionRun({
        id: runId,
        requestedByActorId: this.#accountId,
        dryRun: plan.dryRun,
        policyVersion: snapshot.constitution.version,
        cutoffAt: plan.cutoffAt,
        actions: plan.actions,
        authorizationEvidenceId,
        idempotencyKey: plan.idempotencyKey,
        chronicleEvent: makeChronicleEvent(
          this.#env.GUILD_ID,
          this.#accountId,
          "retention.planned",
          "retention_run",
          runId,
          {
            dryRun: plan.dryRun,
            previewRunId: plan.previewRunId,
            categories: plan.actions.map((action) => action.category).join(","),
            hasPurge: plan.actions.some((action) => action.action === "purge"),
            source: "guild-ui",
          },
        ),
      });
      return result.value.run.id;
    });
  }

  async #authorized<T>(
    permission: "data.read" | "data.manage",
    operation: (
      connection: GuildTransactionConnection,
      snapshot: AuthorizationSnapshot,
    ) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        const snapshot = await loadActorAuthorizationSnapshot(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
        );
        authorize(snapshot, { actorIdentityId: this.#accountId, permission });
        return operation(connection, snapshot);
      },
      undefined,
      "serializable",
    );
  }
}
