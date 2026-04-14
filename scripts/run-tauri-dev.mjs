import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
const headless = args.includes("--headless");
const noWatch = args.includes("--no-watch");
const passthroughArgs = args.filter(
  (arg) => arg !== "--headless" && arg !== "--no-watch",
);
const defaultCargoTargetDir = path.join(rootDir, "src-tauri", "target");

const env = {
  ...process.env,
  CARGO_TARGET_DIR: process.env.CARGO_TARGET_DIR || defaultCargoTargetDir,
};

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const tauriArgs = ["exec", "--", "tauri", "dev"];

if (headless) {
  tauriArgs.push("--config", "src-tauri/tauri.conf.headless.json");
}

if (noWatch) {
  tauriArgs.push("--no-watch");
}

tauriArgs.push(...passthroughArgs);

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
