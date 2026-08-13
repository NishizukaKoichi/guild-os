import type { JsonObject, JsonValue } from "@guild-os/domain";

const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_REQUEST_BYTES = 256 * 1024;
const MAX_REQUEST_BYTES = 1024 * 1024;
const DEFAULT_MAX_RESPONSE_BYTES = 32 * 1024;
const MAX_RESPONSE_BYTES = 256 * 1024;
const DEFAULT_FRESHNESS_MS = 5 * 60 * 1_000;
const MAX_FRESHNESS_MS = 15 * 60 * 1_000;
const MAX_GRANTS_PER_EVENT = 100;
const MAX_JSON_DEPTH = 32;
const MAX_JSON_MEMBERS = 10_000;
const HMAC_BYTES = 32;

export const FEDERATION_EVENT_TYPES = {
  resourcesPublished: "guild.federation.resources.published",
  grantsRevoked: "guild.federation.grants.revoked",
  linkRevoked: "guild.federation.link.revoked",
} as const;

export type FederationEventType =
  (typeof FEDERATION_EVENT_TYPES)[keyof typeof FEDERATION_EVENT_TYPES];

export type FederationTransportErrorCode =
  | "invalid_request"
  | "unsafe_endpoint"
  | "link_not_found"
  | "link_inactive"
  | "direction_not_allowed"
  | "target_mismatch"
  | "source_mismatch"
  | "payload_hash_mismatch"
  | "grant_not_authorized"
  | "grant_revoked"
  | "secret_unavailable"
  | "signature_invalid"
  | "request_stale"
  | "delivery_in_progress"
  | "request_too_large"
  | "response_too_large"
  | "redirect_refused"
  | "request_timeout"
  | "network_error"
  | "remote_unavailable"
  | "remote_rejected"
  | "invalid_acknowledgement"
  | "replay_conflict"
  | "repository_error";

const ERROR_MESSAGES: Readonly<Record<FederationTransportErrorCode, string>> = {
  invalid_request: "Federation request is invalid.",
  unsafe_endpoint: "Federation endpoint is not a permitted public HTTPS URL.",
  link_not_found: "Federation link was not found.",
  link_inactive: "Federation link is not active.",
  direction_not_allowed: "Federation link does not allow this direction.",
  target_mismatch: "Federation target does not match this Guild.",
  source_mismatch: "Federation source does not match the configured remote Guild.",
  payload_hash_mismatch: "Federation payload hash does not match its contents.",
  grant_not_authorized: "Federation payload is not covered by explicit grants.",
  grant_revoked: "Federation payload contains a revoked grant.",
  secret_unavailable: "Federation signing secret is unavailable.",
  signature_invalid: "Federation signature is invalid.",
  request_stale: "Federation request is outside the permitted time window.",
  delivery_in_progress: "Federation delivery is already being processed.",
  request_too_large: "Federation request exceeded the allowed size.",
  response_too_large: "Federation response exceeded the allowed size.",
  redirect_refused: "Federation redirects are not permitted.",
  request_timeout: "Federation request timed out.",
  network_error: "Federation endpoint could not be reached.",
  remote_unavailable: "Remote Guild is temporarily unavailable.",
  remote_rejected: "Remote Guild rejected the Federation delivery.",
  invalid_acknowledgement: "Remote Guild returned an invalid Federation acknowledgement.",
  replay_conflict: "Federation idempotency key was reused with different input.",
  repository_error: "Federation state could not be persisted.",
};

export class FederationTransportError extends Error {
  readonly code: FederationTransportErrorCode;
  readonly retryable: boolean;

  constructor(code: FederationTransportErrorCode, retryable = false) {
    super(ERROR_MESSAGES[code]);
    this.name = "FederationTransportError";
    this.code = code;
    this.retryable = retryable;
  }
}

export type FederationResourceType = "memory" | "activity" | "decision";
export type FederationGrantPermission = "read" | "participate";

