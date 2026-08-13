const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const DEFAULT_RESPONSE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_CAPABILITIES = 200;
const MAX_MCP_PAGES = 50;
const MAX_CAPABILITY_ID_LENGTH = 128;
const MAX_TITLE_LENGTH = 160;
const MAX_DESCRIPTION_LENGTH = 4_000;
const MAX_SCHEMA_BYTES = 32 * 1024;
const DEFAULT_MCP_PROTOCOL_VERSION = "2025-06-18";

export type ConnectionAdapterErrorCode =
  | "invalid_configuration"
  | "unsafe_endpoint"
  | "secret_unavailable"
  | "capability_not_allowed"
  | "capability_mismatch"
  | "duplicate_capability"
  | "invalid_request"
  | "invalid_response"
  | "redirect_refused"
  | "request_timeout"
  | "network_error"
  | "http_error"
  | "response_too_large"
  | "secret_exposure"
  | "upstream_rejected"
  | "unsupported_operation";

const ERROR_MESSAGES: Readonly<Record<ConnectionAdapterErrorCode, string>> = {
  invalid_configuration: "Connection configuration is invalid.",
  unsafe_endpoint: "Connection endpoint is not a permitted public HTTPS URL.",
  secret_unavailable: "Connection credential is unavailable.",
  capability_not_allowed: "This Connection does not allow the requested capability.",
  capability_mismatch: "Connection capabilities do not match the configured allowlist.",
  duplicate_capability: "Connection discovery returned duplicate capability identifiers.",
  invalid_request: "Connection request is invalid.",
  invalid_response: "Connection returned an invalid response.",
  redirect_refused: "Connection redirects are not permitted.",
  request_timeout: "Connection request timed out.",
  network_error: "Connection could not be reached.",
  http_error: "Connection returned an unsuccessful response.",
  response_too_large: "Connection response exceeded the allowed size.",
  secret_exposure: "Connection response contained protected credential material.",
  upstream_rejected: "Connection rejected the requested operation.",
  unsupported_operation: "This Connection does not support that operation.",
};

/** A stable, UI-safe error. It never includes URLs, response bodies, or credential values. */
export class ConnectionAdapterError extends Error {
  readonly code: ConnectionAdapterErrorCode;

  constructor(code: ConnectionAdapterErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "ConnectionAdapterError";
    this.code = code;
  }
}

export type ConnectionJsonObject = Readonly<Record<string, unknown>>;

export interface ConfiguredConnectionCapability {
  readonly id: string;
  readonly title?: string;
  readonly description?: string;
}

export type ConnectionCapabilitySource =
  | "mcp_tool"
  | "gatekeeper_action"
  | "webhook"
  | "service_action";

export interface DiscoveredConnectionCapability {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ConnectionJsonObject | null;
  readonly source: ConnectionCapabilitySource;
}

export interface OAuthDiscoveryMetadata {
  readonly issuer: string;
  readonly authorizationEndpoint: string;
  readonly tokenEndpoint: string;
  readonly jwksUri: string | null;
  readonly registrationEndpoint: string | null;
  readonly revocationEndpoint: string | null;
  readonly introspectionEndpoint: string | null;
  readonly scopesSupported: readonly string[];
  readonly responseTypesSupported: readonly string[];
  readonly grantTypesSupported: readonly string[];
  readonly codeChallengeMethodsSupported: readonly string[];
}

export interface ConnectionDiscoveryResult {
  readonly capabilities: readonly DiscoveredConnectionCapability[];
  readonly oauth: OAuthDiscoveryMetadata | null;
}

export interface ConnectionHealthResult {
  readonly status: "healthy" | "unhealthy";
  readonly code: "ok" | ConnectionAdapterErrorCode;
  readonly message: string;
  readonly checkedAt: string;
}

export interface ConnectionInvokeRequest {
  readonly capabilityId: string;
  readonly input: ConnectionJsonObject;
  readonly idempotencyKey?: string;
}

export interface ConnectionInvokeResult {
  readonly capabilityId: string;
  readonly statusCode: number;
  readonly output: unknown;
}

export type ConnectionAdapterKind =
  | "cloudflare_os_mcp"
  | "mcp_https"
  | "cloudflare_gatekeeper_https"
  | "https_webhook"
  | "oauth_metadata"
  | "cloudflare_service";

/** One contract is used by every purchaser-owned Connection transport. */
export interface ConnectionAdapter {
  readonly kind: ConnectionAdapterKind;
  health(): Promise<ConnectionHealthResult>;
  discover(): Promise<ConnectionDiscoveryResult>;
  invoke(request: ConnectionInvokeRequest): Promise<ConnectionInvokeResult>;
}

export interface ConnectionSecretHeader {
  readonly name: string;
  readonly secretReference: string;
  readonly format?: "raw" | "bearer";
}

export interface ConnectionAdapterLimits {
  readonly timeoutMs?: number;
  readonly maxResponseBytes?: number;
}

