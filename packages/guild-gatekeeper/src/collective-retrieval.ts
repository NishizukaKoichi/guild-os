import {
  authorize,
  type AppLocale,
  type AuthorizationSnapshot,
  type Classification,
  type IdentityKind,
  type ActorMembershipState,
  type SecuredResource,
  type Visibility,
} from "@guild-os/domain";
import {
  loadActorAuthorizationSnapshot,
  withGuildTransaction,
  type GuildTransactionConnection,
} from "@guild-os/postgres";
import type { GuildEnv } from "./config.js";

const MAX_QUERY_LENGTH = 500;
const MAX_RESULTS_PER_KIND = 8;
const MAX_CONTEXT_CHARACTERS = 24_000;

export interface AuthorizedActorContext {
  kind: "actor";
  id: string;
  title: string;
  summary: string;
  content: string;
  spaceId: null;
  version: number;
}

export interface AuthorizedDecisionContext {
  kind: "decision";
  id: string;
  title: string;
  summary: string;
  content: string;
  spaceId: string | null;
  version: number;
}

export type AuthorizedCollectiveContext = AuthorizedActorContext | AuthorizedDecisionContext;

interface ActorCandidateRow {
  id: string;
}

interface ActorContentRow {
  id: string;
  display_name: string;
  kind: IdentityKind;
  membership_state: ActorMembershipState;
  role_names: string[];
  version: number;
}

interface DecisionBoundaryRow {
  id: string;
  space_id: string | null;
  owner_identity_id: string;
  visibility: Visibility;
  classification: Classification;
  allowed_identity_ids: string[];
}

interface DecisionContentRow {
  id: string;
  space_id: string | null;
  title: string;
  description: string;
  rationale: string;
  status: string;
  version: number;
}

function validateQuery(query: string): string {
  const normalized = query.trim();
  if (normalized.length < 1 || normalized.length > MAX_QUERY_LENGTH) {
    throw new Error(`Ask Guild queries must contain between 1 and ${MAX_QUERY_LENGTH} characters.`);
  }
  return normalized;
}

function languageLabel(locale: AppLocale, kind: IdentityKind, state: ActorMembershipState): string {
  const kindLabel = locale === "ja"
    ? ({ human: "人間", agent: "AIエージェント", service: "サービス", guild: "Guild" } as const)[kind]
    : locale === "zh-CN"
      ? ({ human: "人员", agent: "AI智能体", service: "服务", guild: "Guild" } as const)[kind]
      : ({ human: "Human", agent: "AI Agent", service: "Service", guild: "Guild" } as const)[kind];
  const stateLabel = locale === "ja" ? `参加状態: ${state}`
    : locale === "zh-CN" ? `成员状态: ${state}` : `Membership: ${state}`;
  return `${kindLabel}; ${stateLabel}`;
}

function actorResource(guildId: string, actorId: string): SecuredResource {
  return {
    id: actorId,
    guildId,
    spaceId: null,
    ownerIdentityId: actorId,
    visibility: "guild",
    classification: "internal",
    allowedIdentityIds: [],
  };
}

function decisionResource(guildId: string, row: DecisionBoundaryRow): SecuredResource {
  return {
    id: row.id,
    guildId,
    spaceId: row.space_id,
    ownerIdentityId: row.owner_identity_id,
    visibility: row.visibility,
    classification: row.classification,
    allowedIdentityIds: row.allowed_identity_ids,
  };
}

async function snapshotFor(
  cache: Map<string, Promise<AuthorizationSnapshot>>,
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  spaceId: string | null,
): Promise<AuthorizationSnapshot> {
  const key = spaceId ?? "guild";
  const existing = cache.get(key);
  if (existing) return existing;
  const created = loadActorAuthorizationSnapshot(connection, guildId, actorId, spaceId);
  cache.set(key, created);
  return created;
}

