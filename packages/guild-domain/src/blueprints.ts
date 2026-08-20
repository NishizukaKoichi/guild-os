import {
  ACTIVITY_STATUSES,
  DECISION_METHODS,
  HUMAN_ONLY_PERMISSIONS,
  PERMISSIONS,
  SUPPORTED_LOCALES,
} from "./constants.js";
import { assertActivityStatus, assertActivityTransition, assertActivityType, assertMemoryType } from "./collective.js";
import { GuildDomainError } from "./errors.js";
import { COLLECTIVE_ROLE_CAPABILITY_BUNDLES, assertVocabularyOverrides } from "./templates.js";
import type {
  ActivityStatus,
  ActivityType,
  AppLocale,
  CollectiveOnboardingAnswers,
  CollectiveTemplate,
  CollectiveTemplateLabels,
  CollectiveWorkflowPreset,
  DecisionMethod,
  MemoryType,
  Permission,
} from "./types.js";

export const COLLECTIVE_BLUEPRINT_SCHEMA_VERSION = 2 as const;
export const BLUEPRINT_CAPABILITY_BUNDLES = [
  "observe",
  "participate",
  "coordinate",
  "administer",
] as const;
export type BlueprintCapabilityBundle = (typeof BLUEPRINT_CAPABILITY_BUNDLES)[number];
export type BlueprintGenerationMode = "deterministic" | "model-assisted" | "manual";
export type CollectiveBlueprintStatus = "active" | "archived";

export interface CollectiveBlueprintRole {
  key: string;
  name: string;
  description: string;
  capabilityBundle: BlueprintCapabilityBundle;
  capabilities: readonly Permission[];
}

export interface CollectiveBlueprintSpace {
  key: string;
  name: string;
  description: string;
  parentKey: string | null;
}

export interface CollectiveBlueprintMemoryType {
  type: MemoryType;
  label: string;
  description: string;
}

export interface CollectiveBlueprintActivityType {
  type: ActivityType;
  label: string;
  description: string;
  states: readonly ActivityStatus[];
}

export interface CollectiveBlueprintDecisionMethod {
  key: string;
  label: string;
  description: string;
  method: DecisionMethod;
}

export interface CollectiveBlueprintWorkflow {
  key: string;
  name: string;
  description: string;
  activityType: ActivityType | null;
  memoryType: MemoryType | null;
  decisionMethodKey: string | null;
}

export interface CollectiveBlueprintAgent {
  name: string;
  purpose: string;
  roleKey: string;
  permissions: readonly Permission[];
  toolIds: readonly ("memory_search" | "activity_draft")[];
  limits: CollectiveBlueprintAgentLimits;
  approvalPolicyKey: string;
}

export interface CollectiveBlueprintAgentLimits {
  maximumBudgetUsdCents: number;
  maximumTokens: number;
  maximumDurationSeconds: number;
  maximumSteps: number;
  maximumRetries: number;
  maximumDelegations: number;
}

export type CollectiveVisualThemePreset =
  | "system"
  | "quiet"
  | "warm"
  | "formal"
  | "playful";

export interface CollectiveBlueprintVisualTheme {
  preset: CollectiveVisualThemePreset;
  accent: "blue" | "green" | "amber" | "rose" | "violet";
  description: string;
}

export interface CollectiveBlueprintApprovalPolicy {
  key: string;
  name: string;
  description: string;
  riskLevel: 0 | 1 | 2 | 3;
  decisionMethodKey: string;
  minimumApprovals: number;
  humanRequired: boolean;
}

export type CollectiveConnectionKind =
  | "cloudflare-gatekeeper"
  | "mcp"
  | "https-webhook"
  | "service-binding"
  | "email"
  | "calendar"
  | "file-storage"
  | "git"
  | "external-api"
  | "model-provider";

export interface CollectiveBlueprintConnectionSuggestion {
  key: string;
  name: string;
  description: string;
  kind: CollectiveConnectionKind;
  capabilityAllowlist: readonly Permission[];
  humanApprovalRequired: boolean;
}

export interface CollectiveBlueprintLifecyclePolicy {
  name: string;
  description: string;
  steps: readonly string[];
}

export interface CollectiveBlueprintRetentionPolicy {
  defaultDays: number;
  description: string;
  dryRunRequired: true;
}

export interface CollectiveBlueprintExportPolicy {
  formats: readonly ("json" | "markdown" | "csv" | "files")[];
  includeHistory: boolean;
  includePersonalData: "never" | "explicit-consent";
  excludePlaintextSecrets: true;
}

export interface CollectiveBlueprintDefinition {
  schemaVersion: typeof COLLECTIVE_BLUEPRINT_SCHEMA_VERSION;
  name: string;
  purpose: string;
  description: string;
  visualTheme: CollectiveBlueprintVisualTheme;
  labels: CollectiveTemplateLabels;
  roles: readonly CollectiveBlueprintRole[];
  spaces: readonly CollectiveBlueprintSpace[];
  memoryTypes: readonly CollectiveBlueprintMemoryType[];
  activityTypes: readonly CollectiveBlueprintActivityType[];
  decisionMethods: readonly CollectiveBlueprintDecisionMethod[];
  dashboardIntents: readonly ("ask" | "remember" | "start" | "review" | "members")[];
  workflows: readonly CollectiveBlueprintWorkflow[];
  approvalPolicies: readonly CollectiveBlueprintApprovalPolicy[];
  connectionSuggestions: readonly CollectiveBlueprintConnectionSuggestion[];
  onboarding: CollectiveBlueprintLifecyclePolicy;
  offboarding: CollectiveBlueprintLifecyclePolicy;
  retentionPolicy: CollectiveBlueprintRetentionPolicy;
  exportPolicy: CollectiveBlueprintExportPolicy;
  recommendedAgents: readonly CollectiveBlueprintAgent[];
  /** @deprecated Compatibility alias for older Template consumers. */
  suggestedAgent: CollectiveBlueprintAgent | null;
}

export interface CollectiveBlueprintDraft {
  key: `custom-${string}`;
  locale: AppLocale;
  generationMode: BlueprintGenerationMode;
  generationWarnings: readonly string[];
  onboardingAnswers: CollectiveOnboardingAnswers;
  definition: CollectiveBlueprintDefinition;
}

export interface CollectiveBlueprintRecord extends CollectiveBlueprintDraft {
  guildId: string;
  version: number;
  status: CollectiveBlueprintStatus;
  system: boolean;
  createdByActorId: string | null;
  updatedByActorId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PurposeBlueprintInput {
  locale: AppLocale;
  answers: CollectiveOnboardingAnswers;
}

export interface ExistingAuthorityRole {
  name: string;
  permissions: readonly Permission[];
}

export type BlueprintAuthorityImpactKind =
  | "role-addition"
  | "role-retirement"
  | "capability-addition"
  | "capability-removal";

export interface BlueprintAuthorityImpact {
  kind: BlueprintAuthorityImpactKind;
  roleName: string;
  capabilities: readonly Permission[];
}

export interface BlueprintAuthorityMigrationProposal {
  schemaVersion: 1;
  blueprintKey: `custom-${string}`;
  blueprintName: string;
  impacts: readonly BlueprintAuthorityImpact[];
  riskLevel: 3;
  requiresHumanApproval: true;
  appliesAutomatically: false;
  rollbackRequired: true;
}

const keyPattern = /^[a-z][a-z0-9-]{1,62}$/;
const customKeyPattern = /^custom-[a-z0-9][a-z0-9-]{1,55}$/;
const typeKeyPattern = /^[a-z0-9][a-z0-9_-]{1,62}$/;
const knownPermission = new Set<string>(PERMISSIONS);
const knownBundle = new Set<string>(BLUEPRINT_CAPABILITY_BUNDLES);
const dashboardIntents = new Set<string>(["ask", "remember", "start", "review", "members"]);
const visualThemePresets = new Set<string>(["system", "quiet", "warm", "formal", "playful"]);
const visualThemeAccents = new Set<string>(["blue", "green", "amber", "rose", "violet"]);
const connectionKinds = new Set<string>([
  "cloudflare-gatekeeper", "mcp", "https-webhook", "service-binding", "email",
  "calendar", "file-storage", "git", "external-api", "model-provider",
]);
const exportFormats = new Set<string>(["json", "markdown", "csv", "files"]);
const safeAgentPermissions = new Set<Permission>([
  "memory.read",
  "activity.read",
  "activity.create",
  "decision.read",
  "relation.read",
  "conversation.read",
  "conversation.create",
  "run.create",
  "agent.read",
  "agent.run",
  "event.read",
]);
const onboardingAnswerKeys = [
  "purpose",
  "participants",
  "memoryIntent",
  "activityIntent",
  "decisionStyle",
  "languageAndStyle",
  "agentIntent",
  "humanApprovalIntent",
] as const satisfies readonly (keyof CollectiveOnboardingAnswers)[];

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): void {
  const allowed = new Set([...required, ...optional]);
  for (const key of required) {
    if (!(key in value)) throw new GuildDomainError("INVALID_INPUT", `${label}.${key} is required.`);
  }
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new GuildDomainError("INVALID_INPUT", `${label}.${key} is not supported.`);
  }
}

function stringValue(value: unknown, label: string, max = 2_000): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.length > max) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must contain 1 to ${max} characters.`);
  }
  return value.trim();
}

function keyValue(value: unknown, label: string): string {
  const key = stringValue(value, label, 63);
  if (!keyPattern.test(key)) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must be a lowercase URL-safe key.`);
  }
  return key;
}

