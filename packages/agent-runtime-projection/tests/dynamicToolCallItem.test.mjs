import test from "node:test";
import assert from "node:assert/strict";

import {
  buildDynamicToolCallItemProjectionEvent,
  extractDynamicToolCallProjectionSnapshot,
} from "../dist/index.js";

const DATA_URL = "data:image/png;base64,abc123";
const REMOTE_IMAGE_ERROR =
  "Remote image URLs are not supported for dynamic tool responses.";

function functionTool(name, overrides = {}) {
  return {
    type: "function",
    name,
    description: `${name} description`,
    inputSchema: {
      type: "object",
      additionalProperties: false,
    },
    ...overrides,
  };
}

function namespaceTool(name, tools, overrides = {}) {
  return {
    type: "namespace",
    name,
    description: `${name} namespace`,
    tools,
    ...overrides,
  };
}

function modelVisibleSpec() {
  return [
    namespaceTool("lime_app", [functionTool("visible_dynamic_tool")]),
    namespaceTool("extension/", [functionTool("echo")]),
  ];
}

function baseInput(overrides = {}) {
  return {
    dynamicTools: [
      namespaceTool("lime_app", [
        functionTool("hidden_dynamic_tool", { deferLoading: true }),
        functionTool("visible_dynamic_tool"),
      ]),
    ],
    extensionToolExecutors: [
      {
        namespace: "extension/",
        name: "echo",
        description: "Echo extension tool",
        inputSchema: {
          type: "object",
          properties: {
            message: { type: "string" },
          },
        },
      },
    ],
    modelVisibleSpecs: modelVisibleSpec(),
    dispatchableTools: [
      {
        namespace: "extension/",
        name: "echo",
      },
    ],
    item: {
      id: "dyn-call-1",
      namespace: "lime_app",
      tool: "visible_dynamic_tool",
      arguments: {
        path: "README.md",
      },
      status: "completed",
      contentItems: [
        {
          type: "input_text",
          text: "dynamic-ok",
        },
        {
          type: "input_image",
          image_url: DATA_URL,
          detail: "high",
        },
      ],
      success: true,
    },
    ...overrides,
  };
}

test("dynamic tool inventory preserves namespaces and hides deferred tools", () => {
  const event = buildDynamicToolCallItemProjectionEvent(baseInput(), {
    sessionId: "session-dynamic",
    threadId: "thread-dynamic",
    turnId: "turn-dynamic",
    sequence: 301,
    timestamp: "2026-07-09T00:00:00.000Z",
  });

  assert.deepEqual(
    {
      type: event.type,
      sourceType: event.sourceType,
      sequence: event.sequence,
      sessionId: event.sessionId,
      threadId: event.threadId,
      turnId: event.turnId,
      toolCallId: event.toolCallId,
      owner: event.owner,
      scope: event.scope,
      phase: event.phase,
      surface: event.surface,
      persistence: event.persistence,
      runtimeEntity: event.runtimeEntity,
      runtimeStatus: event.runtimeStatus,
    },
    {
      type: "tool.changed",
      sourceType: "dynamic_tool_call_item_projection",
      sequence: 301,
      sessionId: "session-dynamic",
      threadId: "thread-dynamic",
      turnId: "turn-dynamic",
      toolCallId: "dyn-call-1",
      owner: "tool",
      scope: "tool_call",
      phase: "completed",
      surface: "tool_ui",
      persistence: "snapshot",
      runtimeEntity: "agent_turn",
      runtimeStatus: "completed",
    },
  );

  assert.deepEqual(event.payload.validationIssues, []);
  assert.deepEqual(event.payload.deferredToolRefs, [
    "lime_app::hidden_dynamic_tool",
  ]);
  assert.equal(event.payload.deferredToolsHidden, true);
  assert.deepEqual(event.payload.expectedModelVisibleToolRefs, [
    "lime_app::visible_dynamic_tool",
    "extension/::echo",
  ]);
  assert.deepEqual(event.payload.observedModelVisibleToolRefs, [
    "lime_app::visible_dynamic_tool",
    "extension/::echo",
  ]);
  assert.deepEqual(event.payload.call.contentItems, [
    {
      type: "input_text",
      textPreview: "dynamic-ok",
    },
    {
      type: "input_image",
      imageUrl: DATA_URL,
      detail: "high",
      isRemoteImage: false,
    },
  ]);
});