export interface FederationGrantCoordinates {
  readonly grantId: string;
  readonly resourceType: FederationResourceType;
  readonly resourceId: string;
  readonly permission: FederationGrantPermission;
  readonly grantVersion: number;
}

/** Resource data is carried only inside a named, versioned, explicit grant. */
export interface FederationPublishedGrant extends FederationGrantCoordinates {
  readonly resourceVersion: number;
  readonly resource: JsonObject;
}

export interface FederationRevokedGrant extends FederationGrantCoordinates {
  readonly revokedAt: string;
}

export interface FederationResourcesPublishedPayload {
  readonly kind: "resources_published";
  readonly grants: readonly FederationPublishedGrant[];
}

export interface FederationGrantsRevokedPayload {
  readonly kind: "grants_revoked";
  readonly grants: readonly FederationRevokedGrant[];
}

export interface FederationLinkRevokedPayload {
  readonly kind: "link_revoked";
  readonly linkVersion: number;
  readonly revokedAt: string;
}

export type FederationExplicitPayload =
  | FederationResourcesPublishedPayload
  | FederationGrantsRevokedPayload
  | FederationLinkRevokedPayload;

export interface FederationEnvelope {
  readonly sourceGuildId: string;
  readonly targetGuildId: string;
  readonly linkId: string;
  readonly deliveryId: string;
  readonly eventType: FederationEventType;
  readonly payload: FederationExplicitPayload;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly issuedAt: string;
}

export interface FederationTransportLink {
  readonly id: string;
  readonly guildId: string;
  readonly remoteGuildId: string;
  readonly endpointUrl: string;
  readonly secretReference: string;
  readonly direction: "inbound" | "outbound" | "bidirectional";
  readonly status: "pending" | "active" | "revoked";
}

export interface FederationOutboundDelivery {
  readonly id: string;
  readonly guildId: string;
  readonly federationLinkId: string;
  readonly eventType: FederationEventType;
  readonly payload: FederationExplicitPayload;
  readonly payloadHash: string;
  readonly idempotencyKey: string;
  readonly attemptCount: number;
}

export type FederationGrantAuthorization = "authorized" | "denied" | "revoked";

export interface FederationInboundReservation {
  readonly state: "accepted" | "duplicate" | "conflict" | "busy";
}

export interface FederationDeliveryCompletion {
  readonly deliveryId: string;
  readonly linkId: string;
  readonly direction: "inbound" | "outbound";
  readonly eventType: FederationEventType;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly outcome: "completed" | "duplicate" | "rejected";
  readonly errorCode: FederationTransportErrorCode | null;
  readonly occurredAt: string;
  readonly chronicleEventType:
    | "federation.delivery.completed"
    | "federation.delivery.duplicate"
    | "federation.delivery.rejected";
}

export interface FederationDeliveryRetry {
  readonly deliveryId: string;
  readonly linkId: string;
  readonly direction: "inbound" | "outbound";
  readonly eventType: FederationEventType;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly errorCode: FederationTransportErrorCode;
  readonly retryAt: string;
  readonly occurredAt: string;
  readonly chronicleEventType: "federation.delivery.retry_scheduled";
}

/**
 * The implementation behind this port must update delivery state and append the supplied
 * Chronicle event atomically. The transport never reads Guild resources through ambient access.
 */
export interface FederationTransportRepository {
  getLink(linkId: string): Promise<FederationTransportLink | null>;
  authorizeOutboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization>;
  authorizeInboundPayload(input: {
    readonly link: FederationTransportLink;
    readonly eventType: FederationEventType;
    readonly payload: FederationExplicitPayload;
  }): Promise<FederationGrantAuthorization>;
  reserveInboundDelivery(input: {
    readonly envelope: FederationEnvelope;
    readonly envelopeHash: string;
  }): Promise<FederationInboundReservation>;
  applyInboundDelivery(input: {
    readonly envelope: FederationEnvelope;
  }): Promise<void>;
  finishDelivery(input: FederationDeliveryCompletion): Promise<void>;
  retryDelivery(input: FederationDeliveryRetry): Promise<void>;
}

