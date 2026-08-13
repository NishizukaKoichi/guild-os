import type {
  ActivityType,
  ActorKind,
  ActorMembershipState,
  CollectiveTemplateKey,
  KnowledgeState,
  MemoryLayer,
  MemoryStatus,
} from "@guild-os/domain";

export type LifecycleActorKind = Extract<ActorKind, "human" | "agent">;

export interface LifecycleChronicleInput {
  performedByActorId: string;
  correlationId: string;
  occurredAt: string;
  reason: string;
  source: string;
}

export interface LifecycleChronicleEvent {
  idempotencyKey: string;
  guildId: string;
  actorId: string;
  action: "lifecycle.onboarding.assigned" |
    "lifecycle.memory.reconfirmation_assigned" |
    "lifecycle.actor.offboarded";
  subjectType: "actor" | "memory";
  subjectId: string;
  correlationId: string;
  occurredAt: string;
  reason: string;
  source: string;
  details: Readonly<Record<string, string | number | boolean | null>>;
}

export interface LifecycleRoleBinding {
  roleId: string;
  spaceId: string | null;
}

export interface LifecycleActorSnapshot {
  guildId: string;
  actorId: string;
  kind: LifecycleActorKind;
  identityOperational: boolean;
  membershipState: ActorMembershipState;
  membershipOperational: boolean;
  lifecycleEpoch: number;
  templateKey: CollectiveTemplateKey;
  roleBindings: readonly LifecycleRoleBinding[];
  isRootOwner: boolean;
}

export interface LifecycleApplicability {
  actorKinds: readonly LifecycleActorKind[];
  templateKeys: readonly CollectiveTemplateKey[];
  roleIds: readonly string[];
}

export interface CanonicalMemoryRequirementSource {
  memoryId: string;
  version: number;
  title: string;
  instructions: string;
  spaceId: string | null;
  status: MemoryStatus;
  layer: MemoryLayer;
  governanceState: KnowledgeState | null;
  applicability: LifecycleApplicability;
}

export interface InitialActivityRequirementSource {
  definitionKey: string;
  templateKey: CollectiveTemplateKey;
  templateVersion: number;
  title: string;
  instructions: string;
  activityType: ActivityType;
  spaceId: string | null;
  applicability: LifecycleApplicability;
}

export interface ActorOnboardingSnapshot {
  actor: LifecycleActorSnapshot;
  /** Present for the current schema. Omitted only by pre-0044 serialized fixtures. */
  onboardingPaths?: readonly OnboardingPathRequirementSource[];
  canonicalMemories: readonly CanonicalMemoryRequirementSource[];
  initialActivities: readonly InitialActivityRequirementSource[];
  existingRequirementKeys: readonly string[];
}

export interface OnboardingPathActivityBlueprint {
  definitionKey: string;
  activityType: ActivityType;
  title: string;
  instructions: string;
  targetSpaceId: string | null;
}

export interface OnboardingPathRequirementSource {
  pathId: string;
  pathVersion: number;
  name: string;
  description: string;
  spaceId: string | null;
  templateKey: CollectiveTemplateKey | null;
  applicability: LifecycleApplicability;
  initialActivities: readonly OnboardingPathActivityBlueprint[];
}

export interface CanonicalMemoryAudienceSnapshot {
  guildId: string;
  memory: CanonicalMemoryRequirementSource;
  actors: readonly LifecycleActorSnapshot[];
  existingRequirementKeys: readonly string[];
}

export interface MemoryConfirmationRequirement {
  idempotencyKey: string;
  kind: "memory_confirmation";
  guildId: string;
  actorId: string;
  targetSpaceId: string | null;
  title: string;
  instructions: string;
  required: true;
  memoryId: string;
  memoryVersion: number;
}

export interface InitialActivityRequirement {
  idempotencyKey: string;
  kind: "initial_activity";
  guildId: string;
  actorId: string;
  targetSpaceId: string | null;
  title: string;
  instructions: string;
  required: true;
  activityType: ActivityType;
  activityDefinitionKey: string;
  templateKey: CollectiveTemplateKey;
  templateVersion: number;
}

