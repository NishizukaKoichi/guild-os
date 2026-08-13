import type { Connector, JsonObject } from "@guild-os/domain";
import type { GuildEnv } from "./config.js";
import {
  ConnectionAdapterError,
  createConnectionAdapter,
  type ActionEndpointRoutes,
  type ConfiguredConnectionCapability,
  type ConnectionAdapter,
  type ConnectionAdapterConfig,
  type ConnectionFetcherBinding,
  type ConnectionSecretHeader,
} from "./connection-adapters.js";

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Readonly<Record<string, unknown>>
    : null;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function capabilities(configuration: JsonObject | undefined): readonly ConfiguredConnectionCapability[] {
  const values = record(configuration)?.allowedCapabilities;
  if (!Array.isArray(values)) return [];
  return values.map((value) => {
    if (typeof value === "string") return { id: value };
    const item = record(value);
    if (!item || typeof item.id !== "string") throw new ConnectionAdapterError("invalid_configuration");
    return {
      id: item.id,
      ...(typeof item.title === "string" ? { title: item.title } : {}),
      ...(typeof item.description === "string" ? { description: item.description } : {}),
    };
  });
}

function routes(configuration: JsonObject | undefined): ActionEndpointRoutes | undefined {
  const value = record(record(configuration)?.routes);
  if (!value) return undefined;
  return {
    ...(optionalString(value.health) ? { health: optionalString(value.health) } : {}),
    ...(optionalString(value.discovery) ? { discovery: optionalString(value.discovery) } : {}),
    ...(optionalString(value.invoke) ? { invoke: optionalString(value.invoke) } : {}),
  };
}

function secretHeaders(connection: Connector): readonly ConnectionSecretHeader[] {
  if (!connection.secretReference) return [];
  const configuration = record(connection.configuration);
  return [{
    name: optionalString(configuration?.secretHeaderName) ?? "Authorization",
    secretReference: connection.secretReference,
    format: configuration?.secretFormat === "raw" ? "raw" : "bearer",
  }];
}

function requireEndpoint(connection: Connector): string {
  if (!connection.endpointUrl) throw new ConnectionAdapterError("invalid_configuration");
  return connection.endpointUrl;
}

function requireCapabilities(connection: Connector): readonly ConfiguredConnectionCapability[] {
  const values = capabilities(connection.configuration);
  if (values.length === 0) throw new ConnectionAdapterError("invalid_configuration");
  return values;
}

function connectionConfig(connection: Connector): ConnectionAdapterConfig {
  const configuredCapabilities = capabilities(connection.configuration);
  const configuration = record(connection.configuration);
  switch (connection.kind) {
    case "mcp":
      return {
        kind: configuration?.adapterKind === "cloudflare_os_mcp"
          ? "cloudflare_os_mcp"
          : "mcp_https",
        endpointUrl: requireEndpoint(connection),
        capabilities: requireCapabilities(connection),
        secretHeaders: secretHeaders(connection),
        ...(optionalString(configuration?.protocolVersion)
          ? { protocolVersion: optionalString(configuration?.protocolVersion) }
          : {}),
      };
    case "api":
      return {
        kind: "cloudflare_gatekeeper_https",
        endpointUrl: requireEndpoint(connection),
        capabilities: requireCapabilities(connection),
        secretHeaders: secretHeaders(connection),
        routes: routes(connection.configuration),
      };
    case "https_webhook":
    case "webhook":
      return {
        kind: "https_webhook",
        endpointUrl: requireEndpoint(connection),
        capabilities: configuredCapabilities.length > 0
          ? configuredCapabilities
          : [{ id: "webhook.send", title: connection.name }],
        secretHeaders: secretHeaders(connection),
        healthMethod: configuration?.healthMethod === "GET" ? "GET" : "HEAD",
      };
    case "oauth":
      return {
        kind: "oauth_metadata",
        issuerUrl: requireEndpoint(connection),
        ...(optionalString(configuration?.metadataUrl)
          ? { metadataUrl: optionalString(configuration?.metadataUrl) }
          : {}),
        secretHeaders: secretHeaders(connection),
      };
    case "cloudflare_service":
      return {
        kind: "cloudflare_service",
        basePath: optionalString(configuration?.basePath),
        routes: routes(connection.configuration),
        capabilities: requireCapabilities(connection),
        secretHeaders: secretHeaders(connection),
      };
    case "database":
    case "storage":
      throw new ConnectionAdapterError("unsupported_operation");
  }
}

function environmentBinding(env: GuildEnv, reference: string): unknown {
  return (env as unknown as Readonly<Record<string, unknown>>)[reference];
}

function serviceBinding(env: GuildEnv, connection: Connector): ConnectionFetcherBinding | undefined {
  if (connection.kind !== "cloudflare_service") return undefined;
  const reference = optionalString(record(connection.configuration)?.bindingReference);
  if (!reference) throw new ConnectionAdapterError("invalid_configuration");
  const binding = environmentBinding(env, reference);
  if (!binding || typeof binding !== "object" || !("fetch" in binding) ||
      typeof (binding as { fetch?: unknown }).fetch !== "function") {
    throw new ConnectionAdapterError("secret_unavailable");
  }
  return binding as ConnectionFetcherBinding;
}

/**
 * Builds a fail-closed purchaser-owned Connection adapter. Secret and Service bindings are
 * resolved lazily from the deployment environment and are never retained in the Connector row.
 */
export function createConfiguredConnectionAdapter(
  env: GuildEnv,
  connection: Connector,
): ConnectionAdapter {
  if (connection.status !== "active") throw new ConnectionAdapterError("capability_not_allowed");
  return createConnectionAdapter(connectionConfig(connection), {
    serviceBinding: serviceBinding(env, connection),
    resolveSecret: (reference) => {
      const value = environmentBinding(env, reference);
      return typeof value === "string" && value.length > 0 ? value : null;
    },
  });
}