interface NetworkConnectionBase {
  readonly endpointUrl: string;
  readonly capabilities: readonly ConfiguredConnectionCapability[];
  readonly secretHeaders?: readonly ConnectionSecretHeader[];
  readonly limits?: ConnectionAdapterLimits;
}

export interface McpHttpsConnectionConfig extends NetworkConnectionBase {
  /** Standard MCP Streamable HTTP, including initialize, tools/list, and tools/call. */
  readonly kind: "cloudflare_os_mcp" | "mcp_https";
  readonly protocolVersion?: string;
}

export interface ActionEndpointRoutes {
  readonly health?: string;
  readonly discovery?: string;
  readonly invoke?: string;
}

export interface CloudflareGatekeeperHttpsConnectionConfig extends NetworkConnectionBase {
  /**
   * Purchaser bridge contract: GET health, GET discovery returning `{ actions: [...] }`, and
   * POST invoke accepting `{ capabilityId, input, idempotencyKey }`.
   */
  readonly kind: "cloudflare_gatekeeper_https";
  readonly routes?: ActionEndpointRoutes;
}

export interface HttpsWebhookConnectionConfig extends NetworkConnectionBase {
  /** A single immutable purchaser URL; invocation data can never select another destination. */
  readonly kind: "https_webhook";
  readonly healthMethod?: "HEAD" | "GET";
}

export interface OAuthMetadataConnectionConfig {
  /** RFC 8414 metadata discovery only. Token exchange is intentionally outside this adapter. */
  readonly kind: "oauth_metadata";
  readonly issuerUrl: string;
  readonly metadataUrl?: string;
  readonly secretHeaders?: readonly ConnectionSecretHeader[];
  readonly limits?: ConnectionAdapterLimits;
}

export interface CloudflareServiceConnectionConfig {
  /** The action bridge contract above, reached only through an injected Cloudflare Fetcher. */
  readonly kind: "cloudflare_service";
  readonly basePath?: string;
  readonly routes?: ActionEndpointRoutes;
  readonly capabilities: readonly ConfiguredConnectionCapability[];
  readonly secretHeaders?: readonly ConnectionSecretHeader[];
  readonly limits?: ConnectionAdapterLimits;
}

export type ConnectionAdapterConfig =
  | McpHttpsConnectionConfig
  | CloudflareGatekeeperHttpsConnectionConfig
  | HttpsWebhookConnectionConfig
  | OAuthMetadataConnectionConfig
  | CloudflareServiceConnectionConfig;

export type ConnectionFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

/** The subset of a Cloudflare Fetcher binding required by this module. */
export interface ConnectionFetcherBinding {
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
}

export type ConnectionSecretResolver = (
  secretReference: string,
) => string | null | undefined | Promise<string | null | undefined>;

export interface ConnectionAdapterRuntime {
  readonly fetch?: ConnectionFetch;
  readonly serviceBinding?: ConnectionFetcherBinding;
  readonly resolveSecret?: ConnectionSecretResolver;
  readonly now?: () => Date;
}

interface NormalizedLimits {
  readonly timeoutMs: number;
  readonly maxResponseBytes: number;
}

interface NormalizedCapability {
  readonly id: string;
  readonly title: string | null;
  readonly description: string | null;
}

interface AdapterContext {
  readonly fetcher: ConnectionFetch;
  readonly secretHeaders: readonly ConnectionSecretHeader[];
  readonly resolveSecret: ConnectionSecretResolver | undefined;
  readonly limits: NormalizedLimits;
  readonly now: () => Date;
}

interface GuardedResponse<T> {
  readonly value: T;
  readonly statusCode: number;
}

interface RemoteCapability {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: ConnectionJsonObject | null;
  readonly source: ConnectionCapabilitySource;
}

interface McpSession {
  requestId: number;
  sessionId: string | null;
}

function adapterError(code: ConnectionAdapterErrorCode): ConnectionAdapterError {
  return new ConnectionAdapterError(code);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function normalizeLimits(input: ConnectionAdapterLimits | undefined): NormalizedLimits {
  const timeoutMs = input?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes = input?.maxResponseBytes ?? DEFAULT_RESPONSE_BYTES;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS ||
      !Number.isSafeInteger(maxResponseBytes) || maxResponseBytes < 1 ||
      maxResponseBytes > MAX_RESPONSE_BYTES) {
    throw adapterError("invalid_configuration");
  }
  return { timeoutMs, maxResponseBytes };
}

function normalizeConfiguredCapabilities(
  values: readonly ConfiguredConnectionCapability[],
  allowEmpty = false,
): readonly NormalizedCapability[] {
  if (!Array.isArray(values) || values.length > MAX_CAPABILITIES || (!allowEmpty && values.length < 1)) {
    throw adapterError("invalid_configuration");
  }
  const seen = new Set<string>();
  return values.map((value) => {
    if (!isCapabilityId(value?.id) || seen.has(value.id) ||
        (value.title !== undefined && !isBoundedText(value.title, MAX_TITLE_LENGTH, 1)) ||
        (value.description !== undefined &&
          !isBoundedText(value.description, MAX_DESCRIPTION_LENGTH, 0))) {
      throw adapterError("invalid_configuration");
    }
    seen.add(value.id);
    return {
      id: value.id,
      title: value.title ?? null,
      description: value.description ?? null,
    };
  });
}