export type FederationSecretResolver = (
  secretReference: string,
) => string | null | undefined | Promise<string | null | undefined>;

export type FederationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export interface FederationTransportRuntime {
  readonly repository: FederationTransportRepository;
  readonly resolveSecret: FederationSecretResolver;
  readonly fetch: FederationFetch;
  readonly now?: () => Date;
  readonly timeoutMs?: number;
  readonly maxRequestBytes?: number;
  readonly maxResponseBytes?: number;
  readonly freshnessMs?: number;
}

export interface FederationInboundRuntime {
  readonly localGuildId: string;
  readonly repository: FederationTransportRepository;
  readonly resolveSecret: FederationSecretResolver;
  readonly now?: () => Date;
  readonly maxRequestBytes?: number;
  readonly freshnessMs?: number;
}

export interface FederationInboundRequest {
  /** Bytes returned by Request.arrayBuffer(), without decoding or re-serialization. */
  readonly rawBody: ArrayBuffer | Uint8Array;
  readonly signature: string | null;
}

export interface FederationInboundAcknowledgement {
  readonly deliveryId: string;
  readonly idempotencyKey: string;
  readonly payloadHash: string;
  readonly status: "accepted" | "duplicate";
}

export interface FederationOutboundResult extends FederationInboundAcknowledgement {
  readonly statusCode: number;
}

interface NormalizedLimits {
  readonly timeoutMs: number;
  readonly maxRequestBytes: number;
  readonly maxResponseBytes: number;
  readonly freshnessMs: number;
}

function transportError(
  code: FederationTransportErrorCode,
  retryable = false,
): FederationTransportError {
  return new FederationTransportError(code, retryable);
}

function asTransportError(error: unknown): FederationTransportError {
  return error instanceof FederationTransportError
    ? error
    : transportError("repository_error", true);
}

function normalizePositiveLimit(
  value: number | undefined,
  fallback: number,
  maximum: number,
): number {
  const resolved = value ?? fallback;
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw transportError("invalid_request");
  }
  return resolved;
}