export interface OnboardingPathAssignmentRequirement {
  idempotencyKey: string;
  kind: "path_assignment";
  guildId: string;
  actorId: string;
  targetSpaceId: string | null;
  title: string;
  instructions: string;
  required: true;
  pathId: string;
  pathVersion: number;
  initialActivities: readonly OnboardingPathActivityBlueprint[];
}

export type LifecycleRequirement = MemoryConfirmationRequirement |
  InitialActivityRequirement | OnboardingPathAssignmentRequirement;

export interface OnboardingPlan {
  guildId: string;
  actorId: string;
  requirements: readonly LifecycleRequirement[];
}

export interface CanonicalMemoryReconfirmationPlan {
  guildId: string;
  memoryId: string;
  memoryVersion: number;
  requirements: readonly MemoryConfirmationRequirement[];
}

export interface LifecycleResourceReference {
  resourceId: string;
  title: string;
}

export interface GovernedDraftReference extends LifecycleResourceReference {
  resourceType: "memory" | "knowledge" | "decision";
}

export interface OffboardingSnapshot {
  actor: LifecycleActorSnapshot;
  successor: LifecycleActorSnapshot | null;
  accessTokenIds: readonly string[];
  connectorCredentialIds: readonly string[];
  scheduledRunIds: readonly string[];
  activeAgentRunIds: readonly string[];
  pendingApprovalIds: readonly string[];
  openActivities: readonly LifecycleResourceReference[];
  ownedFiles: readonly LifecycleResourceReference[];
  governedDrafts: readonly GovernedDraftReference[];
}

export type HandoverItemSource = "activity" | "file" | "governed_draft";

export interface PlannedHandoverItem {
  idempotencyKey: string;
  source: HandoverItemSource;
  resourceType: string;
  resourceId: string;
  title: string;
  disposition: "transfer" | "retain";
  successorActorId: string | null;
}

export interface OffboardingPlan {
  operationKey: string;
  guildId: string;
  actorId: string;
  actorKind: LifecycleActorKind;
  lifecycleEpoch: number;
  successorActorId: string | null;
  accessTokenIds: readonly string[];
  connectorCredentialIds: readonly string[];
  scheduledRunIds: readonly string[];
  activeAgentRunIds: readonly string[];
  pendingApprovalIds: readonly string[];
  handoverItems: readonly PlannedHandoverItem[];
}

export interface ActorStopResult {
  identityStopped: boolean;
  membershipStopped: boolean;
  agentProfileStopped: boolean;
}

export interface ConnectionRevocationResult {
  accessTokenIds: readonly string[];
  connectorCredentialIds: readonly string[];
}

export interface OffboardingSeal {
  identityOperational: boolean;
  membershipOperational: boolean;
  agentOperational: boolean;
  activeAccessTokenCount: number;
  activeConnectorCredentialCount: number;
  activeScheduledRunCount: number;
  activeAgentRunCount: number;
  pendingApprovalCount: number;
}

export interface HandoverCreationResult {
  handoverId: string;
  itemKeys: readonly string[];
}

export interface OffboardingReceipt {
  operationKey: string;
  guildId: string;
  actorId: string;
  actorKind: LifecycleActorKind;
  handoverId: string;
  handoverItemCount: number;
  revokedAccessTokenCount: number;
  revokedConnectorCredentialCount: number;
  stoppedScheduledRunCount: number;
  killedAgentRunCount: number;
  expiredApprovalCount: number;
  completedAt: string;
}