async function searchActors(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  query: string,
  locale: AppLocale,
): Promise<AuthorizedActorContext[]> {
  const candidates = (await connection.query<ActorCandidateRow>(
    `SELECT actor.id::text
       FROM actors actor
       JOIN actor_memberships membership
         ON membership.guild_id = $1 AND membership.actor_id = actor.id
      WHERE actor.status = 'active' AND membership.operational = true
        AND membership.state IN ('joined', 'active')
        AND (
          actor.display_name ILIKE '%' || $2 || '%'
          OR actor.kind::text ILIKE '%' || $2 || '%'
          OR EXISTS (
            SELECT 1
              FROM actor_role_bindings binding
              JOIN roles role ON role.guild_id = binding.guild_id AND role.id = binding.role_id
             WHERE binding.guild_id = $1 AND binding.actor_id = actor.id
               AND role.name ILIKE '%' || $2 || '%'
          )
        )
      ORDER BY actor.display_name, actor.id
      LIMIT 32`,
    [guildId, query],
  )).rows;
  if (candidates.length === 0) return [];

  const snapshot = await loadActorAuthorizationSnapshot(connection, guildId, actorId);
  const allowedIds: string[] = [];
  for (const candidate of candidates) {
    try {
      authorize(snapshot, {
        actorIdentityId: actorId,
        permission: "actor.read",
        resource: actorResource(guildId, candidate.id),
      });
      allowedIds.push(candidate.id);
    } catch {
      // Unauthorized Actor metadata is never fetched into application context.
    }
    if (allowedIds.length >= MAX_RESULTS_PER_KIND) break;
  }
  if (allowedIds.length === 0) return [];

  const rows = (await connection.query<ActorContentRow>(
    `SELECT actor.id::text, actor.display_name, actor.kind,
            membership.state AS membership_state,
            COALESCE(array_agg(DISTINCT role.name ORDER BY role.name)
              FILTER (WHERE role.name IS NOT NULL), '{}') AS role_names,
            GREATEST(1, extract(epoch FROM GREATEST(
              actor.updated_at, membership.updated_at
            ))::integer) AS version
       FROM actors actor
       JOIN actor_memberships membership
         ON membership.guild_id = $1 AND membership.actor_id = actor.id
       LEFT JOIN actor_role_bindings binding
         ON binding.guild_id = $1 AND binding.actor_id = actor.id
       LEFT JOIN roles role ON role.guild_id = binding.guild_id AND role.id = binding.role_id
      WHERE actor.id = ANY($2::uuid[])
      GROUP BY actor.id, actor.display_name, actor.kind, membership.state,
               actor.updated_at, membership.updated_at
      ORDER BY actor.display_name, actor.id`,
    [guildId, allowedIds],
  )).rows;
  return rows.map((row) => {
    const roles = row.role_names.length > 0 ? row.role_names.join(", ") : "None";
    const summary = languageLabel(locale, row.kind, row.membership_state);
    return {
      kind: "actor",
      id: row.id,
      title: row.display_name,
      summary,
      content: `${summary}. Roles: ${roles}.`,
      spaceId: null,
      version: row.version,
    };
  });
}

async function searchDecisions(
  connection: GuildTransactionConnection,
  guildId: string,
  actorId: string,
  query: string,
): Promise<AuthorizedDecisionContext[]> {
  const candidates = (await connection.query<DecisionBoundaryRow>(
    `SELECT decision.id::text, decision.space_id::text, decision.owner_identity_id::text,
            decision.visibility, decision.classification,
            decision.allowed_identity_ids::text[]
       FROM decisions decision
      WHERE decision.guild_id = $1
        AND to_tsvector('simple', decision.title || ' ' || decision.description || ' ' || decision.rationale)
            @@ plainto_tsquery('simple', $2)
      ORDER BY decision.updated_at DESC, decision.id DESC
      LIMIT 32`,
    [guildId, query],
  )).rows;
  if (candidates.length === 0) return [];

  const snapshots = new Map<string, Promise<AuthorizationSnapshot>>();
  const allowedIds: string[] = [];
  for (const candidate of candidates) {
    try {
      const snapshot = await snapshotFor(
        snapshots,
        connection,
        guildId,
        actorId,
        candidate.space_id,
      );
      authorize(snapshot, {
        actorIdentityId: actorId,
        permission: "decision.read",
        resource: decisionResource(guildId, candidate),
      });
      allowedIds.push(candidate.id);
    } catch {
      // Decision text is fetched only after the boundary check succeeds.
    }
    if (allowedIds.length >= MAX_RESULTS_PER_KIND) break;
  }
  if (allowedIds.length === 0) return [];

  const rows = (await connection.query<DecisionContentRow>(
    `SELECT id::text, space_id::text, title, description, rationale, status, version
       FROM decisions
      WHERE guild_id = $1 AND id = ANY($2::uuid[])
      ORDER BY updated_at DESC, id DESC`,
    [guildId, allowedIds],
  )).rows;
  return rows.map((row) => ({
    kind: "decision",
    id: row.id,
    title: row.title,
    summary: row.description || row.rationale || row.status,
    content: `Status: ${row.status}\nDescription: ${row.description}\nRationale: ${row.rationale}`,
    spaceId: row.space_id,
    version: row.version,
  }));
}

export async function searchAuthorizedCollectiveContext(
  env: GuildEnv,
  actorId: string,
  rawQuery: string,
  locale: AppLocale,
): Promise<AuthorizedCollectiveContext[]> {
  const query = validateQuery(rawQuery);
  return withGuildTransaction(
    env.HYPERDRIVE.connectionString,
    env.GUILD_ID,
    async (connection) => {
      await connection.query("SELECT set_config('app.actor_identity_id', $1, true)", [actorId]);
      const [actors, decisions] = await Promise.all([
        searchActors(connection, env.GUILD_ID, actorId, query, locale),
        searchDecisions(connection, env.GUILD_ID, actorId, query),
      ]);
      const combined: AuthorizedCollectiveContext[] = [];
      let characters = 0;
      for (const context of [...decisions, ...actors]) {
        const next = context.title.length + context.summary.length + context.content.length;
        if (characters + next > MAX_CONTEXT_CHARACTERS) break;
        combined.push(context);
        characters += next;
      }
      return combined;
    },
  );
}
