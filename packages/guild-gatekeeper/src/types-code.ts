const TYPES_CODE = `export interface GuildSpaceSummary {
  id: string;
  name: string;
  parentSpaceId: string | null;
}

export interface GuildOverview {
  guildId: string;
  name: string;
  purpose: string;
  identityId: string;
  identityKind: "human" | "agent" | "service";
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

/** Read-only capability supplied to an agent or Gadget for the current Guild account. */
export interface GuildSession {
  /** Returns membership, global permissions, and Space metadata after observation authorization. */
  getOverview(): Promise<GuildOverview>;
  /** Searches only Canonical Knowledge visible to the current Guild identity. */
  searchKnowledge(
    query: string,
    locale?: "en" | "ja" | "zh-CN",
  ): Promise<GuildKnowledgeSearchResult[]>;
}
`;

export default TYPES_CODE;
