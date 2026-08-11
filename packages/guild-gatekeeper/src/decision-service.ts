import {
  CLASSIFICATIONS,
  VISIBILITIES,
  assertDecisionContent,
  assertDecisionOptions,
  assertDecisionReview,
  authorize,
  isAuthorized,
  type AuthorizationSnapshot,
  type Decision,
  type Permission,
  type SecuredResource,
} from "@guild-os/domain";
import {
  GuildDecisionRepository,
  listAuthorizedSpaces,
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type DecisionListCursor,
  type DecisionOptionWrite,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import { makeChronicleEvent } from "./chronicle.js";
import type { GuildEnv } from "./config.js";
import type {
  CreateDecisionRequest,
  DecisionResourceRequest,
  DecisionTransitionRequest,
  ReviewDecisionRequest,
  ReviewDecisionResponse,
  SaveDecisionDraftRequest,
  SupersedeDecisionRequest,
  UiDecisionCapabilities,
  UiDecisionDetail,
  UiDecisionPage,
  UiDecisionPageRequest,
  UiDecisionSummary,
} from "./management-types.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_REFERENCES = 100;
const DECISION_PAGE_SIZE = 30;

type KnowledgeBoundaryRow = {
  id: string;
  guild_id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Decision["visibility"];
  classification: Decision["classification"];
  allowed_identity_ids: string[];
};

function assertUuid(value: string, field: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${field} must be a UUID.`);
}

function assertExpectedVersion(value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error("Expected Decision version must be a positive integer.");
  }
}

function assertOptionalTimestamp(value: string | null, field: string): void {
  if (value !== null && Number.isNaN(Date.parse(value))) throw new Error(`${field} is invalid.`);
}

function assertResourceInput(input: DecisionResourceRequest): void {
  assertDecisionContent(input.title, input.description, input.rationale);
  assertDecisionOptions(input.options);
  if (input.spaceId !== null) assertUuid(input.spaceId, "Space ID");
  if (!(VISIBILITIES as readonly string[]).includes(input.visibility)) {
    throw new Error("Decision visibility is invalid.");
  }
  if (!(CLASSIFICATIONS as readonly string[]).includes(input.classification)) {
    throw new Error("Decision classification is invalid.");
  }
  if (input.visibility === "space" && input.spaceId === null) {
    throw new Error("Space-visible Decisions require a Space.");
  }
  if (input.visibility !== "restricted" && input.visibility !== "private" &&
      input.allowedIdentityIds.length > 0) {
    throw new Error("Explicit Identity access is valid only for restricted or private Decisions.");
  }
  assertOptionalTimestamp(input.reviewAt, "Decision review date");
  for (const [name, values] of [
    ["allowed Identity", input.allowedIdentityIds],
    ["source", input.sourceIds],
  ] as const) {
    if (!Array.isArray(values) || values.length > MAX_REFERENCES ||
        new Set(values).size !== values.length) {
      throw new Error(`Decision ${name} IDs must contain at most ${MAX_REFERENCES} unique values.`);
    }
    for (const value of values) assertUuid(value, `Decision ${name} ID`);
  }
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

function encodeCursor(cursor: DecisionListCursor | null): string | null {
  return cursor === null
    ? null
    : bytesToBase64Url(new TextEncoder().encode(JSON.stringify(cursor)));
}

function decodeCursor(value: string | null | undefined): DecisionListCursor | null {
  if (!value) return null;
  if (value.length > 1_000) throw new Error("Decision cursor is malformed.");
  try {
    const parsed: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(value)));
    if (!parsed || typeof parsed !== "object") throw new Error("invalid cursor");
    const cursor = parsed as Readonly<Record<string, unknown>>;
    if (typeof cursor.updatedAt !== "string" || typeof cursor.id !== "string" ||
        Number.isNaN(Date.parse(cursor.updatedAt))) throw new Error("invalid cursor");
    assertUuid(cursor.id, "Decision cursor ID");
    return { updatedAt: cursor.updatedAt, id: cursor.id };
  } catch {
    throw new Error("Decision cursor is malformed.");
  }
}

async function snapshotFor(
  cache: Map<string, Promise<AuthorizationSnapshot>>,
  connection: GuildTransactionConnection,
  guildId: string,
  actorIdentityId: string,
  spaceId: string | null,
): Promise<AuthorizationSnapshot> {
  const key = spaceId ?? "global";
  let snapshot = cache.get(key);
  if (!snapshot) {
    snapshot = loadActorAuthorizationSnapshot(connection, guildId, actorIdentityId, spaceId);
    cache.set(key, snapshot);
  }
  return snapshot;
}

function capabilities(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  decision: Decision,
  alreadyReviewed: boolean,
): UiDecisionCapabilities {
  const can = (permission: Permission) => isAuthorized(snapshot, {
    actorIdentityId,
    permission,
    resource: decision,
  });
  const canPropose = can("decision.propose");
  const canApprove = can("decision.approve");
  return {
    edit: decision.status === "draft" && canPropose,
    propose: decision.status === "draft" && canPropose,
    review: decision.status === "proposed" && canApprove && !alreadyReviewed,
    supersede: decision.status === "approved" && canApprove,
  };
}

function decisionForUi(
  decision: Decision,
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  alreadyReviewed = false,
): UiDecisionSummary {
  const { guildId: _guildId, ...rest } = decision;
  return { ...rest, capabilities: capabilities(snapshot, actorIdentityId, decision, alreadyReviewed) };
}

function optionWrites(input: DecisionResourceRequest): DecisionOptionWrite[] {
  return input.options.map((option, position) => ({
    id: crypto.randomUUID(),
    label: option.label,
    description: option.description,
    position,
  }));
}

export class GuildDecisionService {
  readonly #env: GuildEnv;
  readonly #accountId: string;

  constructor(env: GuildEnv, accountId: string) {
    this.#env = env;
    this.#accountId = accountId;
  }

  async getPage(request: UiDecisionPageRequest = {}): Promise<UiDecisionPage> {
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const page = await new GuildDecisionRepository(
          connection,
          this.#env.GUILD_ID,
        ).listDecisions(this.#accountId, decodeCursor(request.cursor), DECISION_PAGE_SIZE);
        const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
        const items: UiDecisionSummary[] = [];
        for (const decision of page.items) {
          const snapshot = await snapshotFor(
            snapshots,
            connection,
            this.#env.GUILD_ID,
            this.#accountId,
            decision.spaceId,
          );
          authorize(snapshot, {
            actorIdentityId: this.#accountId,
            permission: "decision.read",
            resource: decision,
          });
          items.push(decisionForUi(decision, snapshot, this.#accountId));
        }
        const creatableSpaces = await listAuthorizedSpaces(
          connection,
          this.#env.GUILD_ID,
          this.#accountId,
          "decision.propose",
        );
        return {
          items,
          nextCursor: encodeCursor(page.nextCursor),
          canCreate: creatableSpaces.length > 0,
        };
      },
    );
  }

  async getDecision(decisionId: string): Promise<UiDecisionDetail> {
    assertUuid(decisionId, "Decision ID");
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const decision = await repository.getDecision(decisionId);
        const snapshot = await this.#authorize(connection, decision, "decision.read");
        const detail = await repository.getDetail(decisionId);
        const alreadyReviewed = detail.approvals.some(
          (approval) => approval.approverIdentityId === this.#accountId,
        );
        return {
          decision: decisionForUi(decision, snapshot, this.#accountId, alreadyReviewed),
          options: detail.options.map(({ guildId: _guildId, decisionId: _decisionId, ...option }) => option),
          approvals: detail.approvals.map(
            ({ guildId: _guildId, decisionId: _decisionId, ...approval }) => approval,
          ),
        };
      },
    );
  }

  async create(input: CreateDecisionRequest): Promise<string> {
    assertResourceInput(input);
    const id = crypto.randomUUID();
    await withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const resource = this.#newResource(id, this.#accountId, input);
        await this.#authorize(connection, resource, "decision.propose");
        await this.#assertReferences(connection, input.allowedIdentityIds, input.sourceIds);
        await new GuildDecisionRepository(connection, this.#env.GUILD_ID).createDecision({
          ...input,
          id,
          options: optionWrites(input),
          actorIdentityId: this.#accountId,
          ownerIdentityId: this.#accountId,
          chronicleEvent: this.#event("decision.created", id, { status: "draft" }, resource),
        });
      },
    );
    return id;
  }

  async saveDraft(input: SaveDecisionDraftRequest): Promise<number> {
    assertUuid(input.decisionId, "Decision ID");
    assertExpectedVersion(input.expectedVersion);
    assertResourceInput(input);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const current = await repository.getDecision(input.decisionId);
        await this.#authorize(connection, current, "decision.propose");
        const proposed = this.#newResource(input.decisionId, current.ownerIdentityId, input);
        await this.#authorize(connection, proposed, "decision.propose");
        await this.#assertReferences(connection, input.allowedIdentityIds, input.sourceIds);
        return repository.saveDraft({
          ...input,
          id: input.decisionId,
          options: optionWrites(input),
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event("decision.draft.updated", input.decisionId, {
            expectedVersion: input.expectedVersion,
          }, proposed),
        });
      },
    );
  }

  async propose(input: DecisionTransitionRequest): Promise<number> {
    assertUuid(input.decisionId, "Decision ID");
    assertExpectedVersion(input.expectedVersion);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const decision = await repository.getDecision(input.decisionId);
        const snapshot = await this.#authorize(connection, decision, "decision.propose");
        return repository.propose({
          id: input.decisionId,
          expectedVersion: input.expectedVersion,
          actorIdentityId: this.#accountId,
          requiredApprovals: snapshot.constitution.level2ApprovalQuorum,
          chronicleEvent: this.#event("decision.proposed", input.decisionId, {
            requiredApprovals: snapshot.constitution.level2ApprovalQuorum,
          }, decision),
        });
      },
    );
  }

  async review(input: ReviewDecisionRequest): Promise<ReviewDecisionResponse> {
    assertUuid(input.decisionId, "Decision ID");
    assertExpectedVersion(input.expectedVersion);
    if (input.selectedOptionId !== null) assertUuid(input.selectedOptionId, "Decision option ID");
    assertDecisionReview(input.verdict, input.selectedOptionId, input.reason);
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const decision = await repository.getDecision(input.decisionId);
        await this.#authorize(connection, decision, "decision.approve");
        if (input.selectedOptionId !== null) {
          const detail = await repository.getDetail(input.decisionId);
          if (!detail.options.some((option) => option.id === input.selectedOptionId)) {
            throw new Error("Decision option does not belong to this Decision.");
          }
        }
        return repository.review({
          ...input,
          id: input.decisionId,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event("decision.reviewed", input.decisionId, {
            verdict: input.verdict,
            selectedOptionId: input.selectedOptionId,
          }, decision),
        });
      },
    );
  }

  async supersede(input: SupersedeDecisionRequest): Promise<number> {
    assertUuid(input.decisionId, "Decision ID");
    assertUuid(input.replacementDecisionId, "Replacement Decision ID");
    assertExpectedVersion(input.expectedVersion);
    if (input.decisionId === input.replacementDecisionId) {
      throw new Error("A Decision cannot supersede itself.");
    }
    return withGuildTransaction(
      this.#env.HYPERDRIVE.connectionString,
      this.#env.GUILD_ID,
      async (connection) => {
        const repository = new GuildDecisionRepository(connection, this.#env.GUILD_ID);
        const decision = await repository.getDecision(input.decisionId);
        const replacement = await repository.getDecision(input.replacementDecisionId);
        await this.#authorize(connection, decision, "decision.approve");
        await this.#authorize(connection, replacement, "decision.approve");
        this.#assertSameSecurityBoundary(decision, replacement);
        return repository.supersede({
          id: input.decisionId,
          replacementDecisionId: input.replacementDecisionId,
          expectedVersion: input.expectedVersion,
          actorIdentityId: this.#accountId,
          chronicleEvent: this.#event("decision.superseded", input.decisionId, {
            replacementDecisionId: input.replacementDecisionId,
          }, decision),
        });
      },
    );
  }

  async #authorize(
    connection: GuildTransactionConnection,
    resource: SecuredResource,
    permission: Permission,
  ): Promise<AuthorizationSnapshot> {
    const snapshot = await loadActorAuthorizationSnapshot(
      connection,
      this.#env.GUILD_ID,
      this.#accountId,
      resource.spaceId,
    );
    authorize(snapshot, { actorIdentityId: this.#accountId, permission, resource });
    return snapshot;
  }

  async #assertReferences(
    connection: GuildTransactionConnection,
    allowedIdentityIds: readonly string[],
    sourceIds: readonly string[],
  ): Promise<void> {
    if (allowedIdentityIds.length > 0) {
      const count = (await connection.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM identities
          WHERE guild_id = $1 AND id = ANY($2::uuid[]) AND status = 'active'`,
        [this.#env.GUILD_ID, allowedIdentityIds],
      )).rows[0]?.count;
      if ((count ?? 0) !== allowedIdentityIds.length) {
        throw new Error("A shared Decision Identity is not active in this Guild.");
      }
    }
    if (sourceIds.length === 0) return;
    const rows = (await connection.query<KnowledgeBoundaryRow>(
      `SELECT id::text, guild_id::text, space_id::text, owner_identity_id::text,
              visibility, classification, allowed_identity_ids::text[]
         FROM knowledge
        WHERE guild_id = $1 AND id = ANY($2::uuid[])`,
      [this.#env.GUILD_ID, sourceIds],
    )).rows;
    if (rows.length !== sourceIds.length) {
      throw new Error("A Decision source was not found in this Guild.");
    }
    const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
    for (const row of rows) {
      const resource: SecuredResource = {
        id: row.id,
        guildId: row.guild_id,
        spaceId: row.space_id,
        ownerIdentityId: row.owner_identity_id,
        visibility: row.visibility,
        classification: row.classification,
        allowedIdentityIds: row.allowed_identity_ids,
      };
      const snapshot = await snapshotFor(
        snapshots,
        connection,
        this.#env.GUILD_ID,
        this.#accountId,
        resource.spaceId,
      );
      authorize(snapshot, {
        actorIdentityId: this.#accountId,
        permission: "knowledge.read",
        resource,
      });
    }
  }

  #newResource(
    id: string,
    ownerIdentityId: string,
    input: DecisionResourceRequest,
  ): SecuredResource {
    return {
      id,
      guildId: this.#env.GUILD_ID,
      spaceId: input.spaceId,
      ownerIdentityId,
      visibility: input.visibility,
      classification: input.classification,
      allowedIdentityIds: input.allowedIdentityIds,
    };
  }

  #assertSameSecurityBoundary(decision: Decision, replacement: Decision): void {
    const allowed = (value: readonly string[] | undefined) => [...(value ?? [])].sort().join(",");
    if (decision.spaceId !== replacement.spaceId ||
        decision.visibility !== replacement.visibility ||
        decision.classification !== replacement.classification ||
        allowed(decision.allowedIdentityIds) !== allowed(replacement.allowedIdentityIds)) {
      throw new Error("A replacement Decision must preserve the original security boundary.");
    }
  }

  #event(
    action: string,
    subjectId: string,
    details: Readonly<Record<string, string | number | boolean | null>>,
    resource: SecuredResource,
  ) {
    return makeChronicleEvent(
      this.#env.GUILD_ID,
      this.#accountId,
      action,
      "decision",
      subjectId,
      { ...details, source: "guild-ui" },
      resource,
    );
  }
}
