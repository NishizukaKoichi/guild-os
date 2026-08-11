import type { ChronicleEvent, SecuredResource } from "@guild-os/domain";

export function makeChronicleEvent(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: ChronicleEvent["details"],
  resource: SecuredResource | null = null,
): ChronicleEvent {
  return {
    id: crypto.randomUUID(),
    guildId,
    spaceId: resource?.spaceId ?? null,
    ownerIdentityId: resource?.ownerIdentityId ?? actorIdentityId,
    visibility: resource?.visibility ?? "guild",
    classification: resource?.classification ?? "restricted",
    allowedIdentityIds: resource?.allowedIdentityIds ?? [],
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    details,
  };
}
