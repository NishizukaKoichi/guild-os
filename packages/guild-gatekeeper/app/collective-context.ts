import type {
  ActivityType,
  CollectiveTemplate,
  MemoryType,
} from "@guild-os/domain";
import type { UiCollectiveContext } from "../src/management-types";

export function contextProfileForSpace(
  collective: UiCollectiveContext,
  spaceId: string | null | undefined,
): CollectiveTemplate {
  if (!spaceId) return { ...collective.template, labels: collective.labels };
  const space = collective.spaces.find((candidate) => candidate.id === spaceId);
  const profile = collective.templates.find((template) =>
    template.key === space?.vocabularyProfileKey) ?? collective.template;
  return { ...profile, labels: space?.labels ?? collective.labels };
}

export function visibleContextProfiles(
  collective: UiCollectiveContext,
): readonly CollectiveTemplate[] {
  const profiles = [
    collective.template,
    ...collective.spaces.map((space) => contextProfileForSpace(collective, space.id)),
  ];
  return profiles.filter((profile, index) =>
    profiles.findIndex((candidate) => candidate.key === profile.key) === index);
}

export function visibleActivityTypes(
  collective: UiCollectiveContext,
): readonly ActivityType[] {
  return [...new Set(visibleContextProfiles(collective)
    .flatMap((profile) => profile.activityTypes))];
}

export function visibleMemoryTypes(
  collective: UiCollectiveContext,
): readonly MemoryType[] {
  return [...new Set(visibleContextProfiles(collective)
    .flatMap((profile) => profile.memoryTypes))];
}
