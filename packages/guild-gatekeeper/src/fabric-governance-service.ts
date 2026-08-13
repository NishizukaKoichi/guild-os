import type {
  ActivityType,
  AppLocale,
  Classification,
  DecisionMethod,
  MemoryType,
  Visibility,
} from "@guild-os/domain";
import {
  GuildFabricGovernanceRepository,
  withGuildTransaction,
  type GovernedContributionCorrection,
  type PrivateMessagePromotion,
  type PrivateMessagePromotionDestination,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";

export interface MemoryPromotionRequest {
  readonly kind: "memory";
  readonly spaceId: string | null;
  readonly visibility: Visibility;
  readonly classification: Classification;
  readonly allowedActorIds: readonly string[];
  readonly locale: AppLocale;
  readonly memoryType: MemoryType;
  readonly title: string;
  readonly summary: string;
}

export interface ActivityPromotionRequest {
  readonly kind: "activity";
  readonly spaceId: string | null;
  readonly visibility: Visibility;
  readonly classification: Classification;
  readonly allowedActorIds: readonly string[];
  readonly activityType: ActivityType;
  readonly title: string;
  readonly assigneeActorId: string | null;
}

export interface DecisionPromotionRequest {
  readonly kind: "decision";
  readonly spaceId: string | null;
  readonly visibility: Visibility;
  readonly classification: Classification;
  readonly allowedActorIds: readonly string[];
  readonly method: DecisionMethod;
  readonly title: string;
  readonly rationale: string;
}

export interface HandoverPromotionRequest {
  readonly kind: "handover";
  readonly departingActorId: string;
  readonly successorActorId: string | null;
}

export type PrivateMessagePromotionRequestDestination =
  | MemoryPromotionRequest
  | ActivityPromotionRequest
  | DecisionPromotionRequest
  | HandoverPromotionRequest;

export interface PromotePrivateMessageSelectionRequest {
  readonly threadId: string;
  readonly sourceMessageId: string;
  readonly selectionStart: number;
  readonly selectionLength: number;
  readonly idempotencyKey: string;
  readonly destination: PrivateMessagePromotionRequestDestination;
}

export interface RequestGovernedContributionCorrectionInput {
  readonly evidenceEventId: string;
  readonly reason: string;
}

export interface ReviewGovernedContributionCorrectionInput {
  readonly requestId: string;
  readonly expectedVersion: number;
  readonly outcome: "accepted" | "rejected";
  readonly reason: string;
}

function auditStamp(): { id: string; correlationId: string; occurredAt: string } {
  return {
    id: crypto.randomUUID(),
    correlationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
  };
}

function destinationWithServerId(
  request: PrivateMessagePromotionRequestDestination,
): PrivateMessagePromotionDestination {
  return { ...request, draftId: crypto.randomUUID() };
}

/**
 * Coordinates the explicit boundary between private conversation and Guild-owned
 * records. Source plaintext remains participant-only; the Chronicle receives only
 * the selected-content digest and destination metadata.
 */
export class GuildFabricGovernanceService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async promotePrivateMessageSelection(
    input: PromotePrivateMessageSelectionRequest,
  ): Promise<PrivateMessagePromotion> {
    return this.#transaction((repository) => repository.promotePrivateMessage({
      id: crypto.randomUUID(),
      actorId: this.#accountId,
      threadId: input.threadId,
      sourceMessageId: input.sourceMessageId,
      selectionStart: input.selectionStart,
      selectionLength: input.selectionLength,
      idempotencyKey: input.idempotencyKey,
      destination: destinationWithServerId(input.destination),
      audit: auditStamp(),
    }));
  }

  async listPrivateMessagePromotions(
    threadId: string,
  ): Promise<readonly PrivateMessagePromotion[]> {
    return this.#transaction((repository) =>
      repository.listPrivateMessagePromotions(this.#accountId, threadId));
  }

  async requestContributionCorrection(
    input: RequestGovernedContributionCorrectionInput,
  ): Promise<GovernedContributionCorrection> {
    return this.#transaction((repository) => repository.requestContributionCorrection({
      id: crypto.randomUUID(),
      actorId: this.#accountId,
      evidenceEventId: input.evidenceEventId,
      reason: input.reason,
      audit: auditStamp(),
    }));
  }

  async listOwnContributionCorrections(): Promise<readonly GovernedContributionCorrection[]> {
    return this.#transaction((repository) =>
      repository.listOwnContributionCorrections(this.#accountId));
  }

  async listPendingContributionCorrections(): Promise<readonly GovernedContributionCorrection[]> {
    return this.#transaction((repository) =>
      repository.listPendingContributionCorrections(this.#accountId));
  }

  async reviewContributionCorrection(
    input: ReviewGovernedContributionCorrectionInput,
  ): Promise<GovernedContributionCorrection> {
    return this.#transaction((repository) => repository.reviewContributionCorrection({
      requestId: input.requestId,
      reviewerActorId: this.#accountId,
      expectedVersion: input.expectedVersion,
      outcome: input.outcome,
      reason: input.reason,
      audit: auditStamp(),
    }));
  }

  async #transaction<T>(
    operation: (repository: GuildFabricGovernanceRepository) => Promise<T>,
  ): Promise<T> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [
          this.#accountId,
        ]);
        return operation(new GuildFabricGovernanceRepository(connection, this.#env.GUILD_ID));
      },
      undefined,
      "serializable",
    );
  }
}
