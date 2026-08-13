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

function parseDictionary(variableName: string): ParsedDictionary {
  let declaration: ts.VariableDeclaration | undefined;
  I18N_AST.forEachChild(function visit(node): void {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === variableName
    ) {
      declaration = node;
    }
    ts.forEachChild(node, visit);
  });

  if (!declaration?.initializer) {
    throw new Error(`Dictionary ${variableName} was not found in ${I18N_PATH}`);
  }
  const initializer = unwrapExpression(declaration.initializer);
  if (!ts.isObjectLiteralExpression(initializer)) {
    throw new Error(`Dictionary ${variableName} must be an object literal`);
  }

  const values = new Map<string, string>();
  const duplicates: string[] = [];
  for (const property of initializer.properties) {
    if (!ts.isPropertyAssignment(property)) {
      throw new Error(`Dictionary ${variableName} may only contain explicit properties`);
    }
    const key = propertyName(property.name);
    const value = unwrapExpression(property.initializer);
    if (key === null || !ts.isStringLiteralLike(value)) {
      throw new Error(`Dictionary ${variableName} contains a non-literal entry`);
    }
    if (values.has(key)) duplicates.push(key);
    values.set(key, value.text);
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

function literalKeys(expression: ts.Expression): readonly string[] {
  const value = unwrapExpression(expression);
  if (ts.isStringLiteralLike(value)) return [value.text];
  if (ts.isConditionalExpression(value)) {
    return [...literalKeys(value.whenTrue), ...literalKeys(value.whenFalse)];
  }
  return [];
}

function templatePattern(expression: ts.TemplateExpression): string {
  return expression.head.text + expression.templateSpans
    .map((span) => "${}" + span.literal.text)
    .join("");
}

function referencedTranslationKeys(): {
  readonly literal: ReadonlySet<string>;
  readonly patterns: ReadonlySet<string>;
} {
  const literal = new Set<string>();
  const patterns = new Set<string>();

  for (const path of appSourceFiles(APP_DIRECTORY)) {
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
        for (const key of literalKeys(argument)) literal.add(key);
        if (ts.isTemplateExpression(argument)) patterns.add(templatePattern(argument));
      }
      ts.forEachChild(node, visit);
    });
  }
  return { literal, patterns };
}

const DYNAMIC_TRANSLATION_FAMILIES = {
  "agent.${}": ["active", "stopped"],
  "agentRun.risk.${}": ["0", "1", "2", "3"],
  "ask.mode.${}": ["ask", "plan", "act"],
  "context.classification.${}": ["public", "internal", "confidential", "restricted"],
  "context.custody.${}": ["guild", "shared", "personal"],
  "context.node.type.${}": [
    "memory", "external_source", "activity", "knowledge", "decision", "announcement",
    "agent_run", "connection", "file", "actor", "event", "conversation",
  ],
  "context.relation.status.${}": ["active", "revoked"],
  "context.relation.type.${}": [
    "assigned_to", "created_by", "depends_on", "derived_from", "evidences", "governs",
    "informed_by", "references", "resulted_in", "supersedes",
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
  "memory.layer.${}": ["working", "external"],
  "space.${}": ["active", "archived"],
} as const;

function expandedDynamicKeys(): readonly string[] {
  return Object.entries(DYNAMIC_TRANSLATION_FAMILIES).flatMap(([pattern, values]) =>
    values.map((value) => pattern.replace("${}", value)));
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