export interface LifecycleTransaction {
  loadActorOnboarding(actorId: string): Promise<ActorOnboardingSnapshot>;
  loadCanonicalMemoryAudience(memoryId: string): Promise<CanonicalMemoryAudienceSnapshot>;
  /**
   * Insert by idempotencyKey. For initial_activity, the adapter must also create and link the
   * Activity in this transaction; a duplicate key must return no insertion.
   */
  ensureOnboardingRequirements(
    requirements: readonly LifecycleRequirement[],
  ): Promise<readonly string[]>;
  loadOffboarding(
    actorId: string,
    successorActorId: string | null,
  ): Promise<OffboardingSnapshot>;
  findOffboardingReceipt(operationKey: string): Promise<OffboardingReceipt | null>;
  stopActorAccess(plan: OffboardingPlan): Promise<ActorStopResult>;
  revokeActorConnections(plan: OffboardingPlan): Promise<ConnectionRevocationResult>;
  stopActorSchedules(plan: OffboardingPlan): Promise<readonly string[]>;
  killActorRuns(plan: OffboardingPlan): Promise<readonly string[]>;
  expireActorApprovals(plan: OffboardingPlan): Promise<readonly string[]>;
  createHandover(plan: OffboardingPlan): Promise<HandoverCreationResult>;
  inspectOffboardingSeal(actorId: string): Promise<OffboardingSeal>;
  appendChronicle(event: LifecycleChronicleEvent): Promise<void>;
  saveOffboardingReceipt(receipt: OffboardingReceipt): Promise<void>;
}

export interface LifecycleAtomicScope {
  guildId: string;
  operation: "onboarding" | "reconfirmation" | "offboarding";
  lockKeys: readonly string[];
}

export interface LifecycleRepository {
  /**
   * The adapter must serialize all lockKeys and commit every callback mutation together.
   * If the callback throws, no mutation, Chronicle event, or receipt may remain visible.
   */
  transact<T>(
    scope: LifecycleAtomicScope,
    work: (transaction: LifecycleTransaction) => Promise<T>,
  ): Promise<T>;
}

export interface SynchronizeOnboardingInput {
  guildId: string;
  actorId: string;
  chronicle: LifecycleChronicleInput;
}

export interface ReconcileCanonicalMemoryInput {
  guildId: string;
  memoryId: string;
  chronicle: LifecycleChronicleInput;
}

export interface OffboardActorInput {
  guildId: string;
  actorId: string;
  successorActorId: string | null;
  chronicle: LifecycleChronicleInput;
}

export interface LifecycleRequirementResult {
  planned: readonly LifecycleRequirement[];
  insertedRequirementKeys: readonly string[];
}

const ONBOARDING_MEMBERSHIP_STATES: ReadonlySet<ActorMembershipState> = new Set([
  "joined",
  "active",
]);
const RECONFIRMATION_MEMBERSHIP_STATES: ReadonlySet<ActorMembershipState> = new Set([
  "joined",
  "active",
]);
const OFFBOARDABLE_MEMBERSHIP_STATES: ReadonlySet<ActorMembershipState> = new Set([
  "joined",
  "active",
  "paused",
  "blocked",
]);

function assertNonBlank(value: string, label: string): void {
  if (value.trim().length === 0) throw new Error(`${label} is required.`);
}

function assertChronicle(input: LifecycleChronicleInput): void {
  assertNonBlank(input.performedByActorId, "Chronicle performer");
  assertNonBlank(input.correlationId, "Chronicle correlation ID");
  assertNonBlank(input.reason, "Chronicle reason");
  assertNonBlank(input.source, "Chronicle source");
  if (Number.isNaN(Date.parse(input.occurredAt))) {
    throw new Error("Chronicle occurrence time is invalid.");
  }
}

function unique(values: readonly string[]): readonly string[] {
  return [...new Set(values)].sort();
}

function hasRoleInSpace(
  actor: LifecycleActorSnapshot,
  roleIds: readonly string[],
  spaceId: string | null,
): boolean {
  if (roleIds.length === 0 && spaceId === null) return true;
  return actor.roleBindings.some((binding) =>
    (roleIds.length === 0 || roleIds.includes(binding.roleId)) &&
    (spaceId === null || binding.spaceId === null || binding.spaceId === spaceId));
}

