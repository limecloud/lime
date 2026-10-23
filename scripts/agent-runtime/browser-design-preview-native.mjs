import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

// Test-only launcher. It bundles the actual owners, never a replacement browser bridge.
const [snapshot, output] = process.argv
  .slice(2)
  .map((value) => path.resolve(value));
const root = process.cwd();
await mkdir(output, { recursive: true });
const require = createRequire(import.meta.url);
const { build } = createRequire(require.resolve("vite"))("esbuild");
const ownerBundle = path.join(output, "owners.mjs");
await build({
  stdin: {
    contents:
      'export { BrowserAnnotationHost } from "./electron/browserAnnotationHost.ts"; export { BrowserAnnotationEditorHost } from "./electron/browserAnnotationEditorHost.ts";',
    resolveDir: root,
  },
  outfile: ownerBundle,
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  external: ["electron", "node:*"],
});
const fixture = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "browser-design-preview-fixture.mjs",
);
const env = { ...process.env };
delete env.NODE_OPTIONS;
delete env.ELECTRON_RUN_AS_NODE;
const startedAt = new Date().toISOString();
const child = spawn(electron, [fixture, root, snapshot, output, ownerBundle], {
  env,
  stdio: "inherit",
});
const launch = {
  startedAt,
  pid: child.pid,
  hiddenWindow: true,
  physicalInput: false,
};
const timer = setTimeout(() => {
  launch.timeout = true;
  child.kill("SIGTERM");
}, 60_000);
child.on("error", (error) => {
  launch.error = String(error);
});
child.on("close", async (code, signal) => {
  clearTimeout(timer);
  const summary = await readFile(path.join(output, "summary.json"), "utf8")
    .then(JSON.parse)
    .catch(() => null);
  Object.assign(launch, {
    exitCode: code,
    signal,
    completedAt: new Date().toISOString(),
    fresh: !!summary?.completedAt && summary.completedAt >= startedAt,
    summaryResult: summary?.result ?? null,
  });
  launch.result =
    code === 0 && launch.fresh && summary?.result === "pass" ? "pass" : "fail";
  await writeFile(
    path.join(output, "launch.json"),
    JSON.stringify(launch, null, 2) + "\n",
  );
  process.exitCode = launch.result === "pass" ? 0 : 1;
});
