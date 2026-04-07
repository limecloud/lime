import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const bundledIndexPath = path.join(
  projectRoot,
  "src-tauri/resources/site-adapters/bundled/index.json",
);
const bundledScriptsRoot = path.join(
  projectRoot,
  "src-tauri/resources/site-adapters/bundled",
);
const outputPath = path.join(
  projectRoot,
  "extensions/lime-chrome/site_adapter_runners.generated.js",
);

async function readBundledCatalog() {
  const raw = await fs.readFile(bundledIndexPath, "utf8");
  const parsed = JSON.parse(raw);
  const adapters = Array.isArray(parsed?.adapters) ? parsed.adapters : [];
  if (adapters.length === 0) {
    throw new Error("bundled site adapter catalog 为空");
  }
  return adapters;
}

async function readRunnerSource(scriptFile) {
  if (typeof scriptFile !== "string" || scriptFile.trim().length === 0) {
    throw new Error("adapter 缺少 script_file");
  }
  const scriptPath = path.join(bundledScriptsRoot, scriptFile);
  return fs.readFile(scriptPath, "utf8");
}

function buildOutput(entries) {
  const body = entries
    .map(({ name, source }) => {
      const normalizedSource = source
        .trim()
        .replace(/\r\n/g, "\n")
        .replace(/;\s*$/, "");
      return `    ${JSON.stringify(name)}: (${normalizedSource})`;
    })
    .join(",\n\n");

  return `// 由 scripts/generate-extension-site-adapter-runners.mjs 自动生成，请勿手改。
(function () {
  const generatedSiteAdapterRunners = {
${body}
  };

  const existingSiteAdapterRunners =
    window.__LIME_SITE_ADAPTER_RUNNERS__ &&
    typeof window.__LIME_SITE_ADAPTER_RUNNERS__ === "object" &&
    !Array.isArray(window.__LIME_SITE_ADAPTER_RUNNERS__)
      ? window.__LIME_SITE_ADAPTER_RUNNERS__
      : {};

  window.__LIME_SITE_ADAPTER_RUNNERS__ = {
    ...generatedSiteAdapterRunners,
    ...existingSiteAdapterRunners,
  };
})();
`;
}

async function collectEntries() {
  const adapters = await readBundledCatalog();
  const entries = [];
  for (const adapter of adapters) {
    const name = String(adapter?.name || "").trim();
    if (!name) {
      throw new Error("bundled adapter 缺少 name");
    }
    const source = await readRunnerSource(adapter?.script_file);
    entries.push({ name, source });
  }
  return entries;
}

async function main() {
  const entries = await collectEntries();
  const output = buildOutput(entries);
  const checkOnly = process.argv.includes("--check");
  let current = "";
  try {
    current = await fs.readFile(outputPath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }

  if (checkOnly) {
    if (current !== output) {
      throw new Error(
        "site_adapter_runners.generated.js 已过期，请先运行 npm run generate:extension-site-adapters",
      );
    }
    return;
  }

  await fs.writeFile(outputPath, output, "utf8");
}

main().catch((error) => {
  console.error(
    `[generate-extension-site-adapter-runners] ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
});