test("extension dynamic tools must be both model-visible and dispatchable", () => {
  assert.deepEqual(
    extractDynamicToolCallProjectionSnapshot(baseInput()).validationIssues,
    [],
  );

  const snapshot = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      modelVisibleSpecs: [
        namespaceTool("lime_app", [functionTool("visible_dynamic_tool")]),
      ],
      dispatchableTools: [],
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    [
      "visible_tool_not_model_visible",
      "extension_executor_not_model_visible",
      "extension_executor_not_dispatchable",
    ],
  );
  assert.equal(snapshot.extensionExecutorsReady, false);
});

test("same tool names may coexist across namespaces but duplicate namespace refs fail closed", () => {
  const acrossNamespaces = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      dynamicTools: [
        namespaceTool("lime_app", [functionTool("search")]),
        namespaceTool("project", [functionTool("search")]),
      ],
      modelVisibleSpecs: [
        namespaceTool("lime_app", [functionTool("search")]),
        namespaceTool("project", [functionTool("search")]),
        namespaceTool("extension/", [functionTool("echo")]),
      ],
      item: {
        id: "dyn-search",
        namespace: "project",
        tool: "search",
        arguments: {},
        status: "in_progress",
      },
    }),
  );
  assert.deepEqual(acrossNamespaces.validationIssues, []);

  const duplicate = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      dynamicTools: [
        namespaceTool("lime_app", [
          functionTool("search"),
          functionTool("search"),
        ]),
      ],
      modelVisibleSpecs: [
        namespaceTool("lime_app", [functionTool("search")]),
        namespaceTool("extension/", [functionTool("echo")]),
      ],
      item: {
        id: "dyn-search",
        namespace: "lime_app",
        tool: "search",
        arguments: {},
        status: "in_progress",
      },
    }),
  );
  assert.deepEqual(
    duplicate.validationIssues.map((item) => item.code),
    ["duplicate_tool_in_namespace"],
  );
});

test("naked tool-name matching is rejected for namespaced dynamic calls", () => {
  const snapshot = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      item: {
        id: "dyn-echo",
        tool: "echo",
        arguments: {
          message: "hello",
        },
        status: "completed",
        contentItems: [
          {
            type: "input_text",
            text: "ok",
          },
        ],
        success: true,
      },
    }),
  );

  assert.deepEqual(
    snapshot.validationIssues.map((item) => item.code),
    ["missing_call_namespace"],
  );
});

test("dynamic tool remote image output must be converted to a failed text response", () => {
  const failedText = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      item: {
        id: "dyn-remote-image",
        namespace: "lime_app",
        tool: "visible_dynamic_tool",
        arguments: {},
        status: "failed",
        contentItems: [
          {
            type: "input_text",
            text: REMOTE_IMAGE_ERROR,
          },
        ],
        success: false,
      },
    }),
  );

  assert.deepEqual(failedText.validationIssues, []);
  assert.equal(failedText.call.status, "failed");
  assert.equal(failedText.call.success, false);
  assert.deepEqual(failedText.call.contentItems, [
    {
      type: "input_text",
      textPreview: REMOTE_IMAGE_ERROR,
    },
  ]);

  const leakedRemoteImage = extractDynamicToolCallProjectionSnapshot(
    baseInput({
      item: {
        id: "dyn-remote-image",
        namespace: "lime_app",
        tool: "visible_dynamic_tool",
        arguments: {},
        status: "completed",
        contentItems: [
          {
            type: "input_image",
            image_url: "https://example.com/tool.png",
          },
        ],
        success: true,
      },
    }),
  );

  assert.deepEqual(
    leakedRemoteImage.validationIssues.map((item) => item.code),
    ["remote_image_response_not_rejected"],
  );
});
