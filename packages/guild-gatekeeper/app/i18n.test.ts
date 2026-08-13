/// <reference types="node" />

import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";
import { I18nProvider, type TranslationKey, useI18n } from "./i18n";
import { LOCALE_STORAGE_KEY, readInitialLocale } from "./locale-storage";

const APP_DIRECTORY = dirname(fileURLToPath(import.meta.url));
const I18N_PATH = join(APP_DIRECTORY, "i18n.tsx");
const OPERATIONS_PAGE_PATH = join(APP_DIRECTORY, "pages", "OperationsPage.tsx");
const I18N_SOURCE = readFileSync(I18N_PATH, "utf8");
const I18N_AST = ts.createSourceFile(
  I18N_PATH,
  I18N_SOURCE,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

interface ParsedDictionary {
  values: ReadonlyMap<string, string>;
  duplicates: readonly string[];
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  if (
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression) ||
    ts.isParenthesizedExpression(expression) ||
    ts.isTypeAssertionExpression(expression)
  ) {
    return unwrapExpression(expression.expression);
  }
  return expression;
}

function propertyName(property: ts.PropertyName): string | null {
  if (ts.isStringLiteralLike(property) || ts.isIdentifier(property) || ts.isNumericLiteral(property)) {
    return property.text;
  }
  return null;
}

const dictionaryDeclarations = new Map<string, ts.VariableDeclaration>();
I18N_AST.forEachChild(function visit(node): void {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    dictionaryDeclarations.set(node.name.text, node);
  }
  ts.forEachChild(node, visit);
});