export function lifecycleScopeApplies(
  actor: LifecycleActorSnapshot,
  applicability: LifecycleApplicability,
  spaceId: string | null,
): boolean {
  if (applicability.actorKinds.length > 0 && !applicability.actorKinds.includes(actor.kind)) {
    return false;
  }
  if (applicability.templateKeys.length > 0 &&
      !applicability.templateKeys.includes(actor.templateKey)) {
    return false;
  }
  // Rows and serialized fixtures written before migration 0044 have no Role list;
  // preserving the legacy meaning makes them apply to every Role.
  return hasRoleInSpace(actor, applicability.roleIds ?? [], spaceId);
}

function isCanonicalMemory(memory: CanonicalMemoryRequirementSource): boolean {
  return memory.status === "active" && memory.layer === "canonical" &&
    memory.governanceState === "canonical" && Number.isInteger(memory.version) &&
    memory.version > 0;
}

function requirementKeyForMemory(
  actorId: string,
  memoryId: string,
  version: number,
): string {
  return `onboarding:${actorId}:memory:${memoryId}:v${version}`;
}

function requirementKeyForActivity(
  actorId: string,
  activity: InitialActivityRequirementSource,
): string {
  const space = activity.spaceId ?? "guild";
  return `onboarding:${actorId}:activity:${activity.templateKey}:v${activity.templateVersion}:${activity.definitionKey}:${space}`;
}

function requirementKeyForPath(
  actorId: string,
  pathId: string,
  pathVersion: number,
): string {
  return `onboarding:${actorId}:path:${pathId}:v${pathVersion}`;
}

function makePathAssignmentRequirement(
  actor: LifecycleActorSnapshot,
  path: OnboardingPathRequirementSource,
): OnboardingPathAssignmentRequirement {
  return {
    idempotencyKey: requirementKeyForPath(actor.actorId, path.pathId, path.pathVersion),
    kind: "path_assignment",
    guildId: actor.guildId,
    actorId: actor.actorId,
    targetSpaceId: path.spaceId,
    title: path.name,
    instructions: path.description,
    required: true,
    pathId: path.pathId,
    pathVersion: path.pathVersion,
    initialActivities: path.initialActivities,
  };
}

function makeMemoryRequirement(
  actor: LifecycleActorSnapshot,
  memory: CanonicalMemoryRequirementSource,
): MemoryConfirmationRequirement {
  return {
    idempotencyKey: requirementKeyForMemory(actor.actorId, memory.memoryId, memory.version),
    kind: "memory_confirmation",
    guildId: actor.guildId,
    actorId: actor.actorId,
    targetSpaceId: memory.spaceId,
    title: memory.title,
    instructions: memory.instructions,
    required: true,
    memoryId: memory.memoryId,
    memoryVersion: memory.version,
  };
}

function makeActivityRequirement(
  actor: LifecycleActorSnapshot,
  activity: InitialActivityRequirementSource,
): InitialActivityRequirement {
  return {
    idempotencyKey: requirementKeyForActivity(actor.actorId, activity),
    kind: "initial_activity",
    guildId: actor.guildId,
    actorId: actor.actorId,
    targetSpaceId: activity.spaceId,
    title: activity.title,
    instructions: activity.instructions,
    required: true,
    activityType: activity.activityType,
    activityDefinitionKey: activity.definitionKey,
    templateKey: activity.templateKey,
    templateVersion: activity.templateVersion,
  };
}

function deduplicateRequirements(
  requirements: readonly LifecycleRequirement[],
): readonly LifecycleRequirement[] {
  const byKey = new Map<string, LifecycleRequirement>();
  for (const requirement of requirements) {
    if (!byKey.has(requirement.idempotencyKey)) byKey.set(requirement.idempotencyKey, requirement);
  }
  return [...byKey.values()].sort((left, right) =>
    left.idempotencyKey.localeCompare(right.idempotencyKey));
}

