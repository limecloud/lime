import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startOpenAiCompatibleFixtureServer } from "../lib/openai-compatible-fixture-server.mjs";
import { invokeAppServerFromPage } from "../lib/chat-fixture/rpc.mjs";

const OFFICIAL_OPENAI_BASE_URL = "http://api.openai.com/v1";
export const MODEL_NAME = "fixture-code-mode";
const PROVIDER_API_KEY = "fixture-code-mode-key";
const PROVIDER_TYPE = "gateway";
export const EXEC_CALL_ID = "call-code-mode-gate-b";
export const EXEC_OUTPUT_MARKER = "CODE_MODE_GATE_B_OK";
export const FINAL_TEXT = "CODE_MODE_GATE_B_VISIBLE";

const MEMORY_PROMPT_PREFIX = fs
  .readFileSync(
    path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../lime-rs/crates/app-server/src/memory_store/consolidation_prompt.md",
    ),
    "utf8",
  )
  .replaceAll("\r\n", "\n")
  .split("\n\n")[0];

function isMemoryRequest(value) {
  if (typeof value === "string") {
    return value.replaceAll("\r\n", "\n").startsWith(MEMORY_PROMPT_PREFIX);
  }
  if (Array.isArray(value)) return value.some(isMemoryRequest);
  if (value && typeof value === "object") {
    return Object.values(value).some(isMemoryRequest);
  }
  return false;
}

export function codeModeResponses(fixture) {
  return fixture.requests.filter(
    (request) =>
      request.path === "/v1/responses" && !isMemoryRequest(request.body),
  );
}

function modelConfig() {
  return {
    id: MODEL_NAME,
    capability: {
      taskFamilies: ["chat"],
      inputModalities: ["text"],
      outputModalities: ["text"],
      runtimeFeatures: [
        "streaming",
        "tool_calling",
        "custom_tools",
        "responses_api",
      ],
      capabilities: {
        vision: false,
        tools: true,
        streaming: true,
        jsonMode: false,
        functionCalling: true,
        reasoning: false,
      },
    },
  };
}

function customToolOutput(body) {
  const input = Array.isArray(body?.input) ? body.input : [];
  return input.find(
    (item) =>
      item?.type === "custom_tool_call_output" &&
      item?.call_id === EXEC_CALL_ID,
  );
}

export async function startCodeModeFixture() {
  let foregroundRequestCount = 0;
  return await startOpenAiCompatibleFixtureServer({
    apiKey: PROVIDER_API_KEY,
    model: MODEL_NAME,
    modelRuntimeFeatures: modelConfig().capability.runtimeFeatures,
    modelToolMode: "code_mode",
    scriptedResponses: [
      ({ body }) => {
        // Startup memory shares the provider, but owns an independent conversation.
        if (isMemoryRequest(body)) {
          return { type: "text", content: "MEMORY-FIXTURE: no update needed" };
        }
        if (foregroundRequestCount++ === 0) {
          return {
            type: "custom_tool_call",
            id: EXEC_CALL_ID,
            name: "exec",
            input: `text("${EXEC_OUTPUT_MARKER}");`,
          };
        }
        const output = customToolOutput(body);
        if (!String(output?.output || "").includes(EXEC_OUTPUT_MARKER)) {
          throw new Error(
            "second Responses request is missing the CodeMode custom_tool_call_output marker",
          );
        }
        return { type: "text", content: FINAL_TEXT };
      },
    ],
  });
}

export function installProviderProxy(runtimeEnv, proxyUrl) {
  Object.assign(runtimeEnv.env, {
    HTTP_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    NO_PROXY: "127.0.0.1,localhost,::1",
    no_proxy: "127.0.0.1,localhost,::1",
  });
}

export async function provisionProvider(page, requestLog) {
  const created = await invokeAppServerFromPage(
    page,
    "modelProvider/create",
    {
      name: `CodeMode Gate B ${process.pid}`,
      providerType: PROVIDER_TYPE,
      apiHost: OFFICIAL_OPENAI_BASE_URL,
    },
    requestLog,
  );
  const providerId = String(created.result?.provider?.id || "").trim();
  assert(providerId, "modelProvider/create did not return provider.id");

  await invokeAppServerFromPage(
    page,
    "modelProvider/update",
    {
      providerId,
      enabled: true,
      sortOrder: 0,
      models: [modelConfig()],
    },
    requestLog,
  );
  await invokeAppServerFromPage(
    page,
    "modelProviderKey/create",
    {
      providerId,
      apiKey: PROVIDER_API_KEY,
      alias: "code-mode-gate-b",
      replaceExisting: true,
    },
    requestLog,
  );
  const fetched = await invokeAppServerFromPage(
    page,
    "modelProvider/fetchModels",
    { providerId },
    requestLog,
  );
  const models = Array.isArray(fetched.result?.models)
    ? fetched.result.models
    : [];
  const model = models.find((candidate) => candidate?.id === MODEL_NAME);
  assert(model, "modelProvider/fetchModels did not return the CodeMode model");
  return {
    providerId,
    model,
    source: fetched.result?.source || null,
  };
}

function requestTool(request, name) {
  const tools = Array.isArray(request?.body?.tools) ? request.body.tools : [];
  return tools.find((tool) => String(tool?.name || "").trim() === name) || null;
}

export function summarizeProviderEvidence(fixture) {
  const responses = codeModeResponses(fixture);
  const first = responses[0] || null;
  const second = responses[1] || null;
  const execTool = requestTool(first, "exec");
  const output = customToolOutput(second?.body);
  return {
    discoveryRequestCount: fixture.modelRequests.length,
    discoveryUsedOfficialHost: fixture.modelRequests.some(
      (request) => request.host === "api.openai.com",
    ),
    responsesRequestCount: responses.length,
    memoryRequestCount: fixture.requests.filter((request) =>
      isMemoryRequest(request.body),
    ).length,
    responsesUsedOfficialHost: responses.every(
      (request) => request.host === "api.openai.com",
    ),
    firstRequestAdvertisedExec: Boolean(execTool),
    execToolType: execTool?.type || null,
    execFormatType: execTool?.format?.type || null,
    execFormatSyntax: execTool?.format?.syntax || null,
    secondRequestHasCustomToolOutput: Boolean(output),
    customToolOutputContainsMarker: String(output?.output || "").includes(
      EXEC_OUTPUT_MARKER,
    ),
    customToolOutput: String(output?.output || ""),
    requestErrors: responses
      .map((request) => request.responseError)
      .filter(Boolean),
  };
}
