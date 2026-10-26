import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readSessionSummary } from "./claw-image-live-smoke-audit.mjs";
import { extractSessionAndTurn } from "./claw-image-live-smoke-gui.mjs";

afterEach(() => vi.unstubAllGlobals());

describe("live image canonical identity", () => {
  it("does not treat a JSON-RPC request ID as a Turn ID", () => {
    const identity = extractSessionAndTurn({
      afterClick: {
        matchingTurnStartTrace: { id: "request-1", threadId: "thread-1" },
      },
    });
    expect(identity.sessionId).toBe("thread-1");
    expect(identity.turnId).toBe("");
  });

  it("reads the canonical Thread and requires the actual media Turn identity", async () => {
    const requests = [];
    vi.stubGlobal("window", {
      electronAPI: {
        invoke: async (command, { request }) => {
          const message = JSON.parse(request.lines[0]);
          requests.push({
            command,
            method: message.method,
            params: message.params,
          });
          return {
            lines: [
              JSON.stringify({
                jsonrpc: "2.0",
                id: message.id,
                result: {
                  thread: {
                    id: "thread-1",
                    turns: [
                      { id: "turn-old", status: "completed", items: [] },
                      {
                        id: "turn-image",
                        status: "completed",
                        items: [{ type: "dynamicToolCall" }],
                      },
                    ],
                  },
                },
              }),
            ],
          };
        },
      },
    });
    const page = { evaluate: (evaluate, args) => evaluate(args) };
    const summary = await readSessionSummary(
      page,
      "thread-1",
      "",
      "turn-image",
    );
    expect(requests).toEqual([
      {
        command: "app_server_handle_json_lines",
        method: "thread/read",
        params: { threadId: "thread-1", includeTurns: true },
      },
    ]);
    expect(summary.hasThread).toBe(true);
    expect(summary.turn).toEqual({
      id: "turn-image",
      status: "completed",
      itemTypes: ["dynamicToolCall"],
    });
    expect(
      (await readSessionSummary(page, "thread-1", "", "turn-missing")).turn,
    ).toBeNull();
  });
});

const liveSmokeFiles = [
  "scripts/agent-runtime/claw-image-live-smoke.mjs",
  "scripts/agent-runtime/claw-image-live-smoke-options.mjs",
  "scripts/agent-runtime/claw-image-live-smoke-provider.mjs",
  "scripts/agent-runtime/claw-image-live-smoke-gui.mjs",
  "scripts/agent-runtime/claw-image-live-smoke-audit.mjs",
  "scripts/agent-runtime/claw-image-live-smoke-common.mjs",
];

function readLiveSmokeContent() {
  return liveSmokeFiles
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
}