function parseDictionary(
  variableName: string,
  resolving: ReadonlySet<string> = new Set(),
): ParsedDictionary {
  const declaration = dictionaryDeclarations.get(variableName);
  if (resolving.has(variableName)) {
    throw new Error(`Dictionary spread cycle detected at ${variableName}`);
  }
  if (!declaration?.initializer) {
    throw new Error(`Dictionary ${variableName} was not found in ${I18N_PATH}`);
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(`Dictionary ${variableName} must be an object literal`);
  }

  const values = new Map<string, string>();
  const duplicates: string[] = [];
  const nextResolving = new Set(resolving).add(variableName);

  function add(key: string, value: string): void {
    if (values.has(key)) duplicates.push(key);
    values.set(key, value);
  }

  for (const property of initializer.properties) {
    if (
      ts.isSpreadAssignment(property) &&
      ts.isIdentifier(unwrapExpression(property.expression))
    ) {
      const spreadName = (unwrapExpression(property.expression) as ts.Identifier).text;
      const spread = parseDictionary(spreadName, nextResolving);
      duplicates.push(...spread.duplicates);
      for (const [key, value] of spread.values) add(key, value);
      continue;
    }
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Dictionary ${variableName} may only contain explicit properties or named dictionary spreads`);
    }
    const key = propertyName(property.name);
    const value = unwrapExpression(property.initializer);
    if (key === null || !ts.isStringLiteralLike(value)) {
      throw new Error(`Dictionary ${variableName} contains a non-literal entry`);
    }
    add(key, value.text);
  }
  return { values, duplicates };
}

const dictionaries = {
  en: parseDictionary("english"),
  ja: parseDictionary("japanese"),
  "zh-CN": parseDictionary("simplifiedChinese"),
} as const;

function appSourceFiles(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return appSourceFiles(path);
    if (!/\.tsx?$/.test(entry.name) || entry.name.endsWith(".test.ts") || entry.name.endsWith(".test.tsx")) {
      return [];
    }
    return [path];
  });
}

function collectTranslationArgument(
  expression: ts.Expression,
  literal: Set<string>,
  patterns: Set<string>,
): boolean {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value)) {
    literal.add(value.text);
    return true;
  }
  if (ts.isConditionalExpression(value)) {
    const whenTrueResolved = collectTranslationArgument(value.whenTrue, literal, patterns);
    const whenFalseResolved = collectTranslationArgument(value.whenFalse, literal, patterns);
    return whenTrueResolved && whenFalseResolved;
  }
  if (ts.isTemplateExpression(value)) {
    patterns.add(templatePattern(value));
    return true;
  }
  return false;
}

function templatePattern(expression: ts.TemplateExpression): string {
  return expression.head.text + expression.templateSpans
    .map((span) => "${}" + span.literal.text)
    .join("");
}

function referencedTranslationKeys(
  paths: readonly string[] = appSourceFiles(APP_DIRECTORY),
): {
  readonly literal: ReadonlySet<string>;
  readonly patterns: ReadonlySet<string>;
  readonly unresolved: readonly string[];
} {
  const literal = new Set<string>();
  const patterns = new Set<string>();
  const unresolved: string[] = [];

  for (const path of paths) {
    const source = readFileSync(path, "utf8");
    const ast = ts.createSourceFile(
      path,
      source,
      ts.ScriptTarget.Latest,
      true,
      path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    );
    ast.forEachChild(function visit(node): void {
      if (
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === "t" &&
        node.arguments[0]
      ) {
        const argument = unwrapExpression(node.arguments[0]);
        if (!collectTranslationArgument(argument, literal, patterns)) {
          const location = ast.getLineAndCharacterOfPosition(argument.getStart(ast));
          unresolved.push(`${path}:${location.line + 1}:${location.character + 1}`);
        }
      }
      ts.forEachChild(node, visit);
    });
  }
  return { literal, patterns, unresolved };
}

const DYNAMIC_TRANSLATION_FAMILIES = {
  "agent.${}": ["active", "stopped"],
  "agentRun.risk.${}": ["0", "1", "2", "3"],
  "ask.mode.${}": ["ask", "plan", "act"],
  "ask.source.${}": ["memory", "actor", "decision"],
  "context.classification.${}": ["public", "internal", "confidential", "restricted"],
  "context.custody.${}": ["guild", "shared", "personal"],
  "context.node.type.${}": [
    "memory", "external_source", "activity", "knowledge", "decision", "announcement",
    "agent_run", "connection", "file", "actor", "event", "conversation",
  ],
  "context.relation.status.${}": ["active", "revoked"],
  "context.relation.type.${}": [
    "assigned_to", "created_by", "depends_on", "derived_from", "evidences", "governs",
    "informed_by", "references", "resulted_in", "supports", "supersedes",
  ],
  "context.resource.type.${}": ["memory", "activity", "decision", "conversation", "file", "agent_run"],
  "context.review.kind.${}": ["stale", "possible_contradiction", "missing_source", "low_confidence"],
  "context.review.status.${}": ["open", "resolved", "dismissed"],
  "context.visibility.${}": ["guild", "space", "restricted", "private"],
  "contribution.correctionStatus.${}": ["open", "accepted", "rejected"],
  "contribution.facet.${}": ["knowledge", "activity", "decision", "support", "agent_supervision", "governance"],
  "language.${}": ["en", "ja", "zh-CN"],
  "lifecycle.handoverStatus.${}": ["open", "completed", "cancelled"],
  "lifecycle.resource.${}": ["memory", "activity", "knowledge", "file", "decision", "connection", "schedule"],
  "lifecycle.status.${}": ["assigned", "in_progress", "ready", "completed", "cancelled"],
  "memory.custody.${}.hint": ["guild", "personal"],
  "memory.layer.${}": ["working", "external"],
  "messages.promotion.${}": ["memory", "activity", "decision", "handover"],
  "operations.${}.${}": [
    ["health", "unknown"], ["health", "healthy"], ["health", "degraded"],
    ["health", "unreachable"], ["status", "active"], ["status", "disabled"],
    ["status", "revoked"], ["status", "draft"], ["status", "paused"],
    ["status", "archived"], ["status", "pending"], ["runStatus", "queued"],
    ["runStatus", "planning"], ["runStatus", "running"], ["runStatus", "succeeded"],
    ["runStatus", "failed"], ["runStatus", "cancelled"],
  ],
  "operations.automation.schedule.${}": ["daily", "weekdays", "weekly"],
  "operations.automation.trigger.${}": ["schedule", "event", "manual", "delegation"],
  "operations.connectionHealth.${}": ["healthy", "unhealthy"],
  "operations.connections.auth.${}": ["none", "secret_reference", "oauth", "service_binding", "access_token"],
  "operations.connections.capability.${}": ["observe", "execute", "integrate"],
  "operations.connections.kind.${}": ["https_webhook", "mcp", "oauth", "webhook", "api", "cloudflare_service", "database", "storage"],
  "operations.federation.direction.${}": ["inbound", "outbound", "bidirectional"],
  "operations.federation.permission.${}": ["read", "participate"],
  "operations.federation.resource.${}": ["memory", "activity", "decision", "agent"],
  "operations.models.provider.kind.${}": ["workers_ai", "cloudflare_ai_gateway", "openai_compatible"],
  "operations.models.purpose.${}": ["ask", "plan", "act", "embedding", "review"],
  "operations.retention.action.${}": ["retain", "archive", "purge"],
  "operations.retention.category.${}": [
    "memories", "activities", "decisions", "conversations", "files", "agent_runs", "chronicle",
  ],
  "operations.risk.${}": ["0", "1", "2", "3"],
  "operations.security.classification.${}": ["public", "internal", "confidential", "restricted"],
  "operations.security.visibility.${}": ["guild", "space", "restricted", "private"],
  "operations.status.${}": ["active", "disabled", "revoked", "draft", "paused", "archived", "pending"],
  "operations.tabs.${}": ["connections", "automation", "federation", "models", "data"],
  "space.${}": ["active", "archived"],
} as const;

function expandDynamicPattern(
  pattern: string,
  replacement: string | readonly string[],
): string {
  const values = typeof replacement === "string" ? [replacement] : replacement;
  return values.reduce((result, value) => result.replace("${}", value), pattern);
}

function expandedDynamicKeys(patterns?: ReadonlySet<string>): readonly string[] {
  const families = Object.entries(DYNAMIC_TRANSLATION_FAMILIES) as readonly [
    string,
    readonly (string | readonly string[])[],
  ][];
  return families
    .filter(([pattern]) => patterns?.has(pattern) ?? true)
    .flatMap(([pattern, values]) =>
      values.map((value) => expandDynamicPattern(pattern, value)));
}

function setDifference(left: ReadonlySet<string>, right: ReadonlySet<string>): readonly string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

function expectNoMissing(locale: string, expected: ReadonlySet<string>, actual: ReadonlySet<string>): void {
  const missing = setDifference(expected, actual);
  if (missing.length > 0) {
    throw new Error(`${locale} is missing ${missing.length} translation keys: ${missing.slice(0, 30).join(", ")}${missing.length > 30 ? ", ..." : ""}`);
  }
}

const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (originalStorageDescriptor) {
    Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
  } else {
    Reflect.deleteProperty(globalThis, "localStorage");
  }
});

function useStoredLocale(locale: "en" | "ja" | "zh-CN"): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => key === LOCALE_STORAGE_KEY ? locale : null,
      setItem: () => undefined,
    },
  });
}

function TranslationProbe({
  translationKey,
  values,
}: {
  translationKey: TranslationKey;
  values?: Readonly<Record<string, string | number>>;
}) {
  const { locale, t } = useI18n();
  return createElement("output", { "data-locale": locale }, t(translationKey, values));
}

function renderTranslation(
  locale: "en" | "ja" | "zh-CN",
  key: TranslationKey,
  values?: Readonly<Record<string, string | number>>,
): string {
  useStoredLocale(locale);
  return renderToStaticMarkup(createElement(
    I18nProvider,
    null,
    createElement(TranslationProbe, { translationKey: key, ...(values ? { values } : {}) }),
  ));
}

describe("application i18n acceptance", () => {
  it("defaults to English unless a supported stored preference exists", () => {
    expect(readInitialLocale({})).toBe("en");
    expect(readInitialLocale({ localStorage: { getItem: () => "unsupported", setItem: () => undefined } })).toBe("en");
    expect(readInitialLocale({ localStorage: { getItem: () => "ja", setItem: () => undefined } })).toBe("ja");
    expect(readInitialLocale({ localStorage: { getItem: () => "zh-CN", setItem: () => undefined } })).toBe("zh-CN");
    expect(readInitialLocale({ localStorage: { getItem: () => { throw new Error("blocked"); }, setItem: () => undefined } })).toBe("en");
  });

  it("keeps every locale dictionary complete, duplicate-free, and nonblank", () => {
    const englishKeys = new Set(dictionaries.en.values.keys());
    expect(englishKeys.size).toBeGreaterThan(0);

    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expect(dictionary.duplicates, `${locale} duplicate keys`).toEqual([]);
      expectNoMissing(locale, englishKeys, new Set(dictionary.values.keys()));
      expectNoMissing("en", new Set(dictionary.values.keys()), englishKeys);
      const blank = [...dictionary.values]
        .filter(([, value]) => value.trim() === "")
        .map(([key]) => key);
      expect(blank, `${locale} blank translation values`).toEqual([]);
    }
  });

  it("covers every literal and dynamic key referenced by application TypeScript", () => {
    const referenced = referencedTranslationKeys();
    const expectedPatterns = Object.keys(DYNAMIC_TRANSLATION_FAMILIES).sort();
    expect([...referenced.patterns].sort()).toEqual(expectedPatterns);

    const required = new Set([...referenced.literal, ...expandedDynamicKeys()]);
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expectNoMissing(locale, required, new Set(dictionary.values.keys()));
    }
  });

  it("statically covers every Operations page translation in all locales", () => {
    const referenced = referencedTranslationKeys([OPERATIONS_PAGE_PATH]);
    const operationPatterns = new Set(
      Object.keys(DYNAMIC_TRANSLATION_FAMILIES)
        .filter((pattern) => pattern.startsWith("operations.")),
    );

    expect(referenced.unresolved).toEqual([]);
    expect(referenced.literal.size).toBeGreaterThan(300);
    expect([...referenced.patterns].sort()).toEqual([...operationPatterns].sort());

    const required = new Set([
      ...referenced.literal,
      ...expandedDynamicKeys(operationPatterns),
      "nav.operations",
    ]);
    for (const [locale, dictionary] of Object.entries(dictionaries)) {
      expectNoMissing(locale, required, new Set(dictionary.values.keys()));
      const rawKeys = [...required].filter((key) => dictionary.values.get(key) === key);
      expect(rawKeys, `${locale} raw Operations translation keys`).toEqual([]);
    }
  });

  it("interpolates named values through the real provider in every locale", () => {
    const expected = {
      en: "7 requirements",
      ja: "7件の必須項目",
      "zh-CN": "7 项要求",
    } as const;

    for (const [locale, text] of Object.entries(expected) as [keyof typeof expected, string][]) {
      const markup = renderTranslation(locale, "lifecycle.requirementCount", { count: 7 });
      expect(markup).toContain(`data-locale=\"${locale}\"`);
      expect(markup).toContain(text);
      expect(markup).not.toContain("{count}");
      expect(markup).not.toContain("lifecycle.requirementCount");
    }
  });

  it("renders an unknown extension key without crashing the application", () => {
    const unknown = "context.relation.type.partner_attests" as TranslationKey;
    for (const locale of ["en", "ja", "zh-CN"] as const) {
      expect(renderTranslation(locale, unknown)).toContain(unknown);
    }
  });

  it("never renders a referenced translation key as raw UI text", () => {
    const referenced = referencedTranslationKeys();
    const keys = [...new Set([...referenced.literal, ...expandedDynamicKeys()])].sort();
    for (const locale of ["en", "ja", "zh-CN"] as const) {
      for (const key of keys) {
        const markup = renderTranslation(locale, key as TranslationKey);
        expect(markup, `${locale}.${key}`).not.toContain(`>${key}<`);
      }
    }
  });
});
