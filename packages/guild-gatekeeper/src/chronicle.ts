import type { ChronicleEvent } from "@guild-os/domain";

export function makeChronicleEvent(
  guildId: string,
  actorIdentityId: string,
  action: string,
  subjectType: string,
  subjectId: string,
  details: ChronicleEvent["details"],
): ChronicleEvent {
  return {
    id: crypto.randomUUID(),
    guildId,
    actorIdentityId,
    action,
    subjectType,
    subjectId,
    correlationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    details,
  };
}