function isCapabilityId(value: unknown): value is string {
  return typeof value === "string" && value.length >= 1 &&
    value.length <= MAX_CAPABILITY_ID_LENGTH &&
    /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value);
}

function isBoundedText(value: unknown, maximum: number, minimum = 0): value is string {
  return typeof value === "string" && value.length >= minimum && value.length <= maximum &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value);
}

function isBlockedIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) return false;
  const octets = parts.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) return true;
  const [a, b, c] = octets;
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

function safeHttpsUrl(value: string, strictIssuer = false): URL {
  if (typeof value !== "string" || value.length < 1 || value.length > 2_048) {
    throw adapterError("unsafe_endpoint");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw adapterError("unsafe_endpoint");
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const blockedSuffixes = [".localhost", ".local", ".internal", ".home", ".lan", ".corp", ".arpa"];
  if (url.protocol !== "https:" || url.username || url.password || !hostname ||
      hostname.length > 253 || !hostname.includes(".") ||
      hostname === "localhost" || hostname === "metadata.google.internal" ||
      blockedSuffixes.some((suffix) => hostname.endsWith(suffix)) ||
      hostname.includes(":") || hostname.startsWith("[") || isBlockedIpv4(hostname) ||
      url.hash || (strictIssuer && (url.search || url.hash))) {
    throw adapterError("unsafe_endpoint");
  }
  return url;
}

function normalizeRoute(value: string | undefined, fallback: string): string {
  const route = value ?? fallback;
  if (!isBoundedText(route, 256, 1) || route.includes("\\") || route.includes("..") ||
      route.includes("?") || route.includes("#") || route.startsWith("//") ||
      /^[A-Za-z][A-Za-z0-9+.-]*:/.test(route)) {
    throw adapterError("invalid_configuration");
  }
  return route;
}

function resolveNetworkRoute(base: URL, route: string): URL {
  const normalizedBase = new URL(base.href);
  if (!normalizedBase.pathname.endsWith("/")) normalizedBase.pathname += "/";
  const resolved = safeHttpsUrl(new URL(route.replace(/^\//, ""), normalizedBase).href);
  if (resolved.origin !== base.origin) throw adapterError("unsafe_endpoint");
  return resolved;
}

function normalizeServicePath(basePath: string | undefined, route: string): URL {
  const base = basePath ?? "/";
  if (!base.startsWith("/") || base.includes("\\") || base.includes("..") ||
      base.includes("?") || base.includes("#") || base.length > 512) {
    throw adapterError("invalid_configuration");
  }
  const baseUrl = new URL(base.endsWith("/") ? base : `${base}/`, "https://guild-service.invalid");
  const resolved = new URL(route.replace(/^\//, ""), baseUrl);
  if (resolved.origin !== baseUrl.origin) throw adapterError("invalid_configuration");
  return resolved;
}

function normalizeSecretHeaders(
  values: readonly ConnectionSecretHeader[] | undefined,
): readonly ConnectionSecretHeader[] {
  const headers = values ?? [];
  if (!Array.isArray(headers) || headers.length > 8) throw adapterError("invalid_configuration");
  const forbidden = new Set([
    "accept", "connection", "content-length", "content-type", "cookie", "host",
    "idempotency-key", "mcp-protocol-version", "mcp-session-id", "transfer-encoding",
  ]);
  const seen = new Set<string>();
  return headers.map((header) => {
    const lowerName = header?.name?.toLowerCase();
    if (typeof lowerName !== "string" || !/^[!#$%&'*+.^_`|~0-9a-z-]{1,128}$/.test(lowerName) ||
        forbidden.has(lowerName) || seen.has(lowerName) ||
        typeof header.secretReference !== "string" ||
        !/^[A-Z][A-Z0-9_]{0,127}$/.test(header.secretReference) ||
        (header.format !== undefined && header.format !== "raw" && header.format !== "bearer")) {
      throw adapterError("invalid_configuration");
    }
    seen.add(lowerName);
    return {
      name: header.name,
      secretReference: header.secretReference,
      format: header.format ?? "raw",
    };
  });
}

async function resolveSecretHeaders(
  configured: readonly ConnectionSecretHeader[],
  resolver: ConnectionSecretResolver | undefined,
): Promise<{ headers: Headers; secretValues: readonly string[] }> {
  const headers = new Headers();
  const secretValues: string[] = [];
  for (const header of configured) {
    if (!resolver) throw adapterError("secret_unavailable");
    let value: string | null | undefined;
    try {
      value = await resolver(header.secretReference);
    } catch {
      throw adapterError("secret_unavailable");
    }
    if (typeof value !== "string" || value.length < 1 || value.length > 16_384 ||
        /[\r\n\u0000]/.test(value)) {
      throw adapterError("secret_unavailable");
    }
    secretValues.push(value);
    headers.set(header.name, header.format === "bearer" ? `Bearer ${value}` : value);
  }
  return { headers, secretValues };
}

function serializedBody(value: unknown): string {
  let body: string | undefined;
  try {
    body = JSON.stringify(value);
  } catch {
    throw adapterError("invalid_request");
  }
  if (body === undefined || utf8Bytes(body) > MAX_REQUEST_BYTES) {
    throw adapterError("invalid_request");
  }
  return body;
}

function normalizeInvokeRequest(
  request: ConnectionInvokeRequest,
  capabilities: readonly NormalizedCapability[],
): ConnectionInvokeRequest {
  if (!isCapabilityId(request?.capabilityId) ||
      !capabilities.some((capability) => capability.id === request.capabilityId) ||
      !isRecord(request.input) ||
      (request.idempotencyKey !== undefined &&
        !isBoundedText(request.idempotencyKey, 256, 1))) {
    if (isCapabilityId(request?.capabilityId) &&
        !capabilities.some((capability) => capability.id === request.capabilityId)) {
      throw adapterError("capability_not_allowed");
    }
    throw adapterError("invalid_request");
  }
  serializedBody(request.input);
  return request;
}

function mergeHeaders(base: HeadersInit | undefined, secrets: Headers): Headers {
  const headers = new Headers(base);
  secrets.forEach((value, name) => {
    if (headers.has(name)) throw adapterError("invalid_configuration");
    headers.set(name, value);
  });
  return headers;
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Cancellation is best-effort after the response has already been rejected or ignored.
  }
}

async function readBoundedText(
  response: Response,
  maximumBytes: number,
  secretValues: readonly string[],
): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    await cancelBody(response);
    throw adapterError("response_too_large");
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
        break;
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw adapterError("response_too_large");
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  if (secretValues.some((secret) => text.includes(secret))) {
    throw adapterError("secret_exposure");
  }
  return text;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw adapterError("invalid_response");
  }
}

async function withTimeout<T>(
  timeoutMs: number,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(adapterError("request_timeout"));
    }, timeoutMs);
  });
  const guarded = operation(controller.signal).catch((error: unknown) => {
    if (error instanceof ConnectionAdapterError) throw error;
    if (timedOut || controller.signal.aborted) throw adapterError("request_timeout");
    throw adapterError("network_error");
  });
  try {
    return await Promise.race([guarded, timeout]);
  } finally {
    if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
  }
}