function uniqueBy<T>(values: readonly T[], value: (item: T) => string, label: string): void {
  const keys = values.map(value);
  if (new Set(keys).size !== keys.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must use unique keys.`);
  }
}

function arrayValue(value: unknown, label: string, min: number, max: number): readonly unknown[] {
  if (!Array.isArray(value) || value.length < min || value.length > max) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must contain ${min} to ${max} items.`);
  }
  return value;
}

function integerValue(value: unknown, label: string, minimum: number, maximum: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must be between ${minimum} and ${maximum}.`);
  }
  return value as number;
}

function booleanValue(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new GuildDomainError("INVALID_INPUT", `${label} must be true or false.`);
  }
  return value;
}

export function blueprintCapabilities(bundle: BlueprintCapabilityBundle): readonly Permission[] {
  return COLLECTIVE_ROLE_CAPABILITY_BUNDLES[bundle];
}

function assertPermissions(value: unknown, bundle: BlueprintCapabilityBundle, label: string): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > PERMISSIONS.length ||
      value.some((item) => typeof item !== "string" || !knownPermission.has(item)) ||
      new Set(value).size !== value.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label} contains invalid Capabilities.`);
  }
  const expected = blueprintCapabilities(bundle);
  if (value.length !== expected.length || value.some((item) => !expected.includes(item as Permission))) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `${label} must match its reviewed Capability bundle.`,
    );
  }
}

function assertAgentPermissions(value: unknown, role: CollectiveBlueprintRole, label: string): void {
  if (!Array.isArray(value) || value.length < 1 || value.length > safeAgentPermissions.size ||
      value.some((item) => typeof item !== "string" || !safeAgentPermissions.has(item as Permission) ||
        HUMAN_ONLY_PERMISSIONS.has(item as Permission) || !role.capabilities.includes(item as Permission)) ||
      new Set(value).size !== value.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label} contains unsafe Agent permissions.`);
  }
}

function parseRole(value: unknown, index: number): CollectiveBlueprintRole {
  const label = `Blueprint roles[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ["key", "name", "description", "capabilityBundle", "capabilities"], [], label);
  const capabilityBundle = stringValue(value.capabilityBundle, `${label}.capabilityBundle`, 20);
  if (!knownBundle.has(capabilityBundle)) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.capabilityBundle is invalid.`);
  }
  assertPermissions(value.capabilities, capabilityBundle as BlueprintCapabilityBundle, `${label}.capabilities`);
  return {
    key: keyValue(value.key, `${label}.key`),
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    capabilityBundle: capabilityBundle as BlueprintCapabilityBundle,
    capabilities: [...value.capabilities as Permission[]],
  };
}

function parseSpace(value: unknown, index: number): CollectiveBlueprintSpace {
  const label = `Blueprint spaces[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ["key", "name", "description", "parentKey"], [], label);
  return {
    key: keyValue(value.key, `${label}.key`),
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    parentKey: value.parentKey === null ? null : keyValue(value.parentKey, `${label}.parentKey`),
  };
}