export function buildOnboardingPlan(snapshot: ActorOnboardingSnapshot): OnboardingPlan {
  const { actor } = snapshot;
  if (!actor.identityOperational || !actor.membershipOperational ||
      !ONBOARDING_MEMBERSHIP_STATES.has(actor.membershipState)) {
    return { guildId: actor.guildId, actorId: actor.actorId, requirements: [] };
  }
  const existing = new Set(snapshot.existingRequirementKeys);
  if (snapshot.onboardingPaths !== undefined) {
    const requirements = deduplicateRequirements(snapshot.onboardingPaths
      .filter((path) =>
        (path.templateKey === null || path.templateKey === actor.templateKey) &&
        lifecycleScopeApplies(actor, path.applicability, path.spaceId))
      .map((path) => makePathAssignmentRequirement(actor, path)))
      .filter((requirement) => !existing.has(requirement.idempotencyKey));
    return { guildId: actor.guildId, actorId: actor.actorId, requirements };
  }
  const memoryRequirements = snapshot.canonicalMemories
    .filter((memory) => isCanonicalMemory(memory) &&
      lifecycleScopeApplies(actor, memory.applicability, memory.spaceId))
    .map((memory) => makeMemoryRequirement(actor, memory));
  const activityRequirements = snapshot.initialActivities
    .filter((activity) => activity.templateKey === actor.templateKey &&
      Number.isInteger(activity.templateVersion) && activity.templateVersion > 0 &&
      lifecycleScopeApplies(actor, activity.applicability, activity.spaceId))
    .map((activity) => makeActivityRequirement(actor, activity));
  const requirements = deduplicateRequirements([...memoryRequirements, ...activityRequirements])
    .filter((requirement) => !existing.has(requirement.idempotencyKey));
  return { guildId: actor.guildId, actorId: actor.actorId, requirements };
}

export function buildCanonicalMemoryReconfirmationPlan(
  snapshot: CanonicalMemoryAudienceSnapshot,
): CanonicalMemoryReconfirmationPlan {
  const existing = new Set(snapshot.existingRequirementKeys);
  const requirements = isCanonicalMemory(snapshot.memory)
    ? snapshot.actors
      .filter((actor) => actor.guildId === snapshot.guildId && actor.identityOperational &&
        actor.membershipOperational && RECONFIRMATION_MEMBERSHIP_STATES.has(actor.membershipState) &&
        lifecycleScopeApplies(actor, snapshot.memory.applicability, snapshot.memory.spaceId))
      .map((actor) => makeMemoryRequirement(actor, snapshot.memory))
    : [];
  return {
    guildId: snapshot.guildId,
    memoryId: snapshot.memory.memoryId,
    memoryVersion: snapshot.memory.version,
    requirements: deduplicateRequirements(requirements)
      .filter((requirement): requirement is MemoryConfirmationRequirement =>
        requirement.kind === "memory_confirmation" &&
        !existing.has(requirement.idempotencyKey)),
  };
}

function handoverItem(
  operationKey: string,
  source: HandoverItemSource,
  resourceType: string,
  resource: LifecycleResourceReference,
  successorActorId: string | null,
): PlannedHandoverItem {
  return {
    idempotencyKey: `${operationKey}:handover:${source}:${resourceType}:${resource.resourceId}`,
    source,
    resourceType,
    resourceId: resource.resourceId,
    title: resource.title,
    disposition: successorActorId === null ? "retain" : "transfer",
    successorActorId,
  };
}