async function guardedRequest<T>(
  context: AdapterContext,
  url: URL,
  init: RequestInit,
  consume: (response: Response, secretValues: readonly string[]) => Promise<T>,
): Promise<GuardedResponse<T>> {
  return withTimeout(context.limits.timeoutMs, async (signal) => {
    const resolved = await resolveSecretHeaders(context.secretHeaders, context.resolveSecret);
    const response = await context.fetcher(url, {
      ...init,
      headers: mergeHeaders(init.headers, resolved.headers),
      redirect: "manual",
      signal,
    });
    if (response.redirected || (response.status >= 300 && response.status < 400) ||
        response.status === 0) {
      await cancelBody(response);
      throw adapterError("redirect_refused");
    }
    if (!response.ok) {
      await cancelBody(response);
      throw adapterError("http_error");
    }
    return {
      value: await consume(response, resolved.secretValues),
      statusCode: response.status,
    };
  });
}

async function requestNoBody(
  context: AdapterContext,
  url: URL,
  init: RequestInit,
): Promise<number> {
  const response = await guardedRequest(context, url, init, async (result) => {
    await cancelBody(result);
    return null;
  });
  return response.statusCode;
}

async function requestJson(
  context: AdapterContext,
  url: URL,
  init: RequestInit,
): Promise<GuardedResponse<unknown>> {
  return guardedRequest(context, url, init, async (response, secrets) => {
    const text = await readBoundedText(response, context.limits.maxResponseBytes, secrets);
    if (!text) throw adapterError("invalid_response");
    return parseJson(text);
  });
}

async function requestOutput(
  context: AdapterContext,
  url: URL,
  init: RequestInit,
): Promise<GuardedResponse<unknown>> {
  return guardedRequest(context, url, init, async (response, secrets) => {
    const text = await readBoundedText(response, context.limits.maxResponseBytes, secrets);
    if (!text) return null;
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    return contentType.includes("json") ? parseJson(text) : text;
  });
}

