import {
  CLASSIFICATION_RANK,
  HUMAN_ONLY_PERMISSIONS,
  PERMISSIONS,
  PREBOARDING_PERMISSIONS,
} from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  AgentAuthorizationRequest,
  AuthorizationRequest,
  AuthorizationSnapshot,
  Permission,
  RoleBinding,
  SecuredResource,
} from "./types.js";
import { assertSnapshotIntegrity } from "./validation.js";

function findIdentity(snapshot: AuthorizationSnapshot, identityId: string) {
  const identity = snapshot.identities.find((candidate) => candidate.id === identityId);
  if (!identity) {
    throw new GuildDomainError("IDENTITY_NOT_FOUND", `Identity ${identityId} was not found.`);
  }
  if (identity.status !== "active") {
    throw new GuildDomainError("IDENTITY_DISABLED", `Identity ${identityId} is disabled.`);
  }
  return identity;
}

function findMembership(snapshot: AuthorizationSnapshot, identityId: string) {
  const membership = snapshot.memberships.find((candidate) => candidate.identityId === identityId);
  if (!membership || !["preboarding", "active"].includes(membership.state)) {
    throw new GuildDomainError(
      "MEMBERSHIP_INACTIVE",
      `Identity ${identityId} does not have an active Guild membership.`,
    );
  }
  return membership;
}

function isSpaceWithin(
  snapshot: AuthorizationSnapshot,
  resourceSpaceId: string,
  bindingSpaceId: string,
): boolean {
  let current: string | null = resourceSpaceId;
  const visited = new Set<string>();
  while (current !== null) {
    if (current === bindingSpaceId) return true;
    if (visited.has(current)) {
      throw new GuildDomainError("INVALID_INPUT", "Space hierarchy contains a cycle.");
    }
    visited.add(current);
    current = snapshot.spaces.find((space) => space.id === current)?.parentSpaceId ?? null;
  }
  return false;
}

function bindingApplies(
  snapshot: AuthorizationSnapshot,
  binding: RoleBinding,
  resource?: SecuredResource,
): boolean {
  if (binding.spaceId === null) return true;
  if (!resource?.spaceId) return false;
  return isSpaceWithin(snapshot, resource.spaceId, binding.spaceId);
}

function hasRolePermission(
  snapshot: AuthorizationSnapshot,
  identityId: string,
  permission: Permission,
  resource?: SecuredResource,
): boolean {
  const roleIds = snapshot.roleBindings
    .filter((binding) => binding.identityId === identityId && bindingApplies(snapshot, binding, resource))
    .map((binding) => binding.roleId);
  return snapshot.roles.some(
    (role) => roleIds.includes(role.id) && role.permissions.includes(permission),
  );
}

function assertResourceVisibility(
  snapshot: AuthorizationSnapshot,
  identityId: string,
  resource: SecuredResource,
): void {
  if (resource.guildId !== snapshot.guild.id) {
    throw new GuildDomainError("RESOURCE_OUTSIDE_GUILD", "Resource belongs to another Guild.");
  }
  if (resource.visibility === "private" && resource.ownerIdentityId !== identityId &&
      !resource.allowedIdentityIds?.includes(identityId)) {
    throw new GuildDomainError("PRIVATE_RESOURCE", "Private resources require an explicit share.");
  }
  if (resource.visibility === "restricted" && resource.ownerIdentityId !== identityId &&
      !resource.allowedIdentityIds?.includes(identityId)) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      "Restricted resources require an explicit identity grant.",
    );
  }
  const membership = findMembership(snapshot, identityId);
  if (CLASSIFICATION_RANK[membership.clearance] < CLASSIFICATION_RANK[resource.classification]) {
    throw new GuildDomainError(
      "CLASSIFICATION_DENIED",
      `Identity ${identityId} lacks ${resource.classification} clearance.`,
    );
  }
}

