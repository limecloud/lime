import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const desktopHostAliasPatterns = [
  ["^@/lib/desktop-host/core$", "core.ts"],
  ["^@/lib/desktop-host/event$", "event.ts"],
  ["^@/lib/desktop-host/window$", "window.ts"],
  ["^@/lib/desktop-host/window$", "window.ts"],
  ["^@/lib/desktop-host/window$", "window.ts"],
  ["^@/lib/desktop-host/plugin-dialog$", "plugin-dialog.ts"],
  ["^@/lib/desktop-host/plugin-shell$", "plugin-shell.ts"],
  ["^@/lib/desktop-host/plugin-deep-link$", "plugin-deep-link.ts"],
  ["^@/lib/desktop-host/plugin-global-shortcut$", "plugin-global-shortcut.ts"],
];

const workspaceAliasSpecs = [
  ["@limecloud/app-server-client", "packages/app-server-client/src/browser.ts"],
  [
    "@limecloud/agent-runtime-client/sessionGateway",
    "packages/agent-runtime-client/src/sessionGateway.ts",
  ],
  [
    "@limecloud/agent-runtime-client",
    "packages/agent-runtime-client/src/index.ts",
  ],
  ["@limecloud/agent-ui-contracts", "packages/agent-ui-contracts/src/index.ts"],
  [
    "@limecloud/agent-runtime-projection",
    "packages/agent-runtime-projection/src/index.ts",
  ],
  ["@limecloud/agent-runtime-ui", "packages/agent-runtime-ui/src/index.ts"],
];

function toFileUrl(filePath) {
  return pathToFileURL(filePath).href;
}

export function createVitestSmokeConfig(rootDir) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "vitest-smoke-"));
  const configPath = path.join(tempDir, "vitest.config.mjs");
  const cacheDir = path.join(tempDir, "vite-cache");
  const desktopHostDir = path.join(rootDir, "src/lib/desktop-host");
  const aliasSpecs = desktopHostAliasPatterns.map(([pattern, target]) => ({
    pattern,
    replacement: path.join(desktopHostDir, target),
  }));
  const workspaceAliases = workspaceAliasSpecs.map(([find, target]) => ({
    find,
    replacement: path.join(rootDir, target),
  }));

  fs.writeFileSync(
    configPath,
    `import path from "node:path";\n` +
      `import { defineConfig } from ${JSON.stringify(
        toFileUrl(path.join(rootDir, "node_modules/vite/dist/node/index.js")),
      )};\n` +
      `import react from ${JSON.stringify(
        toFileUrl(
          path.join(rootDir, "node_modules/@vitejs/plugin-react/dist/index.js"),
        ),
      )};\n` +
      `import svgr from ${JSON.stringify(
        toFileUrl(
          path.join(rootDir, "node_modules/vite-plugin-svgr/dist/index.js"),
        ),
      )};\n` +
      `const rootDir = ${JSON.stringify(rootDir)};\n` +
      `const aliasSpecs = ${JSON.stringify(aliasSpecs)};\n` +
      `const workspaceAliases = ${JSON.stringify(workspaceAliases)};\n` +
      `export default defineConfig({\n` +
      `  root: rootDir,\n` +
      `  cacheDir: ${JSON.stringify(cacheDir)},\n` +
      `  define: { "import.meta.env.VITE_APP_VERSION": JSON.stringify(process.env.VITE_APP_VERSION || "test") },\n` +
      `  plugins: [react({ jsxRuntime: "automatic", jsxImportSource: "react", babel: { compact: true } }), svgr()],\n` +
      `  resolve: { alias: [\n` +
      `    { find: "@", replacement: path.resolve(rootDir, "src") },\n` +
      `    ...aliasSpecs.map((entry) => ({ find: new RegExp(entry.pattern), replacement: entry.replacement })),\n` +
      `    ...workspaceAliases,\n` +
      `  ] },\n` +
      `  test: {\n` +
      `    globals: true,\n` +
      `    environment: "jsdom",\n` +
      `    exclude: ["**/node_modules/**", "**/dist/**", "**/lime-rs/target/**"],\n` +
      `  },\n` +
      `});\n`,
  );

  return {
    configPath,
    cleanup() {
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
  };
}

export function runVitestSmoke({ rootDir, label, args, logPrefix, env }) {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const config = createVitestSmokeConfig(rootDir);
  const reportPath = path.join(path.dirname(config.configPath), "results.json");
  const startedAt = Date.now();

  console.log(`\n[${logPrefix}] > ${label}`);

  try {
    const result = spawnSync(
      npmCommand,
      [
        "exec",
        "--",
        "vitest",
        "run",
        ...args,
        "--config",
        config.configPath,
        "--reporter=default",
        "--reporter=json",
        "--outputFile",
        reportPath,
      ],
      {
        cwd: rootDir,
        stdio: "inherit",
        env: { ...process.env, ...env },
      },
    );

    if (result.error) {
      throw result.error;
    }

    if (result.status !== 0) {
      const error = new Error(
        `[${logPrefix}] ${label} 失败 (exit=${result.status}, signal=${result.signal ?? "none"})`,
      );
      error.exitCode = result.status ?? 1;
      throw error;
    }

    let report;
    try {
      report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    } catch (cause) {
      throw new Error(`[${logPrefix}] ${label} 缺少有效 Vitest 执行报告`, {
        cause,
      });
    }
    if (
      report?.success !== true ||
      report.numFailedTests !== 0 ||
      report.numFailedTestSuites !== 0 ||
      !Number.isInteger(report.numPassedTests) ||
      report.numPassedTests < 1
    ) {
      throw new Error(
        `[${logPrefix}] ${label} 未通过有效测试 (passed=${report?.numPassedTests ?? "unknown"}, failed=${report?.numFailedTests ?? "unknown"}, skipped=${report?.numPendingTests ?? "unknown"})`,
      );
    }

    console.log(`[${logPrefix}] ${label}: executed=${report.numPassedTests}`);
    return {
      label,
      status: "pass",
      executedTests: report.numPassedTests,
      durationMs: Date.now() - startedAt,
      args,
    };
  } finally {
    config.cleanup();
  }
}