function validatedRemoteCapability(
  value: unknown,
  source: ConnectionCapabilitySource,
  idProperty: "id" | "name",
): RemoteCapability {
  if (!isRecord(value)) throw adapterError("invalid_response");
  const id = value[idProperty];
  const title = value.title;
  const description = value.description;
  const inputSchema = value.inputSchema;
  if (!isCapabilityId(id) ||
      (title !== undefined && !isBoundedText(title, MAX_TITLE_LENGTH, 1)) ||
      (description !== undefined && !isBoundedText(description, MAX_DESCRIPTION_LENGTH, 0)) ||
      (inputSchema !== undefined && !isRecord(inputSchema))) {
    throw adapterError("invalid_response");
  }
  if (inputSchema !== undefined && utf8Bytes(serializedBody(inputSchema)) > MAX_SCHEMA_BYTES) {
    throw adapterError("invalid_response");
  }
  return {
    id,
    title: title ?? id,
    description: description ?? "",
    inputSchema: inputSchema ?? null,
    source,
  };
}

function filterDiscoveredCapabilities(
  remote: readonly RemoteCapability[],
  configured: readonly NormalizedCapability[],
): readonly DiscoveredConnectionCapability[] {
  if (remote.length > MAX_CAPABILITIES) throw adapterError("invalid_response");
  const byId = new Map<string, RemoteCapability>();
  for (const capability of remote) {
    if (byId.has(capability.id)) throw adapterError("duplicate_capability");
    byId.set(capability.id, capability);
  }
  return configured.map((grant) => {
    const capability = byId.get(grant.id);
    if (!capability) throw adapterError("capability_mismatch");
    return {
      id: grant.id,
      title: grant.title ?? capability.title,
      description: grant.description ?? capability.description,
      inputSchema: capability.inputSchema,
      source: capability.source,
    };
  });
}

function parseActionCatalog(
  value: unknown,
  configured: readonly NormalizedCapability[],
  source: "gatekeeper_action" | "service_action",
): readonly DiscoveredConnectionCapability[] {
  if (!isRecord(value) || !Array.isArray(value.actions)) {
    throw adapterError("invalid_response");
  }
  const remote = value.actions.map((action) =>
    validatedRemoteCapability(action, source, "id"));
  return filterDiscoveredCapabilities(remote, configured);
}

function checkedAt(now: () => Date): string {
  let date: Date;
  try {
    date = now();
  } catch {
    date = new Date(0);
  }
  return Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString();
}

async function healthResult(
  check: () => Promise<unknown>,
  now: () => Date,
): Promise<ConnectionHealthResult> {
  try {
    await check();
    return {
      status: "healthy",
      code: "ok",
      message: "Connection is healthy.",
      checkedAt: checkedAt(now),
    };
  } catch (error) {
    const safe = error instanceof ConnectionAdapterError
      ? error
      : adapterError("network_error");
    return {
      status: "unhealthy",
      code: safe.code,
      message: safe.message,
      checkedAt: checkedAt(now),
    };
  }
}

function createNetworkContext(
  secretHeaders: readonly ConnectionSecretHeader[] | undefined,
  limits: ConnectionAdapterLimits | undefined,
  runtime: ConnectionAdapterRuntime,
): AdapterContext {
  const fetcher = runtime.fetch ?? ((input, init) => globalThis.fetch(input, init));
  return {
    fetcher,
    secretHeaders: normalizeSecretHeaders(secretHeaders),
    resolveSecret: runtime.resolveSecret,
    limits: normalizeLimits(limits),
    now: runtime.now ?? (() => new Date()),
  };
}

function createServiceContext(
  config: CloudflareServiceConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): AdapterContext {
  if (!runtime.serviceBinding) throw adapterError("invalid_configuration");
  const binding = runtime.serviceBinding;
  return {
    fetcher: (input, init) => binding.fetch(input, init),
    secretHeaders: normalizeSecretHeaders(config.secretHeaders),
    resolveSecret: runtime.resolveSecret,
    limits: normalizeLimits(config.limits),
    now: runtime.now ?? (() => new Date()),
  };
}

function validateRpcEnvelope(value: unknown, requestId: number): Record<string, unknown> {
  if (!isRecord(value) || value.jsonrpc !== "2.0" || value.id !== requestId ||
      (Object.hasOwn(value, "result") === Object.hasOwn(value, "error"))) {
    throw adapterError("invalid_response");
  }
  if (Object.hasOwn(value, "error")) throw adapterError("upstream_rejected");
  return value;
}