function parseMemoryType(value: unknown, index: number): CollectiveBlueprintMemoryType {
  const label = `Blueprint memoryTypes[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ["type", "label", "description"], [], label);
  const type = stringValue(value.type, `${label}.type`, 70);
  assertMemoryType(type);
  return {
    type,
    label: stringValue(value.label, `${label}.label`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
  };
}

function parseActivityType(value: unknown, index: number): CollectiveBlueprintActivityType {
  const label = `Blueprint activityTypes[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ["type", "label", "description", "states"], [], label);
  const type = stringValue(value.type, `${label}.type`, 70);
  assertActivityType(type);
  const states = arrayValue(value.states, `${label}.states`, 2, ACTIVITY_STATUSES.length)
    .map((state, stateIndex) => {
      const parsed = stringValue(state, `${label}.states[${stateIndex}]`, 20);
      assertActivityStatus(parsed);
      return parsed;
    });
  if (new Set(states).size !== states.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.states must be unique.`);
  }
  for (let index = 1; index < states.length; index += 1) {
    assertActivityTransition(states[index - 1]!, states[index]!);
  }
  return {
    type,
    label: stringValue(value.label, `${label}.label`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    states,
  };
}

function parseDecisionMethod(value: unknown, index: number): CollectiveBlueprintDecisionMethod {
  const label = `Blueprint decisionMethods[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, ["key", "label", "description", "method"], [], label);
  const method = stringValue(value.method, `${label}.method`, 20);
  if (!(DECISION_METHODS as readonly string[]).includes(method)) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.method is invalid.`);
  }
  return {
    key: keyValue(value.key, `${label}.key`),
    label: stringValue(value.label, `${label}.label`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    method: method as DecisionMethod,
  };
}

function parseWorkflow(value: unknown, index: number): CollectiveBlueprintWorkflow {
  const label = `Blueprint workflows[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, [
    "key", "name", "description", "activityType", "memoryType", "decisionMethodKey",
  ], [], label);
  const activityType = value.activityType === null
    ? null
    : stringValue(value.activityType, `${label}.activityType`, 70);
  if (activityType !== null) assertActivityType(activityType);
  const memoryType = value.memoryType === null
    ? null
    : stringValue(value.memoryType, `${label}.memoryType`, 70);
  if (memoryType !== null) assertMemoryType(memoryType);
  return {
    key: keyValue(value.key, `${label}.key`),
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    activityType,
    memoryType,
    decisionMethodKey: value.decisionMethodKey === null
      ? null
      : keyValue(value.decisionMethodKey, `${label}.decisionMethodKey`),
  };
}

const defaultAgentLimits: CollectiveBlueprintAgentLimits = {
  maximumBudgetUsdCents: 0,
  maximumTokens: 32_000,
  maximumDurationSeconds: 300,
  maximumSteps: 12,
  maximumRetries: 1,
  maximumDelegations: 0,
};

function parseAgentLimits(value: unknown, label: string): CollectiveBlueprintAgentLimits {
  assertRecord(value, label);
  assertExactKeys(value, [
    "maximumBudgetUsdCents", "maximumTokens", "maximumDurationSeconds", "maximumSteps",
    "maximumRetries", "maximumDelegations",
  ], [], label);
  return {
    maximumBudgetUsdCents: integerValue(value.maximumBudgetUsdCents, `${label}.maximumBudgetUsdCents`, 0, 100_000_000),
    maximumTokens: integerValue(value.maximumTokens, `${label}.maximumTokens`, 1_000, 10_000_000),
    maximumDurationSeconds: integerValue(value.maximumDurationSeconds, `${label}.maximumDurationSeconds`, 1, 86_400),
    maximumSteps: integerValue(value.maximumSteps, `${label}.maximumSteps`, 1, 1_000),
    maximumRetries: integerValue(value.maximumRetries, `${label}.maximumRetries`, 0, 20),
    maximumDelegations: integerValue(value.maximumDelegations, `${label}.maximumDelegations`, 0, 20),
  };
}

function parseAgent(
  value: unknown,
  roles: readonly CollectiveBlueprintRole[],
  label = "Blueprint Agent",
  legacy = false,
): CollectiveBlueprintAgent | null {
  if (value === null) return null;
  assertRecord(value, label);
  assertExactKeys(
    value,
    ["name", "purpose", "roleKey", "permissions", "toolIds"],
    legacy ? ["limits", "approvalPolicyKey"] : ["limits", "approvalPolicyKey"],
    label,
  );
  if (!legacy && (!("limits" in value) || !("approvalPolicyKey" in value))) {
    throw new GuildDomainError("INVALID_INPUT", `${label} must define limits and an approval policy.`);
  }
  const roleKey = keyValue(value.roleKey, `${label}.roleKey`);
  const role = roles.find((candidate) => candidate.key === roleKey);
  if (!role) throw new GuildDomainError("INVALID_INPUT", `${label}.roleKey is unknown.`);
  assertAgentPermissions(value.permissions, role, `${label}.permissions`);
  if (!Array.isArray(value.toolIds) || value.toolIds.length < 1 || value.toolIds.length > 2 ||
      value.toolIds.some((tool) => tool !== "memory_search" && tool !== "activity_draft") ||
      new Set(value.toolIds).size !== value.toolIds.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.toolIds contains unsupported tools.`);
  }
  return {
    name: stringValue(value.name, `${label}.name`, 100),
    purpose: stringValue(value.purpose, `${label}.purpose`, 1_000),
    roleKey,
    permissions: [...value.permissions as Permission[]],
    toolIds: [...value.toolIds as CollectiveBlueprintAgent["toolIds"]],
    limits: value.limits === undefined
      ? { ...defaultAgentLimits }
      : parseAgentLimits(value.limits, `${label}.limits`),
    approvalPolicyKey: value.approvalPolicyKey === undefined
      ? "external-action"
      : keyValue(value.approvalPolicyKey, `${label}.approvalPolicyKey`),
  };
}

function parseVisualTheme(value: unknown): CollectiveBlueprintVisualTheme {
  const label = "Blueprint visualTheme";
  assertRecord(value, label);
  assertExactKeys(value, ["preset", "accent", "description"], [], label);
  const preset = stringValue(value.preset, `${label}.preset`, 20);
  const accent = stringValue(value.accent, `${label}.accent`, 20);
  if (!visualThemePresets.has(preset) || !visualThemeAccents.has(accent)) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint visual theme is unsupported.");
  }
  return {
    preset: preset as CollectiveVisualThemePreset,
    accent: accent as CollectiveBlueprintVisualTheme["accent"],
    description: stringValue(value.description, `${label}.description`, 500),
  };
}

function parseApprovalPolicy(value: unknown, index: number): CollectiveBlueprintApprovalPolicy {
  const label = `Blueprint approvalPolicies[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, [
    "key", "name", "description", "riskLevel", "decisionMethodKey", "minimumApprovals",
    "humanRequired",
  ], [], label);
  return {
    key: keyValue(value.key, `${label}.key`),
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    riskLevel: integerValue(value.riskLevel, `${label}.riskLevel`, 0, 3) as 0 | 1 | 2 | 3,
    decisionMethodKey: keyValue(value.decisionMethodKey, `${label}.decisionMethodKey`),
    minimumApprovals: integerValue(value.minimumApprovals, `${label}.minimumApprovals`, 0, 20),
    humanRequired: booleanValue(value.humanRequired, `${label}.humanRequired`),
  };
}

function parseConnectionSuggestion(
  value: unknown,
  index: number,
): CollectiveBlueprintConnectionSuggestion {
  const label = `Blueprint connectionSuggestions[${index}]`;
  assertRecord(value, label);
  assertExactKeys(value, [
    "key", "name", "description", "kind", "capabilityAllowlist", "humanApprovalRequired",
  ], [], label);
  const kind = stringValue(value.kind, `${label}.kind`, 30);
  if (!connectionKinds.has(kind)) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.kind is unsupported.`);
  }
  if (!Array.isArray(value.capabilityAllowlist) || value.capabilityAllowlist.length > PERMISSIONS.length ||
      value.capabilityAllowlist.some((permission) =>
        typeof permission !== "string" || !knownPermission.has(permission)) ||
      new Set(value.capabilityAllowlist).size !== value.capabilityAllowlist.length) {
    throw new GuildDomainError("INVALID_INPUT", `${label}.capabilityAllowlist is invalid.`);
  }
  return {
    key: keyValue(value.key, `${label}.key`),
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    kind: kind as CollectiveConnectionKind,
    capabilityAllowlist: [...value.capabilityAllowlist as Permission[]],
    humanApprovalRequired: booleanValue(value.humanApprovalRequired, `${label}.humanApprovalRequired`),
  };
}

function parseLifecyclePolicy(value: unknown, label: string): CollectiveBlueprintLifecyclePolicy {
  assertRecord(value, label);
  assertExactKeys(value, ["name", "description", "steps"], [], label);
  const steps = arrayValue(value.steps, `${label}.steps`, 1, 12)
    .map((step, index) => stringValue(step, `${label}.steps[${index}]`, 300));
  return {
    name: stringValue(value.name, `${label}.name`, 100),
    description: stringValue(value.description, `${label}.description`, 500),
    steps,
  };
}

function parseRetentionPolicy(value: unknown): CollectiveBlueprintRetentionPolicy {
  const label = "Blueprint retentionPolicy";
  assertRecord(value, label);
  assertExactKeys(value, ["defaultDays", "description", "dryRunRequired"], [], label);
  if (value.dryRunRequired !== true) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint retention always requires a dry run.");
  }
  return {
    defaultDays: integerValue(value.defaultDays, `${label}.defaultDays`, 1, 36_500),
    description: stringValue(value.description, `${label}.description`, 500),
    dryRunRequired: true,
  };
}

function parseExportPolicy(value: unknown): CollectiveBlueprintExportPolicy {
  const label = "Blueprint exportPolicy";
  assertRecord(value, label);
  assertExactKeys(value, [
    "formats", "includeHistory", "includePersonalData", "excludePlaintextSecrets",
  ], [], label);
  const formats = arrayValue(value.formats, `${label}.formats`, 1, 4)
    .map((format, index) => stringValue(format, `${label}.formats[${index}]`, 20));
  if (formats.some((format) => !exportFormats.has(format)) || new Set(formats).size !== formats.length) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint export formats are invalid.");
  }
  if (value.includePersonalData !== "never" && value.includePersonalData !== "explicit-consent") {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint Personal Data export policy is invalid.");
  }
  if (value.excludePlaintextSecrets !== true) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint exports must exclude plaintext Secrets.");
  }
  return {
    formats: formats as CollectiveBlueprintExportPolicy["formats"],
    includeHistory: booleanValue(value.includeHistory, `${label}.includeHistory`),
    includePersonalData: value.includePersonalData,
    excludePlaintextSecrets: true,
  };
}

export function parseCollectiveBlueprintDefinition(value: unknown): CollectiveBlueprintDefinition {
  const label = "Blueprint definition";
  assertRecord(value, label);
  const schemaVersion = value.schemaVersion;
  const legacy = schemaVersion === 1;
  if (!legacy && schemaVersion !== COLLECTIVE_BLUEPRINT_SCHEMA_VERSION) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint schema version is unsupported.");
  }
  const baseKeys = [
    "schemaVersion", "name", "purpose", "description", "labels", "roles", "spaces",
    "memoryTypes", "activityTypes", "decisionMethods", "dashboardIntents", "workflows",
    "suggestedAgent",
  ];
  const extendedKeys = [
    "visualTheme", "approvalPolicies", "connectionSuggestions", "onboarding", "offboarding",
    "retentionPolicy", "exportPolicy", "recommendedAgents",
  ];
  assertExactKeys(value, legacy ? baseKeys : [...baseKeys, ...extendedKeys], [], label);
  assertVocabularyOverrides(value.labels);
  const labelKeys = Object.keys(value.labels);
  if (labelKeys.length !== 19) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint vocabulary must define every UI concept.");
  }
  const roles = arrayValue(value.roles, "Blueprint roles", 2, 8).map(parseRole);
  const spaces = arrayValue(value.spaces, "Blueprint spaces", 1, 12).map(parseSpace);
  const memoryTypes = arrayValue(value.memoryTypes, "Blueprint memoryTypes", 1, 12).map(parseMemoryType);
  const activityTypes = arrayValue(value.activityTypes, "Blueprint activityTypes", 1, 12).map(parseActivityType);
  const decisionMethods = arrayValue(value.decisionMethods, "Blueprint decisionMethods", 1, 8)
    .map(parseDecisionMethod);
  const workflows = arrayValue(value.workflows, "Blueprint workflows", 1, 12).map(parseWorkflow);
  uniqueBy(roles, (item) => item.key, "Blueprint Roles");
  uniqueBy(spaces, (item) => item.key, "Blueprint Spaces");
  uniqueBy(memoryTypes, (item) => item.type, "Blueprint Memory types");
  uniqueBy(activityTypes, (item) => item.type, "Blueprint Activity types");
  uniqueBy(decisionMethods, (item) => item.key, "Blueprint Decision methods");
  uniqueBy(workflows, (item) => item.key, "Blueprint Workflows");
  const spaceKeys = new Set(spaces.map((space) => space.key));
  for (const space of spaces) {
    if (space.parentKey !== null && (!spaceKeys.has(space.parentKey) || space.parentKey === space.key)) {
      throw new GuildDomainError("INVALID_INPUT", `Blueprint Space ${space.key} has an invalid parent.`);
    }
    const visited = new Set([space.key]);
    let parent = space.parentKey;
    while (parent !== null) {
      if (visited.has(parent)) throw new GuildDomainError("INVALID_INPUT", "Blueprint Spaces contain a cycle.");
      visited.add(parent);
      parent = spaces.find((candidate) => candidate.key === parent)?.parentKey ?? null;
    }
  }
  const memoryTypeKeys = new Set(memoryTypes.map((item) => item.type));
  const activityTypeKeys = new Set(activityTypes.map((item) => item.type));
  const decisionKeys = new Set(decisionMethods.map((item) => item.key));
  for (const workflow of workflows) {
    if (workflow.memoryType !== null && !memoryTypeKeys.has(workflow.memoryType) ||
        workflow.activityType !== null && !activityTypeKeys.has(workflow.activityType) ||
        workflow.decisionMethodKey !== null && !decisionKeys.has(workflow.decisionMethodKey)) {
      throw new GuildDomainError("INVALID_INPUT", `Blueprint Workflow ${workflow.key} references an unknown item.`);
    }
  }
  const intents = arrayValue(value.dashboardIntents, "Blueprint Home layout", 3, 5)
    .map((intent, index) => stringValue(intent, `Blueprint dashboardIntents[${index}]`, 20));
  if (intents.some((intent) => !dashboardIntents.has(intent)) || new Set(intents).size !== intents.length) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint Home layout contains invalid actions.");
  }
  const legacyAgent = parseAgent(value.suggestedAgent, roles, "Blueprint suggestedAgent", legacy);
  const approvalPolicies = legacy ? [{
    key: "external-action",
    name: "Human approval for external action",
    description: "External writes require explicit Human approval before execution.",
    riskLevel: 2 as const,
    decisionMethodKey: decisionMethods[0]!.key,
    minimumApprovals: 1,
    humanRequired: true,
  }] : arrayValue(value.approvalPolicies, "Blueprint approvalPolicies", 1, 8)
    .map(parseApprovalPolicy);
  uniqueBy(approvalPolicies, (item) => item.key, "Blueprint Approval policies");
  for (const policy of approvalPolicies) {
    if (!decisionKeys.has(policy.decisionMethodKey)) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        `Blueprint Approval policy ${policy.key} references an unknown Decision method.`,
      );
    }
    if (policy.riskLevel >= 2 && (!policy.humanRequired || policy.minimumApprovals < 1)) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        `Blueprint Approval policy ${policy.key} must require a Human approval for external risk.`,
      );
    }
  }
  const recommendedAgents = legacy
    ? legacyAgent ? [legacyAgent] : []
    : arrayValue(value.recommendedAgents, "Blueprint recommendedAgents", 0, 6)
      .map((agent, index) => parseAgent(agent, roles, `Blueprint recommendedAgents[${index}]`)!) as readonly CollectiveBlueprintAgent[];
  uniqueBy(recommendedAgents, (item) => item.name, "Blueprint recommended Agents");
  const approvalKeys = new Set(approvalPolicies.map((policy) => policy.key));
  for (const agent of recommendedAgents) {
    if (!approvalKeys.has(agent.approvalPolicyKey)) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        `Blueprint Agent ${agent.name} references an unknown Approval policy.`,
      );
    }
  }
  if (!legacy && legacyAgent !== null &&
      JSON.stringify(legacyAgent) !== JSON.stringify(recommendedAgents[0] ?? null)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Blueprint suggestedAgent must match the first recommended Agent.",
    );
  }
  const connectionSuggestions = legacy ? [] : arrayValue(
    value.connectionSuggestions,
    "Blueprint connectionSuggestions",
    0,
    12,
  ).map(parseConnectionSuggestion);
  uniqueBy(connectionSuggestions, (item) => item.key, "Blueprint Connection suggestions");
  for (const connection of connectionSuggestions) {
    if (connection.capabilityAllowlist.includes("connection.execute") &&
        !connection.humanApprovalRequired) {
      throw new GuildDomainError(
        "INVALID_INPUT",
        `Blueprint Connection ${connection.key} must require Human approval for execution.`,
      );
    }
  }
  return {
    schemaVersion: COLLECTIVE_BLUEPRINT_SCHEMA_VERSION,
    name: stringValue(value.name, "Blueprint name", 100),
    purpose: stringValue(value.purpose, "Blueprint purpose", 2_000),
    description: stringValue(value.description, "Blueprint description", 2_000),
    visualTheme: legacy ? {
      preset: "system",
      accent: "blue",
      description: "Use the purchaser's system appearance with a restrained accent.",
    } : parseVisualTheme(value.visualTheme),
    labels: { ...value.labels as unknown as CollectiveTemplateLabels },
    roles,
    spaces,
    memoryTypes,
    activityTypes,
    decisionMethods,
    dashboardIntents: intents as CollectiveBlueprintDefinition["dashboardIntents"],
    workflows,
    approvalPolicies,
    connectionSuggestions,
    onboarding: legacy ? {
      name: "Join this collective",
      description: "Learn the shared purpose and the context needed for the first activity.",
      steps: ["Review the purpose", "Read required Memory", "Start the first Activity"],
    } : parseLifecyclePolicy(value.onboarding, "Blueprint onboarding"),
    offboarding: legacy ? {
      name: "Leave this collective",
      description: "Revoke access and hand over shared Activity and Memory safely.",
      steps: ["Stop access and Runs", "Hand over open Activity", "Record the transition"],
    } : parseLifecyclePolicy(value.offboarding, "Blueprint offboarding"),
    retentionPolicy: legacy ? {
      defaultDays: 2_555,
      description: "Retain shared records according to the Constitution and review before deletion.",
      dryRunRequired: true,
    } : parseRetentionPolicy(value.retentionPolicy),
    exportPolicy: legacy ? {
      formats: ["json", "markdown", "csv", "files"],
      includeHistory: true,
      includePersonalData: "explicit-consent",
      excludePlaintextSecrets: true,
    } : parseExportPolicy(value.exportPolicy),
    recommendedAgents,
    suggestedAgent: recommendedAgents[0] ?? null,
  };
}

const legacyAnswerDefaults: Record<AppLocale, Pick<CollectiveOnboardingAnswers,
  "languageAndStyle" | "agentIntent" | "humanApprovalIntent">> = {
  en: {
    languageAndStyle: "Use clear, calm language that fits the collective.",
    agentIntent: "Search authorized context and prepare reversible internal drafts.",
    humanApprovalIntent: "External writes, authority changes, deletion, and irreversible actions.",
  },
  ja: {
    languageAndStyle: "共同体に合う、明確で落ち着いた言葉を使います。",
    agentIntent: "許可されたContextを検索し、取り消せる内部下書きを作ります。",
    humanApprovalIntent: "外部書き込み、権限変更、削除、取り消せない操作。",
  },
  "zh-CN": {
    languageAndStyle: "使用符合共同体的清晰、平静语言。",
    agentIntent: "搜索已授权上下文并创建可撤销的内部草稿。",
    humanApprovalIntent: "外部写入、权限变更、删除和不可逆操作。",
  },
};

export function parseCollectiveBlueprintDraft(value: unknown): CollectiveBlueprintDraft {
  const label = "Collective Blueprint";
  assertRecord(value, label);
  assertExactKeys(value, [
    "key", "locale", "generationMode", "generationWarnings", "onboardingAnswers", "definition",
  ], [], label);
  const key = stringValue(value.key, `${label}.key`, 63);
  if (!customKeyPattern.test(key)) {
    throw new GuildDomainError("INVALID_INPUT", "Custom Blueprint key is invalid.");
  }
  if (typeof value.locale !== "string" || !(SUPPORTED_LOCALES as readonly string[]).includes(value.locale)) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint locale is unsupported.");
  }
  const locale = value.locale as AppLocale;
  if (!['deterministic', 'model-assisted', 'manual'].includes(String(value.generationMode))) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint generation mode is invalid.");
  }
  if (!Array.isArray(value.generationWarnings) || value.generationWarnings.length > 10 ||
      value.generationWarnings.some((warning) => typeof warning !== "string" || warning.length > 500)) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint generation warnings are invalid.");
  }
  assertRecord(value.onboardingAnswers, "Blueprint onboarding answers");
  const definition = parseCollectiveBlueprintDefinition(value.definition);
  const legacyAnswers = !("languageAndStyle" in value.onboardingAnswers) &&
    !("agentIntent" in value.onboardingAnswers) && !("humanApprovalIntent" in value.onboardingAnswers);
  assertExactKeys(
    value.onboardingAnswers,
    legacyAnswers ? onboardingAnswerKeys.slice(0, 5) : onboardingAnswerKeys,
    [],
    "Blueprint onboarding answers",
  );
  for (const [answerKey, answer] of Object.entries(value.onboardingAnswers)) {
    stringValue(answer, `Blueprint onboarding answers.${answerKey}`, 2_000);
  }
  const answers = {
    ...legacyAnswerDefaults[locale],
    ...value.onboardingAnswers,
  } as CollectiveOnboardingAnswers;
  for (const answerKey of onboardingAnswerKeys) {
    stringValue(answers[answerKey], `Blueprint onboarding answers.${answerKey}`, 2_000);
  }
  return {
    key: key as `custom-${string}`,
    locale,
    generationMode: value.generationMode as BlueprintGenerationMode,
    generationWarnings: [...value.generationWarnings as string[]],
    onboardingAnswers: answers,
    definition,
  };
}

export function assertCollectiveBlueprintDraft(value: unknown): asserts value is CollectiveBlueprintDraft {
  parseCollectiveBlueprintDraft(value);
}

type Archetype =
  | "family"
  | "school"
  | "sports"
  | "npo"
  | "dao"
  | "cooperative"
  | "civic"
  | "neutral";

interface ArchetypeCopy {
  name: string;
  description: string;
  labels: Pick<CollectiveTemplateLabels,
    "members" | "member" | "human" | "memory" | "memoryItem" | "activity" |
    "activityItem" | "decisions" | "decision" | "participant" | "coordinator">;
  roles: readonly [string, string, string, string];
  spaces: readonly [string, string, string];
  memory: readonly [string, string, string];
  activity: readonly [string, string, string];
  decisions: readonly [string, string];
  agent: string;
}

const copy: Record<AppLocale, Record<Archetype, ArchetypeCopy>> = {
  en: {
    family: { name: "Family Circle", description: "A shared home for care, plans, knowledge, and family decisions.", labels: { members: "Family", member: "Family member", human: "Person", memory: "Family memory", memoryItem: "Family record", activity: "Shared life", activityItem: "Family task", decisions: "Family decisions", decision: "Family decision", participant: "Family member", coordinator: "Household coordinator" }, roles: ["Household coordinator", "Care coordinator", "Family member", "Trusted viewer"], spaces: ["Shared home", "Care and wellbeing", "Plans and events"], memory: ["Family guide", "Care record", "Family history"], activity: ["Household task", "Care plan", "Family event"], decisions: ["Family consent", "Responsible adult review"], agent: "Family memory assistant" },
    school: { name: "Learning Community", description: "A shared environment for learning, teaching, support, and evidence-based decisions.", labels: { members: "Learning community", member: "Member", human: "Learner or educator", memory: "Learning knowledge", memoryItem: "Learning record", activity: "Learning", activityItem: "Learning activity", decisions: "Academic decisions", decision: "Academic decision", participant: "Learner", coordinator: "Educator" }, roles: ["School administrator", "Educator", "Learner", "Guardian viewer"], spaces: ["Learning", "Student support", "School operations"], memory: ["Curriculum", "Learning evidence", "School guideline"], activity: ["Lesson", "Study", "Assessment"], decisions: ["Educator review", "Academic committee"], agent: "Learning assistant" },
    sports: { name: "Team Hub", description: "A shared environment for training, matches, team knowledge, and accountable selection.", labels: { members: "Team", member: "Team member", human: "Player or staff", memory: "Team knowledge", memoryItem: "Team record", activity: "Team activity", activityItem: "Session", decisions: "Team decisions", decision: "Team decision", participant: "Player", coordinator: "Coach" }, roles: ["Club administrator", "Coach", "Player", "Supporter viewer"], spaces: ["Team", "Training", "Matches and events"], memory: ["Playbook", "Training note", "Team history"], activity: ["Training session", "Match", "Team event"], decisions: ["Coach review", "Team consent"], agent: "Team operations assistant" },
    npo: { name: "Mission Collective", description: "A shared environment for programs, volunteers, evidence, and mission-led governance.", labels: { members: "People", member: "Member", human: "Volunteer or staff", memory: "Mission knowledge", memoryItem: "Program record", activity: "Mission work", activityItem: "Initiative", decisions: "Governance", decision: "Governance decision", participant: "Contributor", coordinator: "Program lead" }, roles: ["Organization administrator", "Program lead", "Contributor", "Public observer"], spaces: ["Programs", "Volunteers", "Governance"], memory: ["Program guide", "Impact evidence", "Policy"], activity: ["Program", "Campaign", "Volunteer action"], decisions: ["Board review", "Community consent"], agent: "Mission support assistant" },
    dao: { name: "Decentralized Collective", description: "A shared environment for proposals, working groups, transparent records, and governed voting.", labels: { members: "Contributors", member: "Contributor", human: "Human contributor", memory: "Collective context", memoryItem: "Governance record", activity: "Missions", activityItem: "Proposal task", decisions: "Governance proposals", decision: "Proposal", participant: "Contributor", coordinator: "Steward" }, roles: ["Human steward", "Working group lead", "Contributor", "Observer"], spaces: ["Proposals", "Working groups", "Treasury oversight"], memory: ["Governance rule", "Proposal record", "Collective history"], activity: ["Proposal", "Mission", "Working group session"], decisions: ["Token vote", "Human steward review"], agent: "Governance context assistant" },
    cooperative: { name: "Member Cooperative", description: "A member-owned environment for shared work, resources, benefits, and accountable governance.", labels: { members: "Cooperative members", member: "Member-owner", human: "Member-owner", memory: "Cooperative knowledge", memoryItem: "Member record", activity: "Cooperative work", activityItem: "Member initiative", decisions: "Member governance", decision: "Member resolution", participant: "Member-owner", coordinator: "Cooperative steward" }, roles: ["Human custodian", "Cooperative steward", "Member-owner", "Community observer"], spaces: ["Member services", "Shared operations", "Governance"], memory: ["Cooperative rule", "Shared resource record", "Member history"], activity: ["Member initiative", "Shared operation", "General meeting"], decisions: ["One-member vote", "Steward review"], agent: "Cooperative operations assistant" },
    civic: { name: "Civic Commons", description: "A shared civic environment for local knowledge, public initiatives, deliberation, and accountable decisions.", labels: { members: "Residents and partners", member: "Civic participant", human: "Resident or public servant", memory: "Civic record", memoryItem: "Public record", activity: "Civic activity", activityItem: "Public initiative", decisions: "Public decisions", decision: "Civic decision", participant: "Resident", coordinator: "Civic coordinator" }, roles: ["Public custodian", "Civic coordinator", "Resident participant", "Public observer"], spaces: ["Neighbourhoods", "Public initiatives", "Civic governance"], memory: ["Local knowledge", "Public evidence", "Civic history"], activity: ["Public initiative", "Consultation", "Community event"], decisions: ["Public deliberation", "Council review"], agent: "Civic information assistant" },
    neutral: { name: "Purpose Collective", description: "A shared environment shaped around this collective's purpose, memory, activity, and decisions.", labels: { members: "Members", member: "Member", human: "Person", memory: "Shared memory", memoryItem: "Record", activity: "Activities", activityItem: "Activity", decisions: "Decisions", decision: "Decision", participant: "Participant", coordinator: "Coordinator" }, roles: ["Administrator", "Coordinator", "Participant", "Observer"], spaces: ["Shared space", "Active work", "Governance"], memory: ["Shared knowledge", "Operating guide", "Collective history"], activity: ["Activity", "Project", "Gathering"], decisions: ["Collective consent", "Coordinator review"], agent: "Collective context assistant" },
  },
  ja: {
    family: { name: "家族の共有室", description: "暮らし、ケア、予定、知恵、家族の判断を共有する場所です。", labels: { members: "家族", member: "家族", human: "家族", memory: "家族の記憶", memoryItem: "家族の記録", activity: "共同生活", activityItem: "家族の用事", decisions: "家族の話し合い", decision: "家族の決定", participant: "家族", coordinator: "暮らしの担当者" }, roles: ["暮らしの管理者", "ケア担当", "家族", "閲覧する家族"], spaces: ["共通の暮らし", "ケアと健康", "予定と行事"], memory: ["暮らしの手引き", "ケアの記録", "家族の歴史"], activity: ["家の用事", "ケア計画", "家族行事"], decisions: ["家族の合意", "責任者の確認"], agent: "家族の記憶アシスタント" },
    school: { name: "学びの共同体", description: "学習、教育、支援、根拠に基づく判断を共有する場所です。", labels: { members: "学びの共同体", member: "メンバー", human: "学習者・教育者", memory: "学びの知識", memoryItem: "学習記録", activity: "学び", activityItem: "学習活動", decisions: "教育上の判断", decision: "教育上の決定", participant: "学習者", coordinator: "教育者" }, roles: ["学校管理者", "教育者", "学習者", "保護者閲覧者"], spaces: ["学習", "生徒支援", "学校運営"], memory: ["カリキュラム", "学習の証拠", "学校ガイドライン"], activity: ["授業", "学習", "評価"], decisions: ["教育者レビュー", "教育委員会"], agent: "学習アシスタント" },
    sports: { name: "チーム拠点", description: "練習、試合、チーム知識、説明できる選考を共有する場所です。", labels: { members: "チーム", member: "チームメンバー", human: "選手・スタッフ", memory: "チームの知識", memoryItem: "チーム記録", activity: "チーム活動", activityItem: "セッション", decisions: "チームの判断", decision: "チームの決定", participant: "選手", coordinator: "コーチ" }, roles: ["クラブ管理者", "コーチ", "選手", "サポーター閲覧者"], spaces: ["チーム", "トレーニング", "試合と行事"], memory: ["プレイブック", "練習記録", "チーム史"], activity: ["練習", "試合", "チーム行事"], decisions: ["コーチレビュー", "チーム合意"], agent: "チーム運営アシスタント" },
    npo: { name: "ミッション共同体", description: "事業、ボランティア、成果、使命に沿った統治を共有する場所です。", labels: { members: "参加者", member: "メンバー", human: "ボランティア・スタッフ", memory: "活動の知識", memoryItem: "事業記録", activity: "社会活動", activityItem: "取り組み", decisions: "組織運営", decision: "運営上の決定", participant: "貢献者", coordinator: "事業責任者" }, roles: ["組織管理者", "事業責任者", "貢献者", "公開閲覧者"], spaces: ["事業", "ボランティア", "統治"], memory: ["事業ガイド", "成果の証拠", "方針"], activity: ["事業", "キャンペーン", "ボランティア活動"], decisions: ["理事会レビュー", "共同体の合意"], agent: "ミッション支援アシスタント" },
    dao: { name: "分散型共同体", description: "提案、作業部会、透明な記録、統治された投票を共有する場所です。", labels: { members: "貢献者", member: "貢献者", human: "人間の貢献者", memory: "共同体Context", memoryItem: "統治記録", activity: "Mission", activityItem: "提案タスク", decisions: "統治提案", decision: "提案", participant: "貢献者", coordinator: "Steward" }, roles: ["人間のSteward", "作業部会責任者", "貢献者", "Observer"], spaces: ["提案", "作業部会", "財務監督"], memory: ["統治ルール", "提案記録", "共同体の歴史"], activity: ["提案", "Mission", "作業部会"], decisions: ["トークン投票", "人間Stewardの確認"], agent: "統治Contextアシスタント" },
    cooperative: { name: "組合員協同体", description: "共同の仕事、資源、利益、説明可能な運営を組合員が所有する場所です。", labels: { members: "組合員", member: "組合員", human: "組合員", memory: "協同の知識", memoryItem: "組合記録", activity: "協同活動", activityItem: "組合員の取り組み", decisions: "組合運営", decision: "組合決議", participant: "組合員", coordinator: "運営担当" }, roles: ["人間Custodian", "運営担当", "組合員", "地域閲覧者"], spaces: ["組合員サービス", "共同運営", "組合統治"], memory: ["組合規約", "共同資源の記録", "組合の歴史"], activity: ["組合員の取り組み", "共同運営", "総会"], decisions: ["一人一票", "運営担当レビュー"], agent: "協同運営アシスタント" },
    civic: { name: "地域の共有圏", description: "地域の知識、公共の取り組み、熟議、説明可能な判断を共有する場所です。", labels: { members: "住民と協力者", member: "地域参加者", human: "住民・公共担当者", memory: "地域の記録", memoryItem: "公共記録", activity: "地域活動", activityItem: "公共の取り組み", decisions: "地域の判断", decision: "地域の決定", participant: "住民", coordinator: "地域調整役" }, roles: ["公共Custodian", "地域調整役", "住民参加者", "公開閲覧者"], spaces: ["地域", "公共の取り組み", "地域統治"], memory: ["地域の知識", "公共の根拠", "地域の歴史"], activity: ["公共の取り組み", "意見募集", "地域行事"], decisions: ["住民熟議", "評議会レビュー"], agent: "地域情報アシスタント" },
    neutral: { name: "目的共同体", description: "この共同体の目的、記憶、活動、決め方に合わせて形づくる共有環境です。", labels: { members: "メンバー", member: "メンバー", human: "人", memory: "共有記憶", memoryItem: "記録", activity: "活動", activityItem: "活動", decisions: "意思決定", decision: "決定", participant: "参加者", coordinator: "調整役" }, roles: ["管理者", "調整役", "参加者", "閲覧者"], spaces: ["共有Space", "活動", "統治"], memory: ["共有知識", "運営ガイド", "共同体の歴史"], activity: ["活動", "プロジェクト", "集まり"], decisions: ["共同体の合意", "調整役の確認"], agent: "共同体Contextアシスタント" },
  },
  "zh-CN": {
    family: { name: "家庭共享空间", description: "共同管理生活、照护、计划、知识与家庭决定。", labels: { members: "家庭", member: "家庭成员", human: "家庭成员", memory: "家庭记忆", memoryItem: "家庭记录", activity: "共同生活", activityItem: "家庭事项", decisions: "家庭决定", decision: "家庭决定", participant: "家庭成员", coordinator: "家庭协调者" }, roles: ["家庭管理员", "照护协调者", "家庭成员", "受信任查看者"], spaces: ["共同生活", "照护与健康", "计划与活动"], memory: ["家庭指南", "照护记录", "家庭历史"], activity: ["家庭事项", "照护计划", "家庭活动"], decisions: ["家庭共识", "责任人审核"], agent: "家庭记忆助手" },
    school: { name: "学习共同体", description: "共同管理学习、教学、支持和基于证据的决定。", labels: { members: "学习共同体", member: "成员", human: "学习者或教育者", memory: "学习知识", memoryItem: "学习记录", activity: "学习", activityItem: "学习活动", decisions: "教学决定", decision: "教学决定", participant: "学习者", coordinator: "教育者" }, roles: ["学校管理员", "教育者", "学习者", "监护人查看者"], spaces: ["学习", "学生支持", "学校运营"], memory: ["课程", "学习证据", "学校指南"], activity: ["课程", "学习", "评估"], decisions: ["教育者审核", "教学委员会"], agent: "学习助手" },
    sports: { name: "团队中心", description: "共同管理训练、比赛、团队知识和可追溯的选拔。", labels: { members: "团队", member: "团队成员", human: "运动员或工作人员", memory: "团队知识", memoryItem: "团队记录", activity: "团队活动", activityItem: "训练单元", decisions: "团队决定", decision: "团队决定", participant: "运动员", coordinator: "教练" }, roles: ["俱乐部管理员", "教练", "运动员", "支持者查看者"], spaces: ["团队", "训练", "比赛与活动"], memory: ["战术手册", "训练记录", "团队历史"], activity: ["训练", "比赛", "团队活动"], decisions: ["教练审核", "团队共识"], agent: "团队运营助手" },
    npo: { name: "使命共同体", description: "共同管理项目、志愿者、成效证据和使命治理。", labels: { members: "参与者", member: "成员", human: "志愿者或员工", memory: "使命知识", memoryItem: "项目记录", activity: "使命工作", activityItem: "行动", decisions: "治理", decision: "治理决定", participant: "贡献者", coordinator: "项目负责人" }, roles: ["组织管理员", "项目负责人", "贡献者", "公开查看者"], spaces: ["项目", "志愿者", "治理"], memory: ["项目指南", "成效证据", "政策"], activity: ["项目", "倡议", "志愿行动"], decisions: ["理事会审核", "共同体共识"], agent: "使命支持助手" },
    dao: { name: "去中心化共同体", description: "共同管理提案、工作组、透明记录和受治理的投票。", labels: { members: "贡献者", member: "贡献者", human: "人类贡献者", memory: "共同体上下文", memoryItem: "治理记录", activity: "任务", activityItem: "提案任务", decisions: "治理提案", decision: "提案", participant: "贡献者", coordinator: "治理人" }, roles: ["人类治理人", "工作组负责人", "贡献者", "观察者"], spaces: ["提案", "工作组", "财务监督"], memory: ["治理规则", "提案记录", "共同体历史"], activity: ["提案", "任务", "工作组会议"], decisions: ["代币投票", "人类治理审核"], agent: "治理上下文助手" },
    cooperative: { name: "成员合作社", description: "由成员共同拥有工作、资源、收益与可问责治理的空间。", labels: { members: "合作社成员", member: "成员所有者", human: "成员所有者", memory: "合作知识", memoryItem: "成员记录", activity: "合作事务", activityItem: "成员行动", decisions: "成员治理", decision: "成员决议", participant: "成员所有者", coordinator: "合作社协调者" }, roles: ["人类监护人", "合作社协调者", "成员所有者", "社区观察者"], spaces: ["成员服务", "共同运营", "治理"], memory: ["合作社规则", "共享资源记录", "成员历史"], activity: ["成员行动", "共同运营", "成员大会"], decisions: ["一人一票", "协调者审核"], agent: "合作社运营助手" },
    civic: { name: "公共共同空间", description: "共同管理地方知识、公共行动、协商与可问责决定。", labels: { members: "居民与合作伙伴", member: "公共参与者", human: "居民或公共服务者", memory: "公共记忆", memoryItem: "公共记录", activity: "公共活动", activityItem: "公共行动", decisions: "公共决定", decision: "公共决定", participant: "居民", coordinator: "公共协调者" }, roles: ["公共监护人", "公共协调者", "居民参与者", "公开观察者"], spaces: ["社区", "公共行动", "公共治理"], memory: ["地方知识", "公共证据", "社区历史"], activity: ["公共行动", "公众协商", "社区活动"], decisions: ["公众协商", "议事会审核"], agent: "公共信息助手" },
    neutral: { name: "目标共同体", description: "围绕共同体的目标、记忆、活动与决策方式形成的共享环境。", labels: { members: "成员", member: "成员", human: "人", memory: "共享记忆", memoryItem: "记录", activity: "活动", activityItem: "活动", decisions: "决定", decision: "决定", participant: "参与者", coordinator: "协调者" }, roles: ["管理员", "协调者", "参与者", "查看者"], spaces: ["共享空间", "活动", "治理"], memory: ["共享知识", "运营指南", "共同体历史"], activity: ["活动", "项目", "聚会"], decisions: ["共同体共识", "协调者审核"], agent: "共同体上下文助手" },
  },
};

function classify(input: PurposeBlueprintInput): Archetype {
  const text = Object.values(input.answers).join(" ").toLocaleLowerCase(input.locale);
  const patterns: readonly [Archetype, RegExp][] = [
    ["dao", /\bdao\b|decentrali[sz]ed|token vote|分散型|分散|トークン|去中心化|代币|治理提案/i],
    ["cooperative", /co-?op(?:erative)?|member.?owned|mutual aid|協同組合|生協|組合員|合作社|成员所有/i],
    ["civic", /civic|municipal|local council|neighbou?rhood council|自治会|町内会|自治コミュニティ|地方自治|公共共同|居民委员会|社区自治/i],
    ["sports", /sport|football|soccer|basketball|baseball|training team|スポーツ|サッカー|野球|バスケ|運動部|球队|足球|篮球|训练/i],
    ["npo", /\bnpo\b|non.?profit|charit|volunteer|非営利|公益|ボランティア|志愿|非营利/i],
    ["school", /school|education|student|teacher|classroom|学校|教育|生徒|学生|授業|校园|教师|课程/i],
    ["family", /family|household|parent|childcare|家族|家庭|親子|子育て|照护|家人/i],
  ];
  return patterns.find(([, pattern]) => pattern.test(text))?.[0] ?? "neutral";
}

function slug(value: string): string {
  const ascii = value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "-").toLowerCase()
    .replace(/^-+|-+$/g, "").slice(0, 32);
  return ascii.length >= 2 ? ascii : "purpose-collective";
}

function customType(value: string): `custom:${string}` {
  const key = value.normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, "_").toLowerCase()
    .replace(/^_+|_+$/g, "").slice(0, 50);
  const safe = typeKeyPattern.test(key) ? key : "collective_item";
  return `custom:${safe}`;
}

function baseLabels(value: ArchetypeCopy): CollectiveTemplateLabels {
  return {
    ...value.labels,
    agent: "AI assistant",
    service: "Connected service",
    guildActor: "Partner collective",
    remember: `Add to ${value.labels.memory}`,
    startActivity: `Start ${value.labels.activity}`,
    history: "Chronicle",
    join: "Invite",
    leave: "Remove",
  };
}

const localizedUtilityLabels: Record<AppLocale, Pick<CollectiveTemplateLabels,
  "agent" | "service" | "guildActor" | "remember" | "startActivity" | "history" | "join" | "leave">> = {
  en: { agent: "AI assistant", service: "Connected service", guildActor: "Partner collective", remember: "Add to {memory}", startActivity: "Start {activity}", history: "Chronicle", join: "Invite", leave: "Remove" },
  ja: { agent: "AIアシスタント", service: "接続サービス", guildActor: "連携する共同体", remember: "{memory}に追加", startActivity: "{activity}を始める", history: "Chronicle", join: "招待", leave: "削除" },
  "zh-CN": { agent: "AI助手", service: "已连接服务", guildActor: "合作共同体", remember: "添加到{memory}", startActivity: "开始{activity}", history: "历史记录", join: "邀请", leave: "移除" },
};

function labelsFor(locale: AppLocale, value: ArchetypeCopy): CollectiveTemplateLabels {
  const utility = localizedUtilityLabels[locale];
  return {
    ...baseLabels(value),
    ...utility,
    remember: utility.remember.replace("{memory}", value.labels.memory),
    startActivity: utility.startActivity.replace("{activity}", value.labels.activity),
  };
}

const defaultAgentPermissions: readonly Permission[] = [
  "memory.read",
  "activity.read",
  "activity.create",
  "decision.read",
  "relation.read",
  "conversation.read",
  "conversation.create",
  "run.create",
  "agent.read",
  "agent.run",
  "event.read",
];

function visualThemeFor(input: PurposeBlueprintInput, archetype: Archetype): CollectiveBlueprintVisualTheme {
  const style = input.answers.languageAndStyle.toLocaleLowerCase(input.locale);
  const preset: CollectiveVisualThemePreset = /playful|fantasy|magic|game|楽しい|遊び|魔法|幻想|游戏|活泼/i.test(style)
    ? "playful"
    : /warm|welcoming|care|温か|やさし|親しみ|温暖|关怀/i.test(style)
      ? "warm"
      : /formal|official|academic|厳格|正式|学術|正式|严谨/i.test(style)
        ? "formal"
        : /quiet|calm|minimal|静か|落ち着|簡潔|安静|简洁/i.test(style)
          ? "quiet"
          : "system";
  const accent: CollectiveBlueprintVisualTheme["accent"] = archetype === "family" || archetype === "civic"
    ? "green"
    : archetype === "sports" || archetype === "cooperative"
      ? "amber"
      : archetype === "dao"
        ? "violet"
        : archetype === "npo"
          ? "rose"
          : "blue";
  return { preset, accent, description: input.answers.languageAndStyle.trim() };
}

function connectionSuggestionsFor(
  input: PurposeBlueprintInput,
): readonly CollectiveBlueprintConnectionSuggestion[] {
  const suggestions: CollectiveBlueprintConnectionSuggestion[] = [{
    key: "model-provider",
    name: input.locale === "ja" ? "AIモデル" : input.locale === "zh-CN" ? "AI模型" : "AI model provider",
    description: input.answers.agentIntent.trim(),
    kind: "model-provider",
    capabilityAllowlist: ["connection.read"],
    humanApprovalRequired: false,
  }];
  const outward = input.answers.agentIntent.toLocaleLowerCase(input.locale);
  const candidates: readonly [RegExp, CollectiveConnectionKind, string][] = [
    [/email|mail|メール|郵便|电子邮件|邮件/i, "email", "email"],
    [/calendar|schedule|予定|カレンダー|日程|日历/i, "calendar", "calendar"],
    [/github|git repository|リポジトリ|代码仓库/i, "git", "git"],
    [/file|drive|storage|ファイル|保存先|文件|存储/i, "file-storage", "files"],
    [/webhook|external api|api|外部サービス|外部API|外部服务/i, "external-api", "external-api"],
  ];
  const match = candidates.find(([pattern]) => pattern.test(outward));
  if (match) {
    const [, kind, key] = match;
    suggestions.push({
      key,
      name: input.answers.agentIntent.trim().slice(0, 100),
      description: input.answers.humanApprovalIntent.trim(),
      kind,
      capabilityAllowlist: ["connection.read", "connection.execute"],
      humanApprovalRequired: true,
    });
  }
  return suggestions;
}

interface LifecycleCopy {
  onboardingName: string;
  onboardingDescription: string;
  onboardingSteps: readonly [string, string, string];
  offboardingName: string;
  offboardingDescription: string;
  offboardingSteps: readonly [string, string, string];
  retention: string;
}

const lifecycleCopy: Record<AppLocale, LifecycleCopy> = {
  en: {
    onboardingName: "Join and begin",
    onboardingDescription: "Learn the purpose, receive only the required context, and begin one useful activity.",
    onboardingSteps: ["Confirm the shared purpose", "Review required Memory", "Begin the first Activity"],
    offboardingName: "Leave with a safe handover",
    offboardingDescription: "Stop access and Runs before shared responsibility is reassigned.",
    offboardingSteps: ["Revoke sessions and Connections", "Hand over open Activity and drafts", "Record the transition in History"],
    retention: "Retain shared evidence according to the Constitution; preview every deletion before applying it.",
  },
  ja: {
    onboardingName: "参加して始める",
    onboardingDescription: "目的を理解し、必要なContextだけを受け取り、最初の活動を始めます。",
    onboardingSteps: ["共同の目的を確認", "必要な記憶を確認", "最初の活動を開始"],
    offboardingName: "安全に引き継いで離れる",
    offboardingDescription: "共有責任を引き継ぐ前にAccessとRunを停止します。",
    offboardingSteps: ["SessionとConnectionを停止", "未完了の活動と下書きを引き継ぐ", "履歴へ移行を記録"],
    retention: "憲法に従って共有証拠を保持し、削除は必ず事前確認します。",
  },
  "zh-CN": {
    onboardingName: "加入并开始",
    onboardingDescription: "理解目标，只接收必要上下文，并开始第一项有用活动。",
    onboardingSteps: ["确认共同目标", "查看必需记忆", "开始第一项活动"],
    offboardingName: "安全交接后离开",
    offboardingDescription: "在重新分配共同责任前停止访问和运行。",
    offboardingSteps: ["撤销会话与连接", "交接未完成活动和草稿", "在历史中记录变更"],
    retention: "依据章程保留共同证据，并在删除前预览影响。",
  },
};

const archetypeDecisionMethods: Record<Archetype, readonly [DecisionMethod, DecisionMethod]> = {
  family: ["consent", "review"],
  school: ["review", "hybrid"],
  sports: ["review", "consent"],
  npo: ["review", "consent"],
  dao: ["vote", "review"],
  cooperative: ["vote", "review"],
  civic: ["consent", "review"],
  neutral: ["consent", "review"],
};

interface GeneratedSentenceCopy {
  administrator(purpose: string): string;
  coordinator(activity: string): string;
  participant(participants: string): string;
  observer: string;
  memory(label: string, intent: string): string;
  activity(label: string, intent: string): string;
  guidedWorkflowName(activity: string): string;
  guidedWorkflowDescription(activity: string): string;
  learningWorkflowName(memory: string): string;
  learningWorkflowDescription: string;
  agentPurpose(activity: string): string;
}

const generatedSentences: Record<AppLocale, GeneratedSentenceCopy> = {
  en: {
    administrator: (purpose) => `Maintains the collective structure for: ${purpose}`,
    coordinator: (activity) => `Coordinates ${activity}`,
    participant: (participants) => `Participates as ${participants}`,
    observer: "Can read approved shared context without changing it.",
    memory: (label, intent) => `${label}: ${intent}`,
    activity: (label, intent) => `${label}: ${intent}`,
    guidedWorkflowName: (activity) => `${activity} workflow`,
    guidedWorkflowDescription: (activity) => `Prepare, perform, and review ${activity}.`,
    learningWorkflowName: (memory) => `${memory} workflow`,
    learningWorkflowDescription: "Turn completed activity into reviewed shared memory.",
    agentPurpose: (activity) => `Help with ${activity} using only authorized context; produce reversible drafts and stop for Human approval.`,
  },
  ja: {
    administrator: (purpose) => `次の目的に沿って共同体の構造を管理します: ${purpose}`,
    coordinator: (activity) => `次の活動を調整します: ${activity}`,
    participant: (participants) => `次の立場で参加します: ${participants}`,
    observer: "承認済みの共有Contextを変更せずに閲覧できます。",
    memory: (label, intent) => `${label}: ${intent}`,
    activity: (label, intent) => `${label}: ${intent}`,
    guidedWorkflowName: (activity) => `${activity}のWorkflow`,
    guidedWorkflowDescription: (activity) => `${activity}を準備・実行・確認します。`,
    learningWorkflowName: (memory) => `${memory}のWorkflow`,
    learningWorkflowDescription: "完了した活動をレビュー済みの共有記憶へ変換します。",
    agentPurpose: (activity) => `許可されたContextだけを使って${activity}を支援し、取り消せる下書きを作り、人間の承認で停止します。`,
  },
  "zh-CN": {
    administrator: (purpose) => `围绕以下目标维护共同体结构：${purpose}`,
    coordinator: (activity) => `协调以下活动：${activity}`,
    participant: (participants) => `以下列身份参与：${participants}`,
    observer: "可以查看已批准的共享上下文，但不能更改。",
    memory: (label, intent) => `${label}：${intent}`,
    activity: (label, intent) => `${label}：${intent}`,
    guidedWorkflowName: (activity) => `${activity}工作流`,
    guidedWorkflowDescription: (activity) => `准备、执行并审核${activity}。`,
    learningWorkflowName: (memory) => `${memory}工作流`,
    learningWorkflowDescription: "将已完成的活动转化为经过审核的共享记忆。",
    agentPurpose: (activity) => `仅使用获授权的上下文协助${activity}，生成可撤销草稿，并等待人工批准。`,
  },
};

export function createDeterministicCollectiveBlueprint(
  input: PurposeBlueprintInput,
): CollectiveBlueprintDraft {
  if (!(SUPPORTED_LOCALES as readonly string[]).includes(input.locale)) {
    throw new GuildDomainError("INVALID_INPUT", "Blueprint locale is unsupported.");
  }
  assertRecord(input.answers, "Blueprint answers");
  assertExactKeys(input.answers, onboardingAnswerKeys, [], "Blueprint answers");
  for (const key of onboardingAnswerKeys) {
    stringValue(input.answers[key], `Blueprint ${key}`, 2_000);
  }
  const archetype = classify(input);
  const selected = copy[input.locale][archetype];
  const sentence = generatedSentences[input.locale];
  const roles: readonly CollectiveBlueprintRole[] = [
    { key: "administrator", name: selected.roles[0], description: sentence.administrator(input.answers.purpose), capabilityBundle: "administer", capabilities: blueprintCapabilities("administer") },
    { key: "coordinator", name: selected.roles[1], description: sentence.coordinator(input.answers.activityIntent), capabilityBundle: "coordinate", capabilities: blueprintCapabilities("coordinate") },
    { key: "participant", name: selected.roles[2], description: sentence.participant(input.answers.participants), capabilityBundle: "participate", capabilities: blueprintCapabilities("participate") },
    { key: "observer", name: selected.roles[3], description: sentence.observer, capabilityBundle: "observe", capabilities: blueprintCapabilities("observe") },
  ];
  const memoryTypes = selected.memory.map((label, index): CollectiveBlueprintMemoryType => ({
    type: customType(`${archetype}_${["guide", "evidence", "history"][index]}`),
    label,
    description: sentence.memory(label, input.answers.memoryIntent),
  }));
  const activityTypes = selected.activity.map((label, index): CollectiveBlueprintActivityType => ({
    type: customType(`${archetype}_${["activity", "project", "event"][index]}`),
    label,
    description: sentence.activity(label, input.answers.activityIntent),
    states: ["proposed", "planned", "active", "completed", "archived"],
  }));
  const decisionEngines = archetypeDecisionMethods[archetype];
  const decisionMethods: readonly CollectiveBlueprintDecisionMethod[] = [
    { key: "primary-decision", label: selected.decisions[0], description: input.answers.decisionStyle, method: decisionEngines[0] },
    { key: "secondary-decision", label: selected.decisions[1], description: input.answers.decisionStyle, method: decisionEngines[1] },
  ];
  const recommendedAgent: CollectiveBlueprintAgent = {
    name: selected.agent,
    purpose: `${input.answers.agentIntent.trim()} ${sentence.agentPurpose(input.answers.activityIntent)}`,
    roleKey: "participant",
    permissions: defaultAgentPermissions,
    toolIds: ["memory_search", "activity_draft"],
    limits: { ...defaultAgentLimits },
    approvalPolicyKey: "external-action",
  };
  const lifecycle = lifecycleCopy[input.locale];
  const definition: CollectiveBlueprintDefinition = {
    schemaVersion: COLLECTIVE_BLUEPRINT_SCHEMA_VERSION,
    name: selected.name,
    purpose: input.answers.purpose.trim(),
    description: selected.description,
    visualTheme: visualThemeFor(input, archetype),
    labels: labelsFor(input.locale, selected),
    roles,
    spaces: selected.spaces.map((name, index) => ({
      key: `space-${index + 1}`,
      name,
      description: index === 0 ? input.answers.activityIntent : index === 1
        ? input.answers.memoryIntent : input.answers.decisionStyle,
      parentKey: null,
    })),
    memoryTypes,
    activityTypes,
    decisionMethods,
    dashboardIntents: ["ask", "start", "remember", "review", "members"],
    workflows: [
      { key: "guided-action", name: sentence.guidedWorkflowName(selected.activity[0]), description: sentence.guidedWorkflowDescription(selected.activity[0]), activityType: activityTypes[0]!.type, memoryType: memoryTypes[0]!.type, decisionMethodKey: "primary-decision" },
      { key: "capture-learning", name: sentence.learningWorkflowName(selected.memory[1]), description: sentence.learningWorkflowDescription, activityType: activityTypes[1]!.type, memoryType: memoryTypes[1]!.type, decisionMethodKey: "secondary-decision" },
    ],
    approvalPolicies: [
      {
        key: "internal-draft",
        name: input.locale === "ja" ? "内部下書き" : input.locale === "zh-CN" ? "内部草稿" : "Internal draft",
        description: input.answers.agentIntent.trim(),
        riskLevel: 1,
        decisionMethodKey: "secondary-decision",
        minimumApprovals: 0,
        humanRequired: false,
      },
      {
        key: "external-action",
        name: input.locale === "ja" ? "人間による外部操作の確認" : input.locale === "zh-CN" ? "人工确认外部操作" : "Human approval for external action",
        description: input.answers.humanApprovalIntent.trim(),
        riskLevel: 2,
        decisionMethodKey: "primary-decision",
        minimumApprovals: 1,
        humanRequired: true,
      },
    ],
    connectionSuggestions: connectionSuggestionsFor(input),
    onboarding: {
      name: lifecycle.onboardingName,
      description: lifecycle.onboardingDescription,
      steps: lifecycle.onboardingSteps,
    },
    offboarding: {
      name: lifecycle.offboardingName,
      description: lifecycle.offboardingDescription,
      steps: lifecycle.offboardingSteps,
    },
    retentionPolicy: {
      defaultDays: 2_555,
      description: lifecycle.retention,
      dryRunRequired: true,
    },
    exportPolicy: {
      formats: ["json", "markdown", "csv", "files"],
      includeHistory: true,
      includePersonalData: "explicit-consent",
      excludePlaintextSecrets: true,
    },
    recommendedAgents: [recommendedAgent],
    suggestedAgent: recommendedAgent,
  };
  const draft: CollectiveBlueprintDraft = {
    key: `custom-${slug(selected.name)}`,
    locale: input.locale,
    generationMode: "deterministic",
    generationWarnings: [],
    onboardingAnswers: {
      purpose: input.answers.purpose.trim(),
      participants: input.answers.participants.trim(),
      memoryIntent: input.answers.memoryIntent.trim(),
      activityIntent: input.answers.activityIntent.trim(),
      decisionStyle: input.answers.decisionStyle.trim(),
      languageAndStyle: input.answers.languageAndStyle.trim(),
      agentIntent: input.answers.agentIntent.trim(),
      humanApprovalIntent: input.answers.humanApprovalIntent.trim(),
    },
    definition,
  };
  assertCollectiveBlueprintDraft(draft);
  return draft;
}

export function blueprintToCollectiveTemplate(draft: Pick<CollectiveBlueprintDraft, "key" | "definition">): CollectiveTemplate {
  const definition = parseCollectiveBlueprintDefinition(draft.definition);
  const methods = new Map(definition.decisionMethods.map((item) => [item.key, item.method]));
  const workflows: readonly CollectiveWorkflowPreset[] = definition.workflows.map((workflow) => ({
    key: workflow.key,
    name: workflow.name,
    activityType: workflow.activityType,
    memoryType: workflow.memoryType,
    decisionMethod: workflow.decisionMethodKey === null
      ? null
      : methods.get(workflow.decisionMethodKey) ?? null,
  }));
  return {
    key: "blank",
    name: definition.name,
    description: definition.description,
    labels: definition.labels,
    roles: definition.roles.map((role) => ({ name: role.name, capabilities: role.capabilities })),
    activityTypes: definition.activityTypes.map((item) => item.type),
    activityTypeLabels: Object.fromEntries(
      definition.activityTypes.map((item) => [item.type, item.label]),
    ),
    memoryTypes: definition.memoryTypes.map((item) => item.type),
    memoryTypeLabels: Object.fromEntries(
      definition.memoryTypes.map((item) => [item.type, item.label]),
    ),
    decisionMethods: [...new Set(definition.decisionMethods.map((item) => item.method))],
    decisionMethodLabels: Object.fromEntries(
      definition.decisionMethods.map((item) => [item.method, item.label]),
    ),
    dashboardIntents: definition.dashboardIntents,
    workflows,
    suggestedAgent: definition.suggestedAgent?.name ?? null,
  };
}

function authorityRoleKey(name: string): string {
  return name.trim().toLocaleLowerCase("en-US");
}

function orderedPermissions(values: Iterable<Permission>): readonly Permission[] {
  const selected = new Set(values);
  return PERMISSIONS.filter((permission) => selected.has(permission));
}

export function createBlueprintAuthorityMigrationProposal(
  blueprint: Pick<CollectiveBlueprintDraft, "key" | "definition">,
  currentRoles: readonly ExistingAuthorityRole[],
): BlueprintAuthorityMigrationProposal {
  if (!customKeyPattern.test(blueprint.key)) {
    throw new GuildDomainError("INVALID_INPUT", "Authority migration requires a valid custom Blueprint key.");
  }
  const definition = parseCollectiveBlueprintDefinition(blueprint.definition);
  const current = new Map(currentRoles.map((role) => [authorityRoleKey(role.name), role]));
  const proposed = new Map(definition.roles.map((role) => [authorityRoleKey(role.name), role]));
  const impacts: BlueprintAuthorityImpact[] = [];

  for (const role of definition.roles) {
    const existing = current.get(authorityRoleKey(role.name));
    if (!existing) {
      impacts.push({
        kind: "role-addition",
        roleName: role.name,
        capabilities: orderedPermissions(role.capabilities),
      });
      continue;
    }
    const currentPermissions = new Set(existing.permissions);
    const proposedPermissions = new Set(role.capabilities);
    const additions = orderedPermissions(role.capabilities.filter((permission) => !currentPermissions.has(permission)));
    const removals = orderedPermissions(existing.permissions.filter((permission) => !proposedPermissions.has(permission)));
    if (additions.length > 0) {
      impacts.push({ kind: "capability-addition", roleName: role.name, capabilities: additions });
    }
    if (removals.length > 0) {
      impacts.push({ kind: "capability-removal", roleName: role.name, capabilities: removals });
    }
  }

  for (const role of currentRoles) {
    if (!proposed.has(authorityRoleKey(role.name))) {
      impacts.push({
        kind: "role-retirement",
        roleName: role.name,
        capabilities: orderedPermissions(role.permissions),
      });
    }
  }

  return {
    schemaVersion: 1,
    blueprintKey: blueprint.key,
    blueprintName: definition.name,
    impacts,
    riskLevel: 3,
    requiresHumanApproval: true,
    appliesAutomatically: false,
    rollbackRequired: true,
  };
}
