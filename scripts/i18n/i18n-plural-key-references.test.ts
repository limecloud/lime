import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import ts from "typescript";
import { collectPluralKeyReferences } from "./i18n-plural-key-references";
import { scanUnusedI18nKeys } from "./i18n-unused-key-check";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function scan(source: string, resource: Record<string, string>) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-plural-"));
  roots.push(root);
  fs.mkdirSync(path.join(root, "resources", "zh-CN"), { recursive: true });
  fs.mkdirSync(path.join(root, "src"));
  fs.writeFileSync(path.join(root, "src", "count.ts"), source);
  fs.writeFileSync(
    path.join(root, "resources", "zh-CN", "settings.json"),
    JSON.stringify(resource),
  );
  return scanUnusedI18nKeys({
    resourcesDir: path.join(root, "resources"),
    sourceDirs: [path.join(root, "src")],
  });
}

it("保留带 count 的实际翻译调用的复数资源，仍报告未使用家族", () => {
  const result = scan('t("hooks.count", { count: hooks.length });', {
    "hooks.count_one": "1 hook",
    "hooks.count_other": "{{count}} hooks",
    "hooks.count_zero": "No hooks",
    "hooks.unused_one": "Unused",
    "hooks.count_custom": "Not a plural suffix",
  });
  expect(result.referencedKeys).toEqual([
    "hooks.count_one",
    "hooks.count_other",
    "hooks.count_zero",
  ]);
  expect(result.unusedKeys.map(({ key }) => key)).toEqual([
    "hooks.count_custom",
    "hooks.unused_one",
  ]);
  expect(result.protectedKeys).toEqual([]);
});

it("不把无 count 的翻译、普通调用和字面量误判为复数消费", () => {
  const result = scan(
    't("hooks.count"); save("hooks.save", { count: 2 }); const key = "hooks.literal";',
    {
      "hooks.count_one": "Unused",
      "hooks.save_one": "Unused",
      "hooks.literal_other": "Unused",
    },
  );
  expect(result.referencedKeys).toEqual([]);
  expect(result.unusedKeys).toHaveLength(3);
});

it("支持选项常量、别名 t、条件 key 与序数", () => {
  const result = scan(
    'const tr = t; const opts = ({ count, ordinal: true } as const); tr(flag ? "first" : "second", "default", opts);',
    {
      first_ordinal_one: "First",
      second_ordinal_other: "Other",
      first_one: "Unused cardinal",
      cycle_one: "Unused cycle",
    },
  );
  expect(result.referencedKeys).toEqual([
    "first_ordinal_one",
    "second_ordinal_other",
  ]);
  expect(result.unusedKeys.map(({ key }) => key)).toEqual([
    "cycle_one",
    "first_one",
  ]);
});

it("复数选项解析拒绝循环引用", () => {
  const source = ts.createSourceFile(
    "cycle.ts",
    't("cycle", a)',
    ts.ScriptTarget.Latest,
    true,
  );
  const statement = source.statements[0] as ts.ExpressionStatement;
  const call = statement.expression as ts.CallExpression;
  const initializers = new Map<string, ts.Expression>([
    ["a", ts.factory.createIdentifier("b")],
    ["b", ts.factory.createIdentifier("a")],
  ]);
  expect(collectPluralKeyReferences(call, ["cycle"], initializers)).toEqual([]);
});