function normalizeOutboundLimits(runtime: FederationTransportRuntime): NormalizedLimits {
  return {
    timeoutMs: normalizePositiveLimit(runtime.timeoutMs, DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxRequestBytes: normalizePositiveLimit(
      runtime.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      MAX_REQUEST_BYTES,
    ),
    maxResponseBytes: normalizePositiveLimit(
      runtime.maxResponseBytes,
      DEFAULT_MAX_RESPONSE_BYTES,
      MAX_RESPONSE_BYTES,
    ),
    freshnessMs: normalizePositiveLimit(
      runtime.freshnessMs,
      DEFAULT_FRESHNESS_MS,
      MAX_FRESHNESS_MS,
    ),
  };
}

function normalizeInboundLimits(runtime: FederationInboundRuntime): NormalizedLimits {
  return {
    timeoutMs: DEFAULT_TIMEOUT_MS,
    maxRequestBytes: normalizePositiveLimit(
      runtime.maxRequestBytes,
      DEFAULT_MAX_REQUEST_BYTES,
      MAX_REQUEST_BYTES,
    ),
    maxResponseBytes: DEFAULT_MAX_RESPONSE_BYTES,
    freshnessMs: normalizePositiveLimit(
      runtime.freshnessMs,
      DEFAULT_FRESHNESS_MS,
      MAX_FRESHNESS_MS,
    ),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function isBoundedText(value: unknown, maximum: number, minimum = 1): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function isPositiveVersion(value: unknown): value is number {
  return Number.isSafeInteger(value) && typeof value === "number" && value > 0;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== "string" ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function isJsonObject(value: unknown): value is JsonObject {
  const seen = new WeakSet<object>();
  let members = 0;
  const visit = (candidate: unknown, depth: number): candidate is JsonValue => {
    if (candidate === null || typeof candidate === "string" || typeof candidate === "boolean") {
      return true;
    }
    if (typeof candidate === "number") return Number.isFinite(candidate);
    if (typeof candidate !== "object" || depth > MAX_JSON_DEPTH || seen.has(candidate)) return false;
    seen.add(candidate);
    if (Array.isArray(candidate)) {
      members += candidate.length;
      return members <= MAX_JSON_MEMBERS && candidate.every((entry) => visit(entry, depth + 1));
    }
    const values = Object.values(candidate);
    members += values.length;
    return members <= MAX_JSON_MEMBERS && values.every((entry) => visit(entry, depth + 1));
  };
  return isRecord(value) && visit(value, 0);
}

function isResourceType(value: unknown): value is FederationResourceType {
  return value === "memory" || value === "activity" || value === "decision";
}

function isPermission(value: unknown): value is FederationGrantPermission {
  return value === "read" || value === "participate";
}

function hasValidGrantCoordinates(value: Record<string, unknown>): boolean {
  return isUuid(value.grantId) && isResourceType(value.resourceType) &&
    isUuid(value.resourceId) && isPermission(value.permission) &&
    isPositiveVersion(value.grantVersion);
}

function validatePublishedGrant(value: unknown): value is FederationPublishedGrant {
  return isRecord(value) && hasExactKeys(value, [
    "grantId", "resourceType", "resourceId", "permission", "grantVersion",
    "resourceVersion", "resource",
  ]) && hasValidGrantCoordinates(value) && isPositiveVersion(value.resourceVersion) &&
    isJsonObject(value.resource);
}

function validateRevokedGrant(value: unknown): value is FederationRevokedGrant {
  return isRecord(value) && hasExactKeys(value, [
    "grantId", "resourceType", "resourceId", "permission", "grantVersion", "revokedAt",
  ]) && hasValidGrantCoordinates(value) && isIsoTimestamp(value.revokedAt);
}

function uniqueGrantIds(grants: readonly FederationGrantCoordinates[]): boolean {
  return new Set(grants.map((grant) => grant.grantId)).size === grants.length;
}

function validatePayload(
  eventType: FederationEventType,
  value: unknown,
): value is FederationExplicitPayload {
  if (!isRecord(value)) return false;
  if (eventType === FEDERATION_EVENT_TYPES.resourcesPublished) {
    if (!hasExactKeys(value, ["kind", "grants"]) || value.kind !== "resources_published" ||
        !Array.isArray(value.grants) || value.grants.length < 1 ||
        value.grants.length > MAX_GRANTS_PER_EVENT ||
        !value.grants.every(validatePublishedGrant)) return false;
    return uniqueGrantIds(value.grants);
  }
  if (eventType === FEDERATION_EVENT_TYPES.grantsRevoked) {
    if (!hasExactKeys(value, ["kind", "grants"]) || value.kind !== "grants_revoked" ||
        !Array.isArray(value.grants) || value.grants.length < 1 ||
        value.grants.length > MAX_GRANTS_PER_EVENT ||
        !value.grants.every(validateRevokedGrant)) return false;
    return uniqueGrantIds(value.grants);
  }
  return hasExactKeys(value, ["kind", "linkVersion", "revokedAt"]) &&
    value.kind === "link_revoked" && isPositiveVersion(value.linkVersion) &&
    isIsoTimestamp(value.revokedAt);
}

function isEventType(value: unknown): value is FederationEventType {
  return Object.values(FEDERATION_EVENT_TYPES).some((eventType) => eventType === value);
}

function validateEnvelope(value: unknown): FederationEnvelope {
  if (!isRecord(value) || !hasExactKeys(value, [
    "sourceGuildId", "targetGuildId", "linkId", "deliveryId", "eventType", "payload",
    "payloadHash", "idempotencyKey", "issuedAt",
  ]) || !isUuid(value.sourceGuildId) || !isUuid(value.targetGuildId) ||
      !isUuid(value.linkId) || !isUuid(value.deliveryId) || !isEventType(value.eventType) ||
      !validatePayload(value.eventType, value.payload) || !isSha256(value.payloadHash) ||
      !isBoundedText(value.idempotencyKey, 500) || !isIsoTimestamp(value.issuedAt)) {
    throw transportError("invalid_request");
  }
  return value as unknown as FederationEnvelope;
}

function validateOutboundDelivery(value: FederationOutboundDelivery): void {
  if (!isUuid(value.id) || !isUuid(value.guildId) || !isUuid(value.federationLinkId) ||
      !isEventType(value.eventType) || !validatePayload(value.eventType, value.payload) ||
      !isSha256(value.payloadHash) || !isBoundedText(value.idempotencyKey, 500) ||
      !Number.isSafeInteger(value.attemptCount) || value.attemptCount < 0 || value.attemptCount > 20) {
    throw transportError("invalid_request");
  }
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean" ||
      typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (!isRecord(value)) throw transportError("invalid_request");
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson(value[key] ?? null)}`).join(",")}}`;
}

function utf8(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256Bytes(bytes: Uint8Array): Promise<string> {
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

async function envelopeFingerprint(envelope: FederationEnvelope): Promise<string> {
  return sha256Bytes(utf8(stableJson({
    sourceGuildId: envelope.sourceGuildId,
    targetGuildId: envelope.targetGuildId,
    linkId: envelope.linkId,
    deliveryId: envelope.deliveryId,
    eventType: envelope.eventType,
    payloadHash: envelope.payloadHash,
    idempotencyKey: envelope.idempotencyKey,
  })));
}

export async function hashFederationPayload(payload: FederationExplicitPayload): Promise<string> {
  if (!validatePayload(
    payload.kind === "resources_published"
      ? FEDERATION_EVENT_TYPES.resourcesPublished
      : payload.kind === "grants_revoked"
        ? FEDERATION_EVENT_TYPES.grantsRevoked
        : FEDERATION_EVENT_TYPES.linkRevoked,
    payload,
  )) throw transportError("invalid_request");
  return sha256Bytes(utf8(stableJson(payload)));
}

async function resolveSecret(
  reference: string,
  resolver: FederationSecretResolver,
): Promise<string> {
  if (!isBoundedText(reference, 500)) throw transportError("secret_unavailable");
  let value: string | null | undefined;
  try {
    value = await resolver(reference);
  } catch {
    throw transportError("secret_unavailable");
  }
  if (typeof value !== "string" || utf8(value).byteLength < 32 || value.length > 16_384 ||
      /[\r\n\u0000]/.test(value)) {
    throw transportError("secret_unavailable");
  }
  return value;
}

async function hmac(secret: string, bytes: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    utf8(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, bytes));
}

function parseSignature(value: string | null): Uint8Array | null {
  if (value === null || !/^v1=[a-f0-9]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(HMAC_BYTES);
  for (let index = 0; index < HMAC_BYTES; index += 1) {
    bytes[index] = Number.parseInt(value.slice(3 + index * 2, 5 + index * 2), 16);
  }
  return bytes;
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  let difference = left.byteLength ^ right.byteLength;
  const length = Math.max(left.byteLength, right.byteLength);
  for (let index = 0; index < length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

async function signatureFor(secret: string, bytes: Uint8Array): Promise<string> {
  return `v1=${[...await hmac(secret, bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")}`;
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const a = octets[0]!;
  const b = octets[1]!;
  const c = octets[2]!;
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    (a === 192 && b === 0 && (c === 0 || c === 2)) ||
    (a === 198 && b === 51 && c === 100) ||
    (a === 203 && b === 0 && c === 113);
}

function safeFederationEndpoint(value: string): URL {
  if (!isBoundedText(value, 2_048)) throw transportError("unsafe_endpoint");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw transportError("unsafe_endpoint");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const blockedSuffixes = [".localhost", ".local", ".internal", ".home", ".lan", ".corp", ".arpa"];
  if (url.protocol !== "https:" || url.username || url.password || url.port && url.port !== "443" ||
      !hostname || hostname.length > 253 || !hostname.includes(".") ||
      hostname === "localhost" || hostname === "metadata.google.internal" ||
      blockedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
      hostname.includes(":") || hostname.startsWith("[") || isBlockedIpv4(hostname) ||
      url.search || url.hash) {
    throw transportError("unsafe_endpoint");
  }
  return url;
}

function assertActiveLink(
  link: FederationTransportLink | null,
  expectedGuildId: string,
  expectedRemoteGuildId: string | null,
  direction: "inbound" | "outbound",
  eventType: FederationEventType,
): asserts link is FederationTransportLink {
  if (link === null) throw transportError("link_not_found");
  if (link.guildId !== expectedGuildId) throw transportError("link_not_found");
  if (expectedRemoteGuildId !== null && link.remoteGuildId !== expectedRemoteGuildId) {
    throw transportError(direction === "inbound" ? "source_mismatch" : "target_mismatch");
  }
  if (link.status !== "active" && !(
    link.status === "revoked" && eventType === FEDERATION_EVENT_TYPES.linkRevoked
  )) throw transportError("link_inactive");
  if (direction === "outbound" && link.direction !== "outbound" && link.direction !== "bidirectional") {
    throw transportError("direction_not_allowed");
  }
  if (direction === "inbound" && link.direction !== "inbound" && link.direction !== "bidirectional") {
    throw transportError("direction_not_allowed");
  }
}

function assertAuthorized(value: FederationGrantAuthorization): void {
  if (value === "revoked") throw transportError("grant_revoked");
  if (value !== "authorized") throw transportError("grant_not_authorized");
}

function rawBytes(value: ArrayBuffer | Uint8Array): Uint8Array {
  return value instanceof Uint8Array
    ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength)
    : new Uint8Array(value);
}

async function readBoundedResponse(response: Response, maximumBytes: number): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw transportError("response_too_large");
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        text += decoder.decode();
        return text;
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw transportError("response_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

async function fetchWithTimeout(
  fetcher: FederationFetch,
  endpoint: URL,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(transportError("request_timeout", true));
    }, timeoutMs);
  });
  const request = fetcher(endpoint, { ...init, redirect: "manual", signal: controller.signal })
    .catch((error: unknown) => {
      if (error instanceof FederationTransportError) throw error;
      if (timedOut || controller.signal.aborted) throw transportError("request_timeout", true);
      throw transportError("network_error", true);
    });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function validateAcknowledgement(
  value: unknown,
  envelope: FederationEnvelope,
): FederationInboundAcknowledgement {
  if (!isRecord(value) || !hasExactKeys(value, [
    "deliveryId", "idempotencyKey", "payloadHash", "status",
  ]) || value.deliveryId !== envelope.deliveryId || value.idempotencyKey !== envelope.idempotencyKey ||
      value.payloadHash !== envelope.payloadHash ||
      (value.status !== "accepted" && value.status !== "duplicate")) {
    throw transportError("invalid_acknowledgement");
  }
  return value as unknown as FederationInboundAcknowledgement;
}

function retryAt(now: Date, attemptCount: number): string {
  const seconds = Math.min(15 * 60, 30 * (2 ** Math.min(attemptCount, 5)));
  return new Date(now.valueOf() + seconds * 1_000).toISOString();
}

async function recordOutboundFailure(
  runtime: FederationTransportRuntime,
  delivery: FederationOutboundDelivery,
  error: FederationTransportError,
  occurredAt: string,
): Promise<void> {
  if (error.retryable) {
    await runtime.repository.retryDelivery({
      deliveryId: delivery.id,
      linkId: delivery.federationLinkId,
      direction: "outbound",
      eventType: delivery.eventType,
      idempotencyKey: delivery.idempotencyKey,
      payloadHash: delivery.payloadHash,
      errorCode: error.code,
      retryAt: retryAt(new Date(occurredAt), delivery.attemptCount),
      occurredAt,
      chronicleEventType: "federation.delivery.retry_scheduled",
    });
    return;
  }
  await runtime.repository.finishDelivery({
    deliveryId: delivery.id,
    linkId: delivery.federationLinkId,
    direction: "outbound",
    eventType: delivery.eventType,
    idempotencyKey: delivery.idempotencyKey,
    payloadHash: delivery.payloadHash,
    outcome: "rejected",
    errorCode: error.code,
    occurredAt,
    chronicleEventType: "federation.delivery.rejected",
  });
}

export async function deliverFederationDelivery(
  delivery: FederationOutboundDelivery,
  runtime: FederationTransportRuntime,
): Promise<FederationOutboundResult> {
  validateOutboundDelivery(delivery);
  const limits = normalizeOutboundLimits(runtime);
  const now = runtime.now?.() ?? new Date();
  const occurredAt = now.toISOString();
  let envelope: FederationEnvelope | null = null;
  try {
    const link = await runtime.repository.getLink(delivery.federationLinkId);
    assertActiveLink(link, delivery.guildId, null, "outbound", delivery.eventType);
    const endpoint = safeFederationEndpoint(link.endpointUrl);
    const authorization = await runtime.repository.authorizeOutboundPayload({
      link,
      eventType: delivery.eventType,
      payload: delivery.payload,
    });
    assertAuthorized(authorization);
    const payloadHash = await hashFederationPayload(delivery.payload);
    if (payloadHash !== delivery.payloadHash) throw transportError("payload_hash_mismatch");
    envelope = {
      sourceGuildId: delivery.guildId,
      targetGuildId: link.remoteGuildId,
      linkId: link.id,
      deliveryId: delivery.id,
      eventType: delivery.eventType,
      payload: delivery.payload,
      payloadHash,
      idempotencyKey: delivery.idempotencyKey,
      issuedAt: occurredAt,
    };
    const body = JSON.stringify(envelope);
    const bodyBytes = utf8(body);
    if (bodyBytes.byteLength > limits.maxRequestBytes) throw transportError("request_too_large");
    const secret = await resolveSecret(link.secretReference, runtime.resolveSecret);
    const signature = await signatureFor(secret, bodyBytes);
    const response = await fetchWithTimeout(runtime.fetch, endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "idempotency-key": delivery.idempotencyKey,
        "user-agent": "Guild-OS-Federation/1.0",
        "x-guild-federation-event": delivery.eventType,
        "x-guild-federation-signature": signature,
      },
      body,
    }, limits.timeoutMs);
    if (response.redirected || (response.status >= 300 && response.status < 400) || response.status === 0) {
      await response.body?.cancel().catch(() => undefined);
      throw transportError("redirect_refused");
    }
    if (response.status === 408 || response.status === 429 || response.status >= 500) {
      await response.body?.cancel().catch(() => undefined);
      throw transportError("remote_unavailable", true);
    }
    if (response.status < 200 || response.status >= 300) {
      await response.body?.cancel().catch(() => undefined);
      throw transportError("remote_rejected");
    }
    const text = await readBoundedResponse(response, limits.maxResponseBytes);
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      throw transportError("invalid_acknowledgement");
    }
    const acknowledgement = validateAcknowledgement(parsed, envelope);
    await runtime.repository.finishDelivery({
      deliveryId: delivery.id,
      linkId: link.id,
      direction: "outbound",
      eventType: delivery.eventType,
      idempotencyKey: delivery.idempotencyKey,
      payloadHash,
      outcome: acknowledgement.status === "duplicate" ? "duplicate" : "completed",
      errorCode: null,
      occurredAt,
      chronicleEventType: acknowledgement.status === "duplicate"
        ? "federation.delivery.duplicate"
        : "federation.delivery.completed",
    });
    return { ...acknowledgement, statusCode: response.status };
  } catch (error: unknown) {
    const normalized = asTransportError(error);
    await recordOutboundFailure(runtime, delivery, normalized, occurredAt);
    throw normalized;
  }
}

function parseRawEnvelope(bytes: Uint8Array, maximumBytes: number): FederationEnvelope {
  if (bytes.byteLength < 1 || bytes.byteLength > maximumBytes) {
    throw transportError(bytes.byteLength > maximumBytes ? "request_too_large" : "invalid_request");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes)) as unknown;
  } catch {
    throw transportError("invalid_request");
  }
  return validateEnvelope(parsed);
}

