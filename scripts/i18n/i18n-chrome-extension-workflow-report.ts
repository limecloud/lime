#!/usr/bin/env tsx
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOCALES = ["en", "zh_CN", "zh_TW", "ja", "ko"];
export function analyzeChromeExtensionWorkflowReport({
  repoRoot = process.cwd(),
  extensionRoot = path.join(repoRoot, "extensions/lime-chrome"),
} = {}) {
  const manifest = JSON.parse(
    fs.readFileSync(path.join(extensionRoot, "manifest.json"), "utf8"),
  );
  const base = JSON.parse(
    fs.readFileSync(
      path.join(extensionRoot, "_locales/en/messages.json"),
      "utf8",
    ),
  );
  const keys = Object.keys(base);
  const locales = LOCALES.map((locale) => {
    const file = path.join(extensionRoot, "_locales", locale, "messages.json");
    const messages = fs.existsSync(file)
      ? JSON.parse(fs.readFileSync(file, "utf8"))
      : {};
    return {
      locale,
      missing: keys.filter((key) => !messages[key]?.message?.trim()),
      extra: Object.keys(messages).filter((key) => !keys.includes(key)),
    };
  });
  const issues: string[] = [];
  for (const locale of locales)
    if (locale.missing.length || locale.extra.length)
      issues.push(`${locale.locale}: locale keys differ`);
  if (
    manifest.default_locale !== "en" ||
    manifest.name !== "__MSG_name__" ||
    manifest.description !== "__MSG_description__"
  )
    issues.push("Manifest must use Chrome locale messages");
  if (
    !manifest.permissions?.includes("nativeMessaging") ||
    manifest.background?.service_worker !== "computer-use.js"
  )
    issues.push("Native Messaging worker is missing");
  for (const legacy of [
    "background.js",
    "popup.js",
    "lib",
    "pages",
    "site_adapter_runners.generated.js",
  ])
    if (fs.existsSync(path.join(extensionRoot, legacy)))
      issues.push(`Retired extension surface exists: ${legacy}`);
  return {
    schemaVersion: "2",
    extensionRoot,
    manifest,
    locales,
    issues,
    decision: {
      status: issues.length ? "required" : "ready",
      standardChromeLocaleWorkflowRequired: true,
      summary: issues.length
        ? issues.join("; ")
        : "Five Chrome locales and Native Messaging entry are ready",
    },
  };
}
export function formatChromeExtensionWorkflowReport(
  report: ReturnType<typeof analyzeChromeExtensionWorkflowReport>,
  format: "json" | "text" = "text",
) {
  return format === "json"
    ? JSON.stringify(report, null, 2) + "\n"
    : `${report.decision.status}: ${report.decision.summary}\n`;
}
export function runCli(argv = process.argv.slice(2)) {
  let repoRoot = process.cwd(),
    extensionRoot: string | undefined,
    format: "json" | "text" = "text",
    output: string | undefined;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      process.stdout.write(
        "Chrome extension locale report: --repo-root <path> --extension-root <path> --format text|json --output <file>\n",
      );
      return 0;
    }
    const value = argv[++index];
    if (!value) throw new Error(`Missing value for ${arg}`);
    if (arg === "--repo-root") repoRoot = path.resolve(value);
    else if (arg === "--extension-root") extensionRoot = path.resolve(value);
    else if (arg === "--output") output = path.resolve(value);
    else if (arg === "--format" && (value === "json" || value === "text"))
      format = value;
    else throw new Error(`Unknown argument ${arg}`);
  }
  const report = analyzeChromeExtensionWorkflowReport({
    repoRoot,
    extensionRoot,
  });
  const result = formatChromeExtensionWorkflowReport(report, format);
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, result);
  } else process.stdout.write(result);
  return report.issues.length ? 1 : 0;
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  process.exitCode = runCli();
