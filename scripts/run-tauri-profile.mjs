import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const mode = args.shift() || "trace";

let openDevtools = false;
let headless = false;
const extraArgs = [];

for (const arg of args) {
  if (arg === "--open-devtools") {
    openDevtools = true;
    continue;
  }
  if (arg === "--headless") {
    headless = true;
    continue;
  }
  extraArgs.push(arg);
}

const supportedModes = new Map([
  ["trace", ["trace"]],
  ["console", ["console"]],
  ["trace-console", ["trace", "console"]],
]);
const defaultCargoTargetDir = path.join(rootDir, "src-tauri", "target");

const profileModes = supportedModes.get(mode);

if (!profileModes) {
  console.error(`[profile] 不支持的模式: ${mode}`);
  process.exit(1);
}

const env = {
  ...process.env,
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || defaultCargoTargetDir,
  LIME_PROFILE: profileModes.join(","),
  RUST_BACKTRACE: process.env.RUST_BACKTRACE || "1",
  RUST_LOG: process.env.RUST_LOG || "info",
};

if (openDevtools) {
  env.LIME_OPEN_WEBVIEW_DEVTOOLS = "1";
}

if (profileModes.includes("console")) {
  const existingRustFlags = env.RUSTFLAGS?.trim() || "";
  env.RUSTFLAGS = existingRustFlags.includes("--cfg tokio_unstable")
    ? existingRustFlags
    : [existingRustFlags, "--cfg tokio_unstable"].filter(Boolean).join(" ");
  env.TOKIO_CONSOLE_BIND = process.env.TOKIO_CONSOLE_BIND || "127.0.0.1:6669";
}

const tauriArgs = ["exec", "--", "tauri", "dev"];
if (headless) {
  tauriArgs.push("--config", "src-tauri/tauri.conf.headless.json");
}
const tauriFeatures = [];

if (profileModes.includes("trace")) {
  tauriFeatures.push("dev-profiling");
}

if (profileModes.includes("console")) {
  tauriFeatures.push("tokio-console");
}

if (tauriFeatures.length > 0) {
  tauriArgs.push("--features", tauriFeatures.join(","));
}
tauriArgs.push(...extraArgs);

console.log("[profile] 仅用于开发诊断，release/生产构建默认不会启用这些能力。");

if (profileModes.includes("trace")) {
  console.log(
    "[profile] 已启用 trace 导出，关闭应用后可把生成的 JSON 导入 https://ui.perfetto.dev/",
  );
}

if (profileModes.includes("console")) {
  console.log(
    `[profile] 已启用 Tokio Console 遥测，另开终端运行: tokio-console ${env.TOKIO_CONSOLE_BIND}`,
  );
}

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const child = spawn(npmCommand, tauriArgs, {
  cwd: rootDir,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
