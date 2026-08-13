import {
  AUTOMATION_TRIGGER_KINDS,
  CONNECTION_KINDS,
  DATA_CUSTODIES,
  FEDERATION_DIRECTIONS,
  MEMORY_LAYERS,
  MEMORY_REVIEW_SIGNAL_STATUSES,
} from "./constants.js";
import { GuildDomainError } from "./errors.js";
import type {
  AutomationTriggerKind,
  ConnectionKind,
  DataCustody,
  FederationDirection,
  JsonObject,
  MemoryLayer,
  MemoryReviewSignalStatus,
} from "./types.js";
import { assertNonBlank } from "./validation.js";

const IDENTIFIER = /^[a-z][a-z0-9._:-]{1,199}$/;
const RELATION_TYPE = /^[a-z][a-z0-9._:-]{1,99}$/;
const CRON_FIELD = /^(?:\*|\d+|\d+-\d+|\*\/\d+|\d+(?:,\d+)+)$/;

export function assertMemoryLayer(value: string): asserts value is MemoryLayer {
  if (!(MEMORY_LAYERS as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Memory layer is invalid.");
  }
}

export function assertDataCustody(value: string): asserts value is DataCustody {
  if (!(DATA_CUSTODIES as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Data custody is invalid.");
  }
}

export function assertRelationType(value: string): void {
  if (!RELATION_TYPE.test(value)) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Relation type must use a stable lowercase namespace.",
    );
  }
}

export function assertConnectionKind(value: string): asserts value is ConnectionKind {
  if (!(CONNECTION_KINDS as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Connection kind is invalid.");
  }
}

export function assertAutomationTriggerKind(
  value: string,
): asserts value is AutomationTriggerKind {
  if (!(AUTOMATION_TRIGGER_KINDS as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Automation trigger kind is invalid.");
  }
}

export function assertFederationDirection(
  value: string,
): asserts value is FederationDirection {
  if (!(FEDERATION_DIRECTIONS as readonly string[]).includes(value)) {
    throw new GuildDomainError("INVALID_INPUT", "Federation direction is invalid.");
  }
}

export function assertReviewSignalResolution(value: string): asserts value is Exclude<
  MemoryReviewSignalStatus,
  "open"
> {
  if (!(MEMORY_REVIEW_SIGNAL_STATUSES as readonly string[]).includes(value) || value === "open") {
    throw new GuildDomainError("INVALID_INPUT", "Review signal resolution is invalid.");
  }
}

export function assertIdentifierList(values: readonly string[], label: string): void {
  if (!Array.isArray(values) || values.length > 100 || new Set(values).size !== values.length ||
      !values.every((value) => IDENTIFIER.test(value))) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      `${label} must contain at most 100 unique stable identifiers.`,
    );
  }
}

export function assertWorkflowGraph(
  nodes: readonly JsonObject[],
  edges: readonly JsonObject[],
): void {
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.length > 100 || edges.length > 500) {
    throw new GuildDomainError("INVALID_INPUT", "Workflow graph is too large.");
  }
  const ids = new Set<string>();
  for (const node of nodes) {
    if (!node || typeof node !== "object" || Array.isArray(node) || typeof node.id !== "string" ||
        !IDENTIFIER.test(node.id)) {
      throw new GuildDomainError("INVALID_INPUT", "Every Workflow node needs a stable ID.");
    }
    if (ids.has(node.id)) {
      throw new GuildDomainError("INVALID_INPUT", "Workflow node IDs must be unique.");
    }
    ids.add(node.id);
  }
  for (const edge of edges) {
    if (!edge || typeof edge !== "object" || Array.isArray(edge) ||
        typeof edge.from !== "string" || typeof edge.to !== "string" ||
        !ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) {
      throw new GuildDomainError("INVALID_INPUT", "Workflow edges must connect distinct nodes.");
    }
  }
}

export function assertScheduleExpression(value: string): void {
  assertNonBlank(value, "Schedule expression", 500);
  const fields = value.trim().split(/\s+/);
  if (fields.length !== 5 || !fields.every((field) => CRON_FIELD.test(field))) {
    throw new GuildDomainError(
      "INVALID_INPUT",
      "Schedule must use a five-field minute-level cron expression.",
    );
  }
}