describe("claw image live smoke guard", () => {
  it("is exposed as an explicit live-gated npm script", () => {
    const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
    const content = readLiveSmokeContent();

    expect(packageJson.scripts["smoke:claw-image-live"]).toBe(
      "node scripts/agent-runtime/claw-image-live-smoke.mjs",
    );
    expect(content).toContain("--allow-live-provider");
    expect(content).toContain("LIME_ALLOW_LIVE_PROVIDER_SMOKE");
    expect(content).toContain("LIME_REAL_API_TEST");
    expect(content).toContain("真实图片 smoke 默认关闭");
    expect(content).toContain("AGNES_API_KEY");
    expect(content).toContain("apiKeyConfigured: true");
    expect(content).toContain('providerType: "openai"');
    expect(content).not.toContain('providerType: "openai-compatible"');
    expect(content).not.toContain(
      ["sk", "KcvqrGaanL8wNZgV1UtuWNMMQMJX12jNpeFom00jdD7p7crs"].join("-"),
    );
  });

  it("uses real Electron GUI and App Server runtime instead of fixture or mock backend", () => {
    const content = readLiveSmokeContent();

    expect(content).toContain("import { _electron as electron }");
    expect(content).toContain("electron.launch({");
    expect(content).toContain('APP_SERVER_BACKEND_MODE: "runtime"');
    expect(content).toContain("ELECTRON_E2E_USER_DATA_DIR");
    expect(content).toContain("sendPromptFromGui");
    expect(content).toContain("@配图");
    expect(content).toContain("allowTaskCenterHomeInput: true");
    expect(content).toContain(
      '[data-testid="composer-editor"][role="textbox"]',
    );
    expect(content).not.toContain('APP_SERVER_BACKEND_MODE: "external"');
    expect(content).not.toContain('APP_SERVER_BACKEND_MODE: "mock"');
    expect(content).not.toContain("startImageProviderFixtureServer");
    expect(content).not.toContain("IMAGE_PROVIDER_FIXTURE_DATA_URL");
    expect(content).not.toContain("mockPriorityCommands");
    expect(content).not.toContain("defaultMocks");
    expect(content).not.toContain("invokeMockOnly");
    expect(content).not.toContain("agent_runtime_");
  });

  it("requires the same user-visible image flow the product expects", () => {
    const content = readLiveSmokeContent();

    expect(content).toContain("reasoningVisible");
    expect(content).toContain("waitForLiveImagePendingPromptStable");
    expect(content).toContain("guiPromptNotDuplicated");
    expect(content).toContain("turnStartTraceCount");
    expect(content).toContain("singleTurnStartTrace");
    expect(content).toContain("promptOccurrenceCount");
    expect(content).toContain("imagePromptOccurrenceCount");
    expect(content).toContain("hasNonCardAssistantText");
    expect(content).toContain("coreImagePromptText");
    expect(content).toContain("normalizeTextForLooseMatch");
    expect(content).toContain("Image Generation|图片生成");
    expect(content).toContain("data-model-id");
    expect(content).toContain("modelIdToVisibleLabel");
    expect(content).toContain("hasLoadedImage");
    expect(content).toContain("tokenVisible");
    expect(content).toContain("rightSurfaceVisible === false");
    expect(content).toContain("guiRightSurfaceNotAutoOpen");
    expect(content).toContain("guiInternalFieldsHidden");
    expect(content).toContain("Ribbi");
    expect(content).toContain(".lime/tasks");
    expect(content).toContain("request_metadata");
    expect(content).toContain("raw_transport_payload");
    expect(content).toContain("{task_id}");
  });

  it("checks backend audit facts through current App Server methods", () => {
    const content = readLiveSmokeContent();
    const constantsContent = fs.readFileSync(
      "scripts/lib/chat-fixture/constants.mjs",
      "utf8",
    );

    expect(content).toContain("APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_LIST");
    expect(content).toContain("APP_SERVER_METHOD_MEDIA_TASK_ARTIFACT_GET");
    expect(content).toContain("APP_SERVER_METHOD_WORKFLOW_READ");
    expect(content).toContain("APP_SERVER_METHOD_SESSION_READ");
    expect(constantsContent).toContain("mediaTaskArtifact/list");
    expect(constantsContent).toContain("mediaTaskArtifact/get");
    expect(constantsContent).toContain("workflow/read");
    expect(constantsContent).toContain("thread/read");
    expect(content).toContain("summarizeTaskAuditLog");
    expect(content).toContain("path.join(workspace.rootPath, taskFileRef)");
    expect(content).toContain("taskAuditJsonlWritten");
    expect(content).toContain("taskAuditJsonlNoSensitiveTokens");
    expect(content).toContain("worker_loaded");
    expect(content).toContain("task_succeeded");
    expect(content).toContain("workflowReadRedacted");
    expect(content).toContain("containsPrompt === false");
    expect(content).toContain("containsTaskPath === false");
  });

  it("does not revive the old presentation-unavailable half-success event", () => {
    const productionContent = [
      "lime-rs/crates/app-server/src/runtime_backend/image_command/mod.rs",
      "lime-rs/crates/app-server/src/runtime_backend/image_command/events.rs",
      "src/lib/api/agentProtocol.ts",
      "src/lib/api/agentRuntime/appServerEventStream.ts",
      "src/components/agent/chat/hooks/agentStreamRuntimeHandler.ts",
    ]
      .map((filePath) => fs.readFileSync(filePath, "utf8"))
      .join("\n");

    expect(productionContent).not.toContain(
      "image_task.presentation.unavailable",
    );
    expect(productionContent).not.toContain(
      "image_task_presentation_unavailable",
    );
    expect(productionContent).not.toContain("emit_presentation_unavailable");
    expect(productionContent).toContain("image_task_presentation_failed");
    expect(productionContent).toContain(
      "image_task_presentation_runtime_unavailable",
    );
    expect(productionContent).toContain("image_task.create_failed");
  });
});