export function buildOffboardingPlan(snapshot: OffboardingSnapshot): OffboardingPlan {
  const { actor, successor } = snapshot;
  if (actor.isRootOwner) throw new Error("Root ownership must be transferred before offboarding.");
  if (!actor.identityOperational || !actor.membershipOperational ||
      !OFFBOARDABLE_MEMBERSHIP_STATES.has(actor.membershipState)) {
    throw new Error("The Actor is not operational and cannot be offboarded.");
  }
  if (!Number.isInteger(actor.lifecycleEpoch) || actor.lifecycleEpoch < 1) {
    throw new Error("Actor lifecycle epoch is invalid.");
  }
  if (successor !== null && (successor.guildId !== actor.guildId ||
      successor.actorId === actor.actorId || !successor.identityOperational ||
      !successor.membershipOperational || successor.membershipState !== "active")) {
    throw new Error("The successor must be a different active Actor in the same Guild.");
  }
  const successorActorId = successor?.actorId ?? null;
  const operationKey = offboardingOperationKey(actor);
  const rawItems: PlannedHandoverItem[] = [
    ...snapshot.openActivities.map((resource) =>
      handoverItem(operationKey, "activity", "activity", resource, successorActorId)),
    ...snapshot.ownedFiles.map((resource) =>
      handoverItem(operationKey, "file", "file", resource, successorActorId)),
    ...snapshot.governedDrafts.map((resource) =>
      handoverItem(operationKey, "governed_draft", resource.resourceType, resource, successorActorId)),
  ];
  const itemsByKey = new Map(rawItems.map((item) => [item.idempotencyKey, item]));
  return {
    operationKey,
    guildId: actor.guildId,
    actorId: actor.actorId,
    actorKind: actor.kind,
    lifecycleEpoch: actor.lifecycleEpoch,
    successorActorId,
    accessTokenIds: unique(snapshot.accessTokenIds),
    connectorCredentialIds: unique(snapshot.connectorCredentialIds),
    scheduledRunIds: unique(snapshot.scheduledRunIds),
    activeAgentRunIds: unique(snapshot.activeAgentRunIds),
    pendingApprovalIds: unique(snapshot.pendingApprovalIds),
    handoverItems: [...itemsByKey.values()].sort((left, right) =>
      left.idempotencyKey.localeCompare(right.idempotencyKey)),
  };
}

function offboardingOperationKey(actor: LifecycleActorSnapshot): string {
  if (!Number.isInteger(actor.lifecycleEpoch) || actor.lifecycleEpoch < 1) {
    throw new Error("Actor lifecycle epoch is invalid.");
  }
  return `offboarding:${actor.guildId}:${actor.actorId}:epoch:${actor.lifecycleEpoch}`;
}

