export interface GuildSpaceSummary {
  id: string;
  name: string;
  parentSpaceId: string | null;
}

export interface GuildOverview {
  guildId: string;
  name: string;
  purpose: string;
  identityId: string;
  identityKind: "human" | "agent" | "service" | "guild";
  membershipState: "invited" | "preboarding" | "active" | "suspended" | "departed";
  rootOwner: boolean;
  globalPermissions: string[];
  spaces: GuildSpaceSummary[];
}

export interface GuildKnowledgeSearchResult {
  knowledgeId: string;
  version: number;
  title: string;
  summary: string;
  content: string;
  spaceId: string | null;
}

export interface GuildMemorySearchResult {
  memoryId: string;
  version: number;
  type: string;
  governed: boolean;
  title: string;
  summary: string;
  content: string;
  spaceId: string | null;
}

export interface GuildAgentLimits {
  currency: string;
  maxBudgetMinor: number;
  maxTokens: number;
  maxDurationSeconds: number;
  maxSteps: number;
  maxRetries: number;
  maxDelegationDepth: number;
}

export interface GuildRunnableAgentSummary {
  identityId: string;
  displayName: string;
  model: string;
  spaceIds: string[];
  limits: GuildAgentLimits;
}

export interface GuildConnectorSummary {
  id: string;
  name: string;
  kind: "https_webhook";
}

export interface GuildAgentExecutionContext {
  spaces: GuildSpaceSummary[];
  agents: GuildRunnableAgentSummary[];
  connectors: GuildConnectorSummary[];
}

export type GuildJsonValue =
  | string
  | number
  | boolean
  | null
  | GuildJsonValue[]
  | { [key: string]: GuildJsonValue };

export interface GuildWebhookPlanInput {
  requestId: string;
  agentIdentityId: string;
  connectorId: string;
  questId?: string | null;
  spaceId: string;
  objective: string;
  expectedOutcome: string;
  steps: string[];
  eventType: string;
  payload: { [key: string]: GuildJsonValue };
  estimatedDurationSeconds: number;
}

export interface GuildAgentActionReceipt {
  runId: string;
  actionId: number;
  status: "pending";
  message: string;
}

/** Read-only capability supplied to an agent or Gadget for the current Guild account. */
export interface GuildSession {
  /** Returns membership, global permissions, and Space metadata after observation authorization. */
  getOverview(): Promise<GuildOverview>;
  /** Searches only Canonical Knowledge visible to the current Guild identity. */
  searchKnowledge(
    query: string,
    locale?: "en" | "ja" | "zh-CN",
  ): Promise<GuildKnowledgeSearchResult[]>;
  /** Searches permission-filtered Guild Memory before any content enters model context. */
  searchMemory(
    query: string,
    locale?: "en" | "ja" | "zh-CN",
  ): Promise<GuildMemorySearchResult[]>;
  /** Discovers only the Agents, Spaces, and Connectors that can form a valid governed run. */
  getAgentExecutionContext(): Promise<GuildAgentExecutionContext>;
  /** Stages a Risk Level 2 write to the deployment-owned webhook for human approval. */
  planWebhookAction(input: GuildWebhookPlanInput): Promise<GuildAgentActionReceipt>;
}