async function readSseRpcEnvelope(
  response: Response,
  maximumBytes: number,
  secretValues: readonly string[],
  requestId: number,
): Promise<Record<string, unknown>> {
  if (!response.body) throw adapterError("invalid_response");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let buffered = "";
  const consume = (): Record<string, unknown> | null => {
    for (;;) {
      const boundary = /\r?\n\r?\n/.exec(buffered);
      if (!boundary) return null;
      const block = buffered.slice(0, boundary.index);
      buffered = buffered.slice(boundary.index + boundary[0].length);
      const data = block.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart())
        .join("\n");
      if (!data) continue;
      if (secretValues.some((secret) => data.includes(secret))) {
        throw adapterError("secret_exposure");
      }
      const parsed = parseJson(data);
      if (!isRecord(parsed)) throw adapterError("invalid_response");
      if (parsed.id === requestId) return validateRpcEnvelope(parsed, requestId);
    }
  };
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        buffered += `${decoder.decode()}\n\n`;
        const envelope = consume();
        if (envelope) return envelope;
        throw adapterError("invalid_response");
      }
      total += value.byteLength;
      if (total > maximumBytes) {
        await reader.cancel().catch(() => undefined);
        throw adapterError("response_too_large");
      }
      buffered += decoder.decode(value, { stream: true });
      const envelope = consume();
      if (envelope) {
        await reader.cancel().catch(() => undefined);
        return envelope;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

async function mcpRpc(
  context: AdapterContext,
  endpoint: URL,
  session: McpSession,
  protocolVersion: string,
  method: string,
  params: ConnectionJsonObject,
): Promise<unknown> {
  const requestId = ++session.requestId;
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  });
  if (session.sessionId) headers.set("mcp-session-id", session.sessionId);
  const result = await guardedRequest(context, endpoint, {
    method: "POST",
    headers,
    body: serializedBody({ jsonrpc: "2.0", id: requestId, method, params }),
  }, async (response, secrets) => {
    const returnedSession = response.headers.get("mcp-session-id");
    if (returnedSession !== null) {
      if (!isBoundedText(returnedSession, 256, 1) || /\s/.test(returnedSession)) {
        throw adapterError("invalid_response");
      }
      session.sessionId = returnedSession;
    }
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    const envelope = contentType.includes("text/event-stream")
      ? await readSseRpcEnvelope(response, context.limits.maxResponseBytes, secrets, requestId)
      : validateRpcEnvelope(parseJson(await readBoundedText(
        response, context.limits.maxResponseBytes, secrets)), requestId);
    return envelope.result;
  });
  return result.value;
}

async function initializeMcp(
  context: AdapterContext,
  endpoint: URL,
  protocolVersion: string,
): Promise<McpSession> {
  const session: McpSession = { requestId: 0, sessionId: null };
  const initialized = await mcpRpc(context, endpoint, session, protocolVersion, "initialize", {
    protocolVersion,
    capabilities: {},
    clientInfo: { name: "Guild OS", version: "1.0.0" },
  });
  if (!isRecord(initialized) || initialized.protocolVersion !== protocolVersion ||
      !isRecord(initialized.serverInfo) ||
      !isBoundedText(initialized.serverInfo.name, MAX_TITLE_LENGTH, 1) ||
      !isBoundedText(initialized.serverInfo.version, 100, 1) ||
      !isRecord(initialized.capabilities) || !isRecord(initialized.capabilities.tools)) {
    throw adapterError("invalid_response");
  }
  const headers = new Headers({
    accept: "application/json, text/event-stream",
    "content-type": "application/json",
    "mcp-protocol-version": protocolVersion,
  });
  if (session.sessionId) headers.set("mcp-session-id", session.sessionId);
  await requestNoBody(context, endpoint, {
    method: "POST",
    headers,
    body: serializedBody({ jsonrpc: "2.0", method: "notifications/initialized" }),
  });
  return session;
}

async function listMcpCapabilities(
  context: AdapterContext,
  endpoint: URL,
  session: McpSession,
  protocolVersion: string,
  configured: readonly NormalizedCapability[],
): Promise<readonly DiscoveredConnectionCapability[]> {
  const remote: RemoteCapability[] = [];
  const cursors = new Set<string>();
  let cursor: string | null = null;
  for (let page = 0; page < MAX_MCP_PAGES; page++) {
    const result = await mcpRpc(
      context,
      endpoint,
      session,
      protocolVersion,
      "tools/list",
      cursor === null ? {} : { cursor },
    );
    if (!isRecord(result) || !Array.isArray(result.tools) ||
        (result.nextCursor !== undefined &&
          !isBoundedText(result.nextCursor, 512, 1))) {
      throw adapterError("invalid_response");
    }
    for (const tool of result.tools) {
      remote.push(validatedRemoteCapability(tool, "mcp_tool", "name"));
      if (remote.length > MAX_CAPABILITIES) throw adapterError("invalid_response");
    }
    if (result.nextCursor === undefined) {
      return filterDiscoveredCapabilities(remote, configured);
    }
    cursor = result.nextCursor;
    if (cursors.has(cursor)) throw adapterError("invalid_response");
    cursors.add(cursor);
  }
  throw adapterError("invalid_response");
}