function stableDigest(values: readonly string[]): string {
  let hash = 0x811c9dc5;
  for (const character of values.join("\u001f")) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function assertInsertedKeys(
  planned: readonly LifecycleRequirement[],
  inserted: readonly string[],
): readonly string[] {
  const expected = new Set(planned.map((requirement) => requirement.idempotencyKey));
  const normalized = unique(inserted);
  if (normalized.length !== inserted.length || normalized.some((key) => !expected.has(key))) {
    throw new Error("Lifecycle repository returned invalid onboarding insertion evidence.");
  }
  return normalized;
}

function assertExactIds(label: string, expected: readonly string[], actual: readonly string[]): void {
  const normalizedExpected = unique(expected);
  const normalizedActual = unique(actual);
  if (normalizedActual.length !== actual.length ||
      normalizedExpected.length !== normalizedActual.length ||
      normalizedExpected.some((value, index) => value !== normalizedActual[index])) {
    throw new Error(`${label} did not cover every planned resource.`);
  }
}

function assertReceiptMatches(
  receipt: OffboardingReceipt,
  operationKey: string,
  guildId: string,
  actorId: string,
): void {
  if (receipt.operationKey !== operationKey || receipt.guildId !== guildId ||
      receipt.actorId !== actorId) {
    throw new Error("Offboarding receipt does not match the requested Actor lifecycle.");
  }
}

function assertSeal(plan: OffboardingPlan, seal: OffboardingSeal): void {
  const agentStillOperational = plan.actorKind === "agent" && seal.agentOperational;
  if (seal.identityOperational || seal.membershipOperational || agentStillOperational ||
      seal.activeAccessTokenCount !== 0 || seal.activeConnectorCredentialCount !== 0 ||
      seal.activeScheduledRunCount !== 0 || seal.activeAgentRunCount !== 0 ||
      seal.pendingApprovalCount !== 0) {
    throw new Error("Offboarding closure proof contains active access or work.");
  }
}

function lifecycleEvent(
  input: LifecycleChronicleInput,
  event: Omit<LifecycleChronicleEvent,
    "actorId" | "correlationId" | "occurredAt" | "reason" | "source">,
): LifecycleChronicleEvent {
  return {
    ...event,
    actorId: input.performedByActorId,
    correlationId: input.correlationId,
    occurredAt: input.occurredAt,
    reason: input.reason,
    source: input.source,
  };
}

export class GuildLifecycleRuntime {
  readonly #repository: LifecycleRepository;

  constructor(repository: LifecycleRepository) {
    this.#repository = repository;
  }

  async synchronizeOnboarding(
    input: SynchronizeOnboardingInput,
  ): Promise<LifecycleRequirementResult> {
    assertNonBlank(input.guildId, "Guild ID");
    assertNonBlank(input.actorId, "Actor ID");
    assertChronicle(input.chronicle);
    return this.#repository.transact({
      guildId: input.guildId,
      operation: "onboarding",
      lockKeys: [`actor:${input.actorId}`],
    }, async (transaction) => {
      const snapshot = await transaction.loadActorOnboarding(input.actorId);
      if (snapshot.actor.guildId !== input.guildId || snapshot.actor.actorId !== input.actorId) {
        throw new Error("Onboarding snapshot does not match the requested Actor.");
      }
      const plan = buildOnboardingPlan(snapshot);
      const inserted = assertInsertedKeys(
        plan.requirements,
        await transaction.ensureOnboardingRequirements(plan.requirements),
      );
      if (inserted.length > 0) {
        await transaction.appendChronicle(lifecycleEvent(input.chronicle, {
          idempotencyKey: `chronicle:onboarding:${input.actorId}:${stableDigest(inserted)}`,
          guildId: input.guildId,
          action: "lifecycle.onboarding.assigned",
          subjectType: "actor",
          subjectId: input.actorId,
          details: {
            actorKind: snapshot.actor.kind,
            templateKey: snapshot.actor.templateKey,
            requirementCount: inserted.length,
          },
        }));
      }
      return { planned: plan.requirements, insertedRequirementKeys: inserted };
    });
  }

  async reconcileCanonicalMemory(
    input: ReconcileCanonicalMemoryInput,
  ): Promise<LifecycleRequirementResult> {
    assertNonBlank(input.guildId, "Guild ID");
    assertNonBlank(input.memoryId, "Memory ID");
    assertChronicle(input.chronicle);
    return this.#repository.transact({
      guildId: input.guildId,
      operation: "reconfirmation",
      lockKeys: [`memory:${input.memoryId}`],
    }, async (transaction) => {
      const snapshot = await transaction.loadCanonicalMemoryAudience(input.memoryId);
      if (snapshot.guildId !== input.guildId || snapshot.memory.memoryId !== input.memoryId) {
        throw new Error("Memory audience snapshot does not match the requested Memory.");
      }
      const plan = buildCanonicalMemoryReconfirmationPlan(snapshot);
      const inserted = assertInsertedKeys(
        plan.requirements,
        await transaction.ensureOnboardingRequirements(plan.requirements),
      );
      if (inserted.length > 0) {
        await transaction.appendChronicle(lifecycleEvent(input.chronicle, {
          idempotencyKey: `chronicle:reconfirmation:${input.memoryId}:v${plan.memoryVersion}:${stableDigest(inserted)}`,
          guildId: input.guildId,
          action: "lifecycle.memory.reconfirmation_assigned",
          subjectType: "memory",
          subjectId: input.memoryId,
          details: {
            memoryVersion: plan.memoryVersion,
            targetActorCount: inserted.length,
          },
        }));
      }
      return { planned: plan.requirements, insertedRequirementKeys: inserted };
    });
  }

  async offboardActor(input: OffboardActorInput): Promise<OffboardingReceipt> {
    assertNonBlank(input.guildId, "Guild ID");
    assertNonBlank(input.actorId, "Actor ID");
    if (input.successorActorId !== null) assertNonBlank(input.successorActorId, "Successor Actor ID");
    assertChronicle(input.chronicle);
    return this.#repository.transact({
      guildId: input.guildId,
      operation: "offboarding",
      lockKeys: [`actor:${input.actorId}`],
    }, async (transaction) => {
      const snapshot = await transaction.loadOffboarding(input.actorId, input.successorActorId);
      if (snapshot.actor.guildId !== input.guildId || snapshot.actor.actorId !== input.actorId) {
        throw new Error("Offboarding snapshot does not match the requested Actor.");
      }
      const operationKey = offboardingOperationKey(snapshot.actor);
      const existing = await transaction.findOffboardingReceipt(operationKey);
      if (existing !== null) {
        assertReceiptMatches(existing, operationKey, input.guildId, input.actorId);
        return existing;
      }
      const plan = buildOffboardingPlan(snapshot);

      const actorStop = await transaction.stopActorAccess(plan);
      if (!actorStop.identityStopped || !actorStop.membershipStopped ||
          plan.actorKind === "agent" && !actorStop.agentProfileStopped) {
        throw new Error("Actor access was not fully stopped.");
      }
      const connectionResult = await transaction.revokeActorConnections(plan);
      assertExactIds("Access token revocation", plan.accessTokenIds, connectionResult.accessTokenIds);
      assertExactIds(
        "Connector credential revocation",
        plan.connectorCredentialIds,
        connectionResult.connectorCredentialIds,
      );
      const stoppedSchedules = await transaction.stopActorSchedules(plan);
      assertExactIds("Scheduled run stop", plan.scheduledRunIds, stoppedSchedules);
      const killedRuns = await transaction.killActorRuns(plan);
      assertExactIds("Agent run stop", plan.activeAgentRunIds, killedRuns);
      const expiredApprovals = await transaction.expireActorApprovals(plan);
      assertExactIds("Approval expiry", plan.pendingApprovalIds, expiredApprovals);
      const handover = await transaction.createHandover(plan);
      assertNonBlank(handover.handoverId, "Handover ID");
      assertExactIds(
        "Handover creation",
        plan.handoverItems.map((item) => item.idempotencyKey),
        handover.itemKeys,
      );
      assertSeal(plan, await transaction.inspectOffboardingSeal(plan.actorId));

      await transaction.appendChronicle(lifecycleEvent(input.chronicle, {
        idempotencyKey: `chronicle:${plan.operationKey}`,
        guildId: plan.guildId,
        action: "lifecycle.actor.offboarded",
        subjectType: "actor",
        subjectId: plan.actorId,
        details: {
          actorKind: plan.actorKind,
          successorActorId: plan.successorActorId,
          revokedAccessTokenCount: connectionResult.accessTokenIds.length,
          revokedConnectorCredentialCount: connectionResult.connectorCredentialIds.length,
          stoppedScheduledRunCount: stoppedSchedules.length,
          killedAgentRunCount: killedRuns.length,
          expiredApprovalCount: expiredApprovals.length,
          handoverItemCount: plan.handoverItems.length,
        },
      }));
      const receipt: OffboardingReceipt = {
        operationKey: plan.operationKey,
        guildId: plan.guildId,
        actorId: plan.actorId,
        actorKind: plan.actorKind,
        handoverId: handover.handoverId,
        handoverItemCount: plan.handoverItems.length,
        revokedAccessTokenCount: connectionResult.accessTokenIds.length,
        revokedConnectorCredentialCount: connectionResult.connectorCredentialIds.length,
        stoppedScheduledRunCount: stoppedSchedules.length,
        killedAgentRunCount: killedRuns.length,
        expiredApprovalCount: expiredApprovals.length,
        completedAt: input.chronicle.occurredAt,
      };
      await transaction.saveOffboardingReceipt(receipt);
      return receipt;
    });
  }
}