export function authorize(
  snapshot: AuthorizationSnapshot,
  request: AuthorizationRequest,
): void {
  assertSnapshotIntegrity(snapshot);
  const identity = findIdentity(snapshot, request.actorIdentityId);
  const membership = findMembership(snapshot, request.actorIdentityId);

  if (identity.kind !== "human" && HUMAN_ONLY_PERMISSIONS.has(request.permission)) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      `${request.permission} is restricted to human identities.`,
    );
  }

  if (request.resource) {
    assertResourceVisibility(snapshot, request.actorIdentityId, request.resource);
  }

  const isRootOwner = request.actorIdentityId === snapshot.guild.rootOwnerIdentityId;
  const hasPermission = isRootOwner || hasRolePermission(
    snapshot,
    request.actorIdentityId,
    request.permission,
    request.resource,
  );
  if (!hasPermission || membership.state === "preboarding" &&
      !PREBOARDING_PERMISSIONS.has(request.permission)) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      `Identity ${request.actorIdentityId} lacks ${request.permission}.`,
    );
  }
}

export function isAuthorized(
  snapshot: AuthorizationSnapshot,
  request: AuthorizationRequest,
): boolean {
  try {
    authorize(snapshot, request);
    return true;
  } catch (error) {
    if (error instanceof GuildDomainError) return false;
    throw error;
  }
}

export function assertCanDelegatePermissions(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  permissions: readonly Permission[],
): void {
  for (const permission of permissions) {
    authorize(snapshot, { actorIdentityId, permission });
  }
}

export function authorizeAgent(
  snapshot: AuthorizationSnapshot,
  request: AgentAuthorizationRequest,
): void {
  const agent = findIdentity(snapshot, request.agentIdentityId);
  if (agent.kind !== "agent") {
    throw new GuildDomainError("INVALID_INPUT", "Agent authorization requires an agent identity.");
  }
  const profile = snapshot.agents.find((candidate) => candidate.identityId === agent.id);
  if (!profile || profile.status !== "active") {
    throw new GuildDomainError("AGENT_STOPPED", `Agent ${agent.id} is stopped.`);
  }
  const requester = findIdentity(snapshot, request.requesterIdentityId);
  if (requester.kind === "agent") {
    const requesterProfile = snapshot.agents.find(
      (candidate) => candidate.identityId === requester.id,
    );
    if (!requesterProfile || requesterProfile.status !== "active") {
      throw new GuildDomainError("AGENT_STOPPED", `Agent ${requester.id} is stopped.`);
    }
  } else if (requester.kind !== "human") {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      "An agent run requester must be a human or an active agent.",
    );
  }

  authorize(snapshot, {
    actorIdentityId: request.agentIdentityId,
    permission: request.permission,
    ...(request.resource ? { resource: request.resource } : {}),
  });
  authorize(snapshot, {
    actorIdentityId: request.requesterIdentityId,
    permission: request.permission,
    ...(request.resource ? { resource: request.resource } : {}),
  });
  if (!request.workflowPermissions.has(request.permission) ||
      !request.connectorPermissions.has(request.permission)) {
    throw new GuildDomainError(
      "PERMISSION_DENIED",
      `Workflow or connector does not grant ${request.permission}.`,
    );
  }
}

export function effectiveAgentPermissions(
  snapshot: AuthorizationSnapshot,
  agentIdentityId: string,
  requesterIdentityId: string,
  workflowPermissions: ReadonlySet<Permission>,
  connectorPermissions: ReadonlySet<Permission>,
  resource?: SecuredResource,
): ReadonlySet<Permission> {
  return new Set(PERMISSIONS.filter((permission) => {
    try {
      authorizeAgent(snapshot, {
        agentIdentityId,
        requesterIdentityId,
        permission,
        workflowPermissions,
        connectorPermissions,
        ...(resource ? { resource } : {}),
      });
      return true;
    } catch (error) {
      if (error instanceof GuildDomainError) return false;
      throw error;
    }
  }));
}

export function filterAuthorizedResources<T extends SecuredResource>(
  snapshot: AuthorizationSnapshot,
  actorIdentityId: string,
  permission: Permission,
  records: readonly T[],
): T[] {
  return records.filter((resource) => isAuthorized(snapshot, {
    actorIdentityId,
    permission,
    resource,
  }));
}

export function filterAgentAuthorizedResources<T extends SecuredResource>(
  snapshot: AuthorizationSnapshot,
  request: Omit<AgentAuthorizationRequest, "resource">,
  records: readonly T[],
): T[] {
  return records.filter((resource) => {
    try {
      authorizeAgent(snapshot, { ...request, resource });
      return true;
    } catch (error) {
      if (error instanceof GuildDomainError) return false;
      throw error;
    }
  });
}