function createMcpAdapter(
  config: McpHttpsConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): ConnectionAdapter {
  const endpoint = safeHttpsUrl(config.endpointUrl);
  const configured = normalizeConfiguredCapabilities(config.capabilities);
  const context = createNetworkContext(config.secretHeaders, config.limits, runtime);
  const protocolVersion = config.protocolVersion ?? DEFAULT_MCP_PROTOCOL_VERSION;
  if (!isBoundedText(protocolVersion, 64, 1) || !/^\d{4}-\d{2}-\d{2}$/.test(protocolVersion)) {
    throw adapterError("invalid_configuration");
  }
  const discover = async (): Promise<ConnectionDiscoveryResult> => {
    const session = await initializeMcp(context, endpoint, protocolVersion);
    return {
      capabilities: await listMcpCapabilities(
        context, endpoint, session, protocolVersion, configured),
      oauth: null,
    };
  };
  return {
    kind: config.kind,
    health: () => healthResult(discover, context.now),
    discover,
    invoke: async (input) => {
      const request = normalizeInvokeRequest(input, configured);
      const session = await initializeMcp(context, endpoint, protocolVersion);
      await listMcpCapabilities(context, endpoint, session, protocolVersion, configured);
      const result = await mcpRpc(context, endpoint, session, protocolVersion, "tools/call", {
        name: request.capabilityId,
        arguments: request.input,
      });
      if (!isRecord(result) || (result.isError !== undefined && typeof result.isError !== "boolean")) {
        throw adapterError("invalid_response");
      }
      if (result.isError === true) throw adapterError("upstream_rejected");
      return { capabilityId: request.capabilityId, statusCode: 200, output: result };
    },
  };
}

function actionRoutes(input: ActionEndpointRoutes | undefined): Required<ActionEndpointRoutes> {
  return {
    health: normalizeRoute(input?.health, "health"),
    discovery: normalizeRoute(input?.discovery, "capabilities"),
    invoke: normalizeRoute(input?.invoke, "invoke"),
  };
}

function createActionEndpointAdapter(
  kind: "cloudflare_gatekeeper_https" | "cloudflare_service",
  configured: readonly NormalizedCapability[],
  context: AdapterContext,
  urls: Readonly<{ health: URL; discovery: URL; invoke: URL }>,
): ConnectionAdapter {
  const source = kind === "cloudflare_service" ? "service_action" : "gatekeeper_action";
  const discover = async (): Promise<ConnectionDiscoveryResult> => {
    const response = await requestJson(context, urls.discovery, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return {
      capabilities: parseActionCatalog(response.value, configured, source),
      oauth: null,
    };
  };
  return {
    kind,
    health: () => healthResult(() => requestNoBody(context, urls.health, {
      method: "GET",
      headers: { accept: "application/json" },
    }), context.now),
    discover,
    invoke: async (input) => {
      const request = normalizeInvokeRequest(input, configured);
      await discover();
      const response = await requestOutput(context, urls.invoke, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(request.idempotencyKey
            ? { "idempotency-key": request.idempotencyKey }
            : {}),
        },
        body: serializedBody({
          capabilityId: request.capabilityId,
          input: request.input,
          idempotencyKey: request.idempotencyKey ?? null,
        }),
      });
      return {
        capabilityId: request.capabilityId,
        statusCode: response.statusCode,
        output: response.value,
      };
    },
  };
}

function createGatekeeperHttpsAdapter(
  config: CloudflareGatekeeperHttpsConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): ConnectionAdapter {
  const base = safeHttpsUrl(config.endpointUrl);
  const configured = normalizeConfiguredCapabilities(config.capabilities);
  const context = createNetworkContext(config.secretHeaders, config.limits, runtime);
  const routes = actionRoutes(config.routes);
  return createActionEndpointAdapter("cloudflare_gatekeeper_https", configured, context, {
    health: resolveNetworkRoute(base, routes.health),
    discovery: resolveNetworkRoute(base, routes.discovery),
    invoke: resolveNetworkRoute(base, routes.invoke),
  });
}

function createWebhookAdapter(
  config: HttpsWebhookConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): ConnectionAdapter {
  const endpoint = safeHttpsUrl(config.endpointUrl);
  const configured = normalizeConfiguredCapabilities(config.capabilities);
  const context = createNetworkContext(config.secretHeaders, config.limits, runtime);
  if (config.healthMethod !== undefined && config.healthMethod !== "HEAD" &&
      config.healthMethod !== "GET") {
    throw adapterError("invalid_configuration");
  }
  const capabilities: readonly DiscoveredConnectionCapability[] = configured.map((capability) => ({
    id: capability.id,
    title: capability.title ?? capability.id,
    description: capability.description ?? "",
    inputSchema: null,
    source: "webhook",
  }));
  return {
    kind: config.kind,
    health: () => healthResult(() => requestNoBody(context, endpoint, {
      method: config.healthMethod ?? "HEAD",
    }), context.now),
    discover: async () => ({ capabilities, oauth: null }),
    invoke: async (input) => {
      const request = normalizeInvokeRequest(input, configured);
      const response = await requestOutput(context, endpoint, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(request.idempotencyKey
            ? { "idempotency-key": request.idempotencyKey }
            : {}),
        },
        body: serializedBody({
          capabilityId: request.capabilityId,
          input: request.input,
          idempotencyKey: request.idempotencyKey ?? null,
        }),
      });
      return {
        capabilityId: request.capabilityId,
        statusCode: response.statusCode,
        output: response.value,
      };
    },
  };
}

