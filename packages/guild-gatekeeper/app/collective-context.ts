import type {
  ActivityType,
  AppLocale,
  CollectiveTemplate,
  DecisionMethod,
  MemoryType,
} from "@guild-os/domain";
import { blueprintToCollectiveTemplate } from "@guild-os/domain";
import type { UiCollectiveContext } from "../src/management-types";
import {
  activityTypeLabel,
  decisionMethodLabel,
  memoryTypeLabel,
} from "./collective-language";

export function contextProfileForSpace(
  collective: UiCollectiveContext,
  spaceId: string | null | undefined,
): CollectiveTemplate {
  if (!spaceId) return { ...collective.template, labels: collective.labels };
  const space = collective.spaces.find((candidate) => candidate.id === spaceId);
  const blueprint = space?.blueprintKey
    ? collective.blueprints.find((candidate) => candidate.key === space.blueprintKey)
    : null;
  const profile = blueprint
    ? blueprintToCollectiveTemplate(blueprint)
    : collective.templates.find((template) =>
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
  return profiles;
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

export function contextActivityTypeLabel(
  collective: UiCollectiveContext,
  type: ActivityType,
  locale: AppLocale,
  spaceId?: string | null,
): string {
  const profiles = spaceId === undefined
    ? visibleContextProfiles(collective)
    : [contextProfileForSpace(collective, spaceId)];
  const custom = profiles.find((profile) => profile.activityTypeLabels?.[type])
    ?.activityTypeLabels?.[type];
  return activityTypeLabel(type, locale, custom);
}

export function contextMemoryTypeLabel(
  collective: UiCollectiveContext,
  type: MemoryType,
  locale: AppLocale,
  spaceId?: string | null,
): string {
  const profiles = spaceId === undefined
    ? visibleContextProfiles(collective)
    : [contextProfileForSpace(collective, spaceId)];
  const custom = profiles.find((profile) => profile.memoryTypeLabels?.[type])
    ?.memoryTypeLabels?.[type];
  return memoryTypeLabel(type, locale, custom);
}

export function contextDecisionMethodLabel(
  collective: UiCollectiveContext,
  method: DecisionMethod,
  locale: AppLocale,
  spaceId?: string | null,
): string {
  const profiles = spaceId === undefined
    ? visibleContextProfiles(collective)
    : [contextProfileForSpace(collective, spaceId)];
  const custom = profiles.find((profile) => profile.decisionMethodLabels?.[method])
    ?.decisionMethodLabels?.[method];
  return decisionMethodLabel(method, locale, custom);
}
