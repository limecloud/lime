#!/usr/bin/env node

import process from "node:process";
import { runViteDevServerBootstrap } from "./lib/vite-dev-server-bootstrap.mjs";

const DEV_URL =
  process.env.LIME_WEB_BRIDGE_URL?.trim() || "http://127.0.0.1:1420/";
const ENTRY_MODULE_PATH =
  process.env.LIME_WEB_BRIDGE_ENTRY_PATH?.trim() || "/src/main.tsx";
const REUSE_EXISTING_ONLY =
  process.env.LIME_WEB_BRIDGE_REUSE_EXISTING_ONLY?.trim() === "1";

runViteDevServerBootstrap({
  browserBridge: true,
  devUrl: DEV_URL,
  entryModulePath: ENTRY_MODULE_PATH,
  reuseExistingOnly: REUSE_EXISTING_ONLY,
  logLabel: "dev:web-bridge",
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