function oauthMetadataUrl(config: OAuthMetadataConnectionConfig): { issuer: URL; metadata: URL } {
  const issuer = safeHttpsUrl(config.issuerUrl, true);
  if (issuer.pathname.length > 1 && issuer.pathname.endsWith("/")) {
    issuer.pathname = issuer.pathname.slice(0, -1);
  }
  if (config.metadataUrl) return { issuer, metadata: safeHttpsUrl(config.metadataUrl) };
  const suffix = issuer.pathname === "/" ? "" : issuer.pathname;
  return {
    issuer,
    metadata: safeHttpsUrl(
      `${issuer.origin}/.well-known/oauth-authorization-server${suffix}`),
  };
}

function stringArray(value: unknown, required = false): readonly string[] {
  if (value === undefined && !required) return [];
  if (!Array.isArray(value) || value.length > 256 ||
      value.some((item) => !isBoundedText(item, 256, 1)) ||
      new Set(value).size !== value.length) {
    throw adapterError("invalid_response");
  }
  return value;
}

function optionalMetadataEndpoint(value: unknown): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string") throw adapterError("invalid_response");
  return safeHttpsUrl(value).href;
}

function parseOAuthMetadata(value: unknown, expectedIssuer: URL): OAuthDiscoveryMetadata {
  if (!isRecord(value) || typeof value.issuer !== "string" ||
      typeof value.authorization_endpoint !== "string" ||
      typeof value.token_endpoint !== "string") {
    throw adapterError("invalid_response");
  }
  const issuer = safeHttpsUrl(value.issuer, true);
  if (issuer.href.replace(/\/$/, "") !== expectedIssuer.href.replace(/\/$/, "")) {
    throw adapterError("invalid_response");
  }
  return {
    issuer: issuer.href,
    authorizationEndpoint: safeHttpsUrl(value.authorization_endpoint).href,
    tokenEndpoint: safeHttpsUrl(value.token_endpoint).href,
    jwksUri: optionalMetadataEndpoint(value.jwks_uri),
    registrationEndpoint: optionalMetadataEndpoint(value.registration_endpoint),
    revocationEndpoint: optionalMetadataEndpoint(value.revocation_endpoint),
    introspectionEndpoint: optionalMetadataEndpoint(value.introspection_endpoint),
    scopesSupported: stringArray(value.scopes_supported),
    responseTypesSupported: stringArray(value.response_types_supported, true),
    grantTypesSupported: stringArray(value.grant_types_supported),
    codeChallengeMethodsSupported: stringArray(value.code_challenge_methods_supported),
  };
}

function createOAuthMetadataAdapter(
  config: OAuthMetadataConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): ConnectionAdapter {
  const urls = oauthMetadataUrl(config);
  const context = createNetworkContext(config.secretHeaders, config.limits, runtime);
  const discover = async (): Promise<ConnectionDiscoveryResult> => {
    const response = await requestJson(context, urls.metadata, {
      method: "GET",
      headers: { accept: "application/json" },
    });
    return { capabilities: [], oauth: parseOAuthMetadata(response.value, urls.issuer) };
  };
  return {
    kind: config.kind,
    health: () => healthResult(discover, context.now),
    discover,
    invoke: async () => {
      throw adapterError("unsupported_operation");
    },
  };
}

function createCloudflareServiceAdapter(
  config: CloudflareServiceConnectionConfig,
  runtime: ConnectionAdapterRuntime,
): ConnectionAdapter {
  const configured = normalizeConfiguredCapabilities(config.capabilities);
  const context = createServiceContext(config, runtime);
  const routes = actionRoutes(config.routes);
  return createActionEndpointAdapter("cloudflare_service", configured, context, {
    health: normalizeServicePath(config.basePath, routes.health),
    discovery: normalizeServicePath(config.basePath, routes.discovery),
    invoke: normalizeServicePath(config.basePath, routes.invoke),
  });
}

/** Creates a fail-closed adapter without retaining any resolved credential value. */
export function createConnectionAdapter(
  config: ConnectionAdapterConfig,
  runtime: ConnectionAdapterRuntime = {},
): ConnectionAdapter {
  switch (config.kind) {
    case "cloudflare_os_mcp":
    case "mcp_https":
      return createMcpAdapter(config, runtime);
    case "cloudflare_gatekeeper_https":
      return createGatekeeperHttpsAdapter(config, runtime);
    case "https_webhook":
      return createWebhookAdapter(config, runtime);
    case "oauth_metadata":
      return createOAuthMetadataAdapter(config, runtime);
    case "cloudflare_service":
      return createCloudflareServiceAdapter(config, runtime);
  }
}
