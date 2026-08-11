import { PERMISSIONS, type Permission } from "@guild-os/domain";
import type {
  AccountDescription,
  VendorDescription,
} from "@gadgets/workshop-shared/gatekeeper";

export type GuildEnv = Cloudflare.Env & {
  GUILD_ID: string;
  GUILD_NAME: string;
  GUILD_PURPOSE: string;
  GUILD_ROOT_SPACE_NAME: string;
  GUILD_LEVEL2_QUORUM: string;
  GUILD_LEVEL3_QUORUM: string;
  GUILD_RETENTION_DAYS: string;
  GUILD_ASK_MODEL: string;
  GUILD_AI_GATEWAY_ID: string;
  GUILD_WEBHOOK_CONNECTOR_ID: string;
  GUILD_WEBHOOK_CONNECTOR_NAME: string;
  GUILD_WEBHOOK_URL: string;
  GUILD_WEBHOOK_SIGNING_SECRET: string;
  HYPERDRIVE: { connectionString: string };
  KNOWLEDGE_FILES: R2Bucket;
  ASK_RATE_LIMITER: RateLimit;
  AGENT_EXECUTION: Workflow<{ guildId: string; runId: string }>;
  AI: {
    run(
      model: string,
      input: Readonly<Record<string, unknown>>,
      options?: Readonly<Record<string, unknown>>,
    ): Promise<unknown>;
    readonly aiGatewayLogId?: string;
  };
};

export type GuildAccountProps = {
  accountId: string;
};

export const GUILD_ICON = {
  url:
    "data:image/svg+xml," +
    encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 256 256' fill='none' stroke='currentColor' stroke-width='18'><path d='M128 24 216 72v112l-88 48-88-48V72z'/><path d='M88 104h80M88 144h80M128 104v80'/></svg>",
    ),
};

export const BUILTIN_ROLES: readonly {
  name: string;
  permissions: readonly Permission[];
}[] = [
  {
    name: "Admin",
    permissions: PERMISSIONS.filter((permission) => permission !== "break-glass.use"),
  },
  {
    name: "Manager",
    permissions: [
      "guild.read",
      "constitution.read",
      "space.read",
      "identity.read",
      "membership.read",
      "role.read",
      "knowledge.read",
      "knowledge.create",
      "knowledge.propose",
      "knowledge.approve",
      "file.read",
      "file.create",
      "file.delete",
      "work.read",
      "work.create",
      "work.assign",
      "decision.read",
      "decision.propose",
      "decision.approve",
      "conversation.read",
      "conversation.create",
      "conversation.moderate",
      "announcement.read",
      "announcement.manage",
      "agent.read",
      "agent.run",
      "agent.approve",
      "inbox.read",
      "chronicle.read",
      "integration.read",
      "integration.execute",
    ],
  },
  {
    name: "Member",
    permissions: [
      "guild.read",
      "constitution.read",
      "space.read",
      "identity.read",
      "membership.read",
      "role.read",
      "knowledge.read",
      "knowledge.create",
      "knowledge.propose",
      "file.read",
      "file.create",
      "work.read",
      "work.create",
      "decision.read",
      "decision.propose",
      "conversation.read",
      "conversation.create",
      "announcement.read",
      "agent.read",
      "agent.run",
      "inbox.read",
      "integration.read",
      "integration.execute",
    ],
  },
];

export function describeGuildVendor(): VendorDescription {
  return {
    displayName: "Guild OS",
    url: "https://github.com/cloudflare/cloudflare-os",
    logo: GUILD_ICON,
    color: "#eef6f0",
    tagline: "Governed memory, work, decisions, and agents",
    description:
      "Connect agents and Gadgets to the current Guild through Space- and Role-aware capabilities.",
    autoProvisionsAccount: true,
    providesAuth: false,
  };
}

export function describeGuildAccount(): AccountDescription {
  return {
    displayName: "Guild OS",
    avatar: GUILD_ICON,
    singleton: { tsType: "GuildSession" },
    providesUi: { title: "Guild", icon: GUILD_ICON },
  };
}
