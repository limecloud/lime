import fs from "node:fs";

import http from "node:http";

import os from "node:os";

import path from "node:path";

import process from "node:process";
import { withElectronFixtureSystemPath } from "../electron-fixture-runtime-env.mjs";
import {
  ASSISTANT_DONE_TEXT,
  FIXTURE_MODEL,
  GREETING_PROMPT,
  GREETING_SUMMARY_TEXT,
  GREETING_DONE_TEXT,
  RUNNING_TEXT,
  TEXT_PROVIDER_FIXTURE_API_KEY,
} from "./constants.mjs";
import { writeFixtureBackend } from "./backend-script.mjs";

export const LOCAL_SERVER_API_KEY = "chat_fixture_local_key";

function writeFixtureConfig(configPath, overrides = {}) {
  const serverHost = overrides.serverHost ?? "127.0.0.1";
  const serverPort = overrides.serverPort ?? 8999;
  const serverApiKey = overrides.serverApiKey ?? LOCAL_SERVER_API_KEY;
  const language = String(overrides.language ?? "").trim();
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    [
      "server:",
      `  host: ${serverHost}`,
      `  port: ${serverPort}`,
      `  api_key: ${serverApiKey}`,
      ...(language ? [`language: ${language}`] : []),
      "",
    ].join("\n"),
  );
}

export function createTempRuntimeEnv() {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "chat-fixture-"));
  const home = path.join(tempRoot, "home");
  const xdgConfigHome = path.join(tempRoot, "xdg-config");
  const xdgDataHome = path.join(tempRoot, "xdg-data");
  const localAppData = path.join(tempRoot, "local-app-data");
  const roamingAppData = path.join(tempRoot, "roaming-app-data");
  const electronUserDataDir = path.join(tempRoot, "electron-user-data");
  const agentRoot = path.join(electronUserDataDir, "app-server");
  const backendPath = path.join(tempRoot, "chat-backend.mjs");
  const backendLedgerPath = path.join(tempRoot, "chat-backend.jsonl");
  const cancelSignalPath = path.join(tempRoot, "chat-cancel.signal");
  for (const dir of [
    home,
    xdgConfigHome,
    xdgDataHome,
    localAppData,
    roamingAppData,
    electronUserDataDir,
    agentRoot,
  ]) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const configPath = path.join(xdgConfigHome, "lime", "config.yaml");
  const homeConfigPath = path.join(home, ".config", "lime", "config.yaml");
  const macConfigPath = path.join(
    home,
    "Library",
    "Application Support",
    "lime",
    "config.yaml",
  );
  writeFixtureConfig(configPath);
  writeFixtureConfig(homeConfigPath);
  writeFixtureConfig(macConfigPath);
  fs.writeFileSync(backendLedgerPath, "");
  writeFixtureBackend(backendPath);

  return {
    tempRoot,
    agentRoot,
    electronUserDataDir,
    backendPath,
    backendLedgerPath,
    cancelSignalPath,
    configPath,
    macConfigPath,
    homeConfigPath,
    writeFixtureConfig: (overrides = {}) => {
      writeFixtureConfig(configPath, overrides);
      writeFixtureConfig(homeConfigPath, overrides);
      writeFixtureConfig(macConfigPath, overrides);
    },
    env: withElectronFixtureSystemPath({
      ...process.env,
      HOME: home,
      // The fixture deliberately isolates application state under a temporary
      // HOME, but Rust toolchain resolution must continue to use the host
      // toolchain. Without these two paths rustup tries to bootstrap a second
      // toolchain inside the fixture and can stall sidecar preparation.
      CARGO_HOME: process.env.CARGO_HOME || path.join(os.homedir(), ".cargo"),
      RUSTUP_HOME:
        process.env.RUSTUP_HOME || path.join(os.homedir(), ".rustup"),
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_DATA_HOME: xdgDataHome,
      APPDATA: roamingAppData,
      LOCALAPPDATA: localAppData,
      LIME_AGENT_RUNTIME_ROOT: agentRoot,
    }),
  };
}

function fixtureTextForChatRequest(body) {
  const parsed = typeof body === "string" ? JSON.parse(body) : body;
  const messages = Array.isArray(parsed?.messages) ? parsed.messages : [];
  const greeting = messages.some(
    (message) =>
      message.role === "user" &&
      readChatContentText(message.content) === GREETING_PROMPT,
  );
  return greeting
    ? `${GREETING_SUMMARY_TEXT}\n${GREETING_DONE_TEXT}`
    : `${RUNNING_TEXT}${ASSISTANT_DONE_TEXT}`;
}

function readChatContentText(content) {
  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === "string") {
          return part;
        }
        if (part && typeof part === "object") {
          return (
            part.text ??
            part.content ??
            part.input_text ??
            part.output_text ??
            ""
          );
        }
        return "";
      })
      .filter(Boolean)
      .join(" ");
  }
  if (content && typeof content === "object") {
    return content.text ?? content.content ?? "";
  }
  return "";
}