export async function receiveFederationDelivery(
  request: FederationInboundRequest,
  runtime: FederationInboundRuntime,
): Promise<FederationInboundAcknowledgement> {
  if (!isUuid(runtime.localGuildId)) throw transportError("invalid_request");
  const limits = normalizeInboundLimits(runtime);
  const bytes = rawBytes(request.rawBody);
  const envelope = parseRawEnvelope(bytes, limits.maxRequestBytes);
  if (envelope.targetGuildId !== runtime.localGuildId) throw transportError("target_mismatch");
  const link = await runtime.repository.getLink(envelope.linkId);
  assertActiveLink(
    link,
    runtime.localGuildId,
    envelope.sourceGuildId,
    "inbound",
    envelope.eventType,
  );
  const secret = await resolveSecret(link.secretReference, runtime.resolveSecret);
  const suppliedSignature = parseSignature(request.signature);
  const expectedSignature = await hmac(secret, bytes);
  if (suppliedSignature === null || !constantTimeEqual(suppliedSignature, expectedSignature)) {
    throw transportError("signature_invalid");
  }
  const now = runtime.now?.() ?? new Date();
  if (Math.abs(now.valueOf() - Date.parse(envelope.issuedAt)) > limits.freshnessMs) {
    throw transportError("request_stale");
  }
  const payloadHash = await hashFederationPayload(envelope.payload);
  if (payloadHash !== envelope.payloadHash) throw transportError("payload_hash_mismatch");
  const authorization = await runtime.repository.authorizeInboundPayload({
    link,
    eventType: envelope.eventType,
    payload: envelope.payload,
  });
  assertAuthorized(authorization);
  // issuedAt and the HMAC change on a legitimate retry. The durable replay key binds only
  // immutable delivery identity and payload fields, while the HMAC still verifies every raw body.
  const envelopeHash = await envelopeFingerprint(envelope);
  const reservation = await runtime.repository.reserveInboundDelivery({ envelope, envelopeHash });
  if (reservation.state === "conflict") throw transportError("replay_conflict");
  if (reservation.state === "busy") throw transportError("delivery_in_progress", true);
  if (reservation.state === "duplicate") {
    await runtime.repository.finishDelivery({
      deliveryId: envelope.deliveryId,
      linkId: envelope.linkId,
      direction: "inbound",
      eventType: envelope.eventType,
      idempotencyKey: envelope.idempotencyKey,
      payloadHash: envelope.payloadHash,
      outcome: "duplicate",
      errorCode: null,
      occurredAt: now.toISOString(),
      chronicleEventType: "federation.delivery.duplicate",
    });
    return {
      deliveryId: envelope.deliveryId,
      idempotencyKey: envelope.idempotencyKey,
      payloadHash: envelope.payloadHash,
      status: "duplicate",
    };
  }
  try {
    await runtime.repository.applyInboundDelivery({ envelope });
  } catch {
    const error = transportError("repository_error", true);
    await runtime.repository.retryDelivery({
      deliveryId: envelope.deliveryId,
      linkId: envelope.linkId,
      direction: "inbound",
      eventType: envelope.eventType,
      idempotencyKey: envelope.idempotencyKey,
      payloadHash: envelope.payloadHash,
      errorCode: error.code,
      retryAt: retryAt(now, 0),
      occurredAt: now.toISOString(),
      chronicleEventType: "federation.delivery.retry_scheduled",
    });
    throw error;
  }
  await runtime.repository.finishDelivery({
    deliveryId: envelope.deliveryId,
    linkId: envelope.linkId,
    direction: "inbound",
    eventType: envelope.eventType,
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    outcome: "completed",
    errorCode: null,
    occurredAt: now.toISOString(),
    chronicleEventType: "federation.delivery.completed",
  });
  return {
    deliveryId: envelope.deliveryId,
    idempotencyKey: envelope.idempotencyKey,
    payloadHash: envelope.payloadHash,
    status: "accepted",
  };
}
