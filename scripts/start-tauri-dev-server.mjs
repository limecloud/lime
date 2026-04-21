#!/usr/bin/env node

import process from "node:process";
import { runViteDevServerBootstrap } from "./lib/vite-dev-server-bootstrap.mjs";

runViteDevServerBootstrap({
  browserBridge: false,
  devUrl: "http://127.0.0.1:1420/",
  entryModulePath: "/src/main.tsx",
  reuseExistingOnly: false,
  logLabel: "dev:tauri-shell",
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