function summarizeChatCompletionRequestBody(body) {
  let parsed = {};
  try {
    parsed = JSON.parse(body || "{}");
  } catch {
    parsed = {};
  }
  const messages = Array.isArray(parsed.messages) ? parsed.messages : [];
  const tools = Array.isArray(parsed.tools) ? parsed.tools : [];
  return {
    stream: parsed.stream ?? null,
    messageCount: messages.length,
    model: parsed.model ?? null,
    responseFormatType:
      parsed.response_format?.type ?? parsed.responseFormat?.type ?? null,
    toolChoice: parsed.tool_choice ?? parsed.toolChoice ?? null,
    toolNames: tools
      .map((tool) => tool?.function?.name ?? tool?.name ?? null)
      .filter(Boolean),
    messages: messages.slice(-4).map((message) => ({
      role: message?.role ?? null,
      contentLength: readChatContentText(message?.content).length,
    })),
  };
}

function openaiChatCompletionChunk({ content, finishReason = null }) {
  return {
    id: "chatcmpl-chat-text-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: FIXTURE_MODEL,
    choices: [
      {
        index: 0,
        delta: finishReason
          ? {}
          : {
              role: "assistant",
              content,
            },
        finish_reason: finishReason,
      },
    ],
  };
}

function openaiChatCompletionUsageChunk() {
  return {
    id: "chatcmpl-chat-text-fixture",
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model: FIXTURE_MODEL,
    choices: [],
    usage: {
      prompt_tokens: 31_000,
      completion_tokens: 0,
      total_tokens: 31_000,
    },
  };
}

function openaiChatCompletionBody(content) {
  return {
    id: "chatcmpl-chat-text-fixture",
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: FIXTURE_MODEL,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content,
        },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: 31_000,
      completion_tokens: 0,
      total_tokens: 31_000,
    },
  };
}

function openaiChatCompletionSseBody(content) {
  const firstChunk = JSON.stringify(
    openaiChatCompletionChunk({ content, finishReason: null }),
  );
  const finalChunk = JSON.stringify(
    openaiChatCompletionChunk({ content: "", finishReason: "stop" }),
  );
  const usageChunk = JSON.stringify(openaiChatCompletionUsageChunk());
  return `data: ${firstChunk}\n\ndata: ${finalChunk}\n\ndata: ${usageChunk}\n\ndata: [DONE]\n\n`;
}

function openaiModelsBody({ supportsTools = false } = {}) {
  return {
    object: "list",
    data: [
      {
        id: FIXTURE_MODEL,
        object: "model",
        owned_by: TEXT_FIXTURE_PROVIDER_NAME,
        display_name: FIXTURE_MODEL,
        input_modalities: ["text", "image"],
        output_modalities: ["text"],
        task_families: ["chat", "vision_understanding"],
        runtime_features: supportsTools
          ? ["streaming", "tool_calling"]
          : ["streaming"],
        capabilities: {
          vision: true,
          streaming: true,
          tools: supportsTools,
        },
      },
    ],
  };
}

export async function startTextProviderFixtureServer({
  requestMarkers = [],
} = {}) {
  const requests = [];
  const expectedAuthorization = `Bearer ${TEXT_PROVIDER_FIXTURE_API_KEY}`;
  const server = http.createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
        url: request.url,
        headers: request.headers,
        authorization: request.headers.authorization ? "present" : "missing",
        body,
      });

      if (request.headers.authorization !== expectedAuthorization) {
        response.writeHead(401, { "content-type": "application/json" });
        response.end(
          JSON.stringify({
            error: {
              message: "fixture text provider requires its scoped credential",
              type: "authentication_error",
            },
          }),
        );
        return;
      }

      const pathname = (() => {
        try {
          return new URL(request.url || "/", "http://127.0.0.1").pathname;
        } catch {
          return request.url || "/";
        }
      })();
      if (
        request.method === "GET" &&
        ["/models", "/v1/models"].includes(pathname)
      ) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(
          JSON.stringify(
            openaiModelsBody({
              supportsTools: false,
            }),
          ),
        );
        return;
      }
      if (
        request.method !== "POST" ||
        !["/chat/completions", "/v1/chat/completions"].includes(pathname)
      ) {
        response.writeHead(404, { "content-type": "application/json" });
        response.end(JSON.stringify({ error: { message: "not found" } }));
        return;
      }

      let parsedBody = {};
      try {
        parsedBody = JSON.parse(body || "{}");
      } catch {
        parsedBody = {};
      }
      const content = fixtureTextForChatRequest(body);
      if (parsedBody.stream === false) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(openaiChatCompletionBody(content)));
        return;
      }

      const responseBody = openaiChatCompletionSseBody(content);
      response.writeHead(200, {
        "content-type": "text/event-stream; charset=utf-8",
        "cache-control": "no-cache",
        connection: "close",
        "content-length": Buffer.byteLength(responseBody),
      });
      response.end(responseBody);
    });
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const port = address && typeof address === "object" ? address.port : null;
  if (!port) {
    await new Promise((resolve) => server.close(resolve));
    throw new Error("文本 Provider fixture server 未返回端口");
  }

  return {
    baseUrl: `http://127.0.0.1:${port}/v1`,
    host: "127.0.0.1",
    port,
    requestCount: () => requests.length,
    requests: () =>
      requests.map((entry) => ({
        method: entry.method,
        url: entry.url,
        authorization: entry.authorization,
        model: (() => {
          try {
            return JSON.parse(entry.body || "{}").model ?? null;
          } catch {
            return null;
          }
        })(),
        bodySummary: summarizeChatCompletionRequestBody(entry.body),
        bodyMarkers: Object.fromEntries(
          requestMarkers.map((marker) => [marker, entry.body.includes(marker)]),
        ),
      })),
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
