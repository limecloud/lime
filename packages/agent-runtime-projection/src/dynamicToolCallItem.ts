import type {
  AgentUiPhase,
  AgentUiProjectionContext,
  AgentUiProjectionEvent,
  AgentUiRuntimeStatus,
} from "@limecloud/agent-ui-contracts";

import { buildAgentUiProjectionBase } from "./envelope.js";
import {
  compactProjectionFields,
  definedString,
  readBooleanField,
  readRecord,
  readStringField,
  truncateText,
} from "./normalization.js";

export type AgentUiDynamicToolSource = "dynamic" | "extension";

export type AgentUiDynamicToolCallStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "unknown";

export type AgentUiDynamicToolContentItemType = "input_text" | "input_image";

export type AgentUiDynamicToolIssueCode =
  | "legacy_flat_dynamic_spec"
  | "missing_namespace_name"
  | "missing_tool_name"
  | "missing_tool_description"
  | "missing_input_schema"
  | "duplicate_tool_in_namespace"
  | "deferred_tool_model_visible"
  | "visible_tool_not_model_visible"
  | "extension_executor_not_model_visible"
  | "extension_executor_not_dispatchable"
  | "missing_call_id"
  | "missing_call_tool"
  | "missing_call_status"
  | "missing_call_arguments"
  | "missing_call_namespace"
  | "unknown_dynamic_tool"
  | "content_items_lost"
  | "remote_image_response_not_rejected"
  | "success_status_mismatch";

export interface AgentUiDynamicToolIssue {
  code: AgentUiDynamicToolIssueCode;
  path: string;
  message: string;
}

export interface AgentUiDynamicToolSpecSnapshot {
  ref: string;
  source: AgentUiDynamicToolSource;
  namespace?: string;
  name: string;
  description?: string;
  hasInputSchema: boolean;
  deferLoading: boolean;
}

export interface AgentUiDynamicToolContentItemSnapshot {
  type: AgentUiDynamicToolContentItemType;
  textPreview?: string;
  imageUrl?: string;
  detail?: string;
  isRemoteImage?: boolean;
}

export interface AgentUiDynamicToolCallItemSnapshot {
  id?: string;
  namespace?: string;
  tool?: string;
  toolRef?: string;
  argumentsPresent: boolean;
  status: AgentUiDynamicToolCallStatus;
  success?: boolean;
  errorPreview?: string;
  contentItems: AgentUiDynamicToolContentItemSnapshot[];
}

export interface AgentUiDynamicToolCallProjectionInput {
  dynamicTools?: unknown;
  extensionToolExecutors?: unknown;
  modelVisibleSpecs?: unknown;
  dispatchableTools?: unknown;
  item?: unknown;
  dynamicToolCallItem?: unknown;
  response?: unknown;
}

export interface AgentUiDynamicToolCallProjectionSnapshot {
  tools: AgentUiDynamicToolSpecSnapshot[];
  expectedModelVisibleToolRefs: string[];
  observedModelVisibleToolRefs: string[];
  deferredToolRefs: string[];
  dispatchableToolRefs: string[];
  call: AgentUiDynamicToolCallItemSnapshot;
  namespaceQualified: boolean;
  deferredToolsHidden: boolean;
  extensionExecutorsReady: boolean;
  contentItemsPreserved: boolean;
  validationIssues: AgentUiDynamicToolIssue[];
}

interface ParsedToolSpec {
  tool: AgentUiDynamicToolSpecSnapshot;
  path: string;
}

function issue(
  code: AgentUiDynamicToolIssueCode,
  path: string,
  message: string,
): AgentUiDynamicToolIssue {
  return { code, path, message };
}

function readArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function inputSchema(record: Record<string, unknown>): unknown {
  return record.inputSchema ?? record.input_schema;
}

function hasInputSchema(record: Record<string, unknown>): boolean {
  return inputSchema(record) !== undefined;
}

function toolRef(namespace: string | undefined, name: string): string {
  return namespace ? `${namespace}::${name}` : name;
}

function normalizeStatus(
  value: string | null | undefined,
): AgentUiDynamicToolCallStatus {
  switch (value) {
    case "in_progress":
    case "inProgress":
    case "InProgress":
      return "in_progress";
    case "completed":
    case "Completed":
      return "completed";
    case "failed":
    case "Failed":
      return "failed";
    default:
      return "unknown";
  }
}

function parseFunctionSpec(
  value: unknown,
  path: string,
  namespace: string | undefined,
  source: AgentUiDynamicToolSource,
): ParsedToolSpec | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const name = readStringField(record, [
    "name",
    "tool",
    "toolName",
    "tool_name",
  ]);
  if (!name) {
    return undefined;
  }
  const description = readStringField(record, ["description"]);
  const deferLoading =
    readBooleanField(record, ["deferLoading", "defer_loading"]) === true;
  return {
    path,
    tool: compactProjectionFields({
      ref: toolRef(namespace, name),
      source,
      namespace,
      name,
      description,
      hasInputSchema: hasInputSchema(record),
      deferLoading,
    } satisfies AgentUiDynamicToolSpecSnapshot),
  };
}

function parseDynamicToolSpecs(
  value: unknown,
  source: AgentUiDynamicToolSource,
  path: string,
  issues: AgentUiDynamicToolIssue[],
): ParsedToolSpec[] {
  return readArray(value).flatMap((entry, index) => {
    const entryPath = `${path}[${index}]`;
    const record = readRecord(entry);
    if (!record) return [];
    const type = readStringField(record, ["type"]);
    if (type === "function") {
      const parsed = parseFunctionSpec(entry, entryPath, undefined, source);
      return parsed ? [parsed] : [];
    }
    if (type === "namespace") {
      const namespace = readStringField(record, ["name", "namespace"]);
      if (!namespace) {
        issues.push(
          issue(
            "missing_namespace_name",
            `${entryPath}.name`,
            "Dynamic namespace specs must preserve the namespace name.",
          ),
        );
      }
      return readArray(record.tools).flatMap((tool, toolIndex) => {
        const toolPath = `${entryPath}.tools[${toolIndex}]`;
        const parsed = parseFunctionSpec(tool, toolPath, namespace, source);
        return parsed ? [parsed] : [];
      });
    }
    if (
      record.namespace !== undefined ||
      record.exposeToContext !== undefined
    ) {
      issues.push(
        issue(
          "legacy_flat_dynamic_spec",
          entryPath,
          "Lime dynamic tools must use canonical function/namespace specs.",
        ),
      );
    }
    return [];
  });
}

function parseExtensionExecutors(
  value: unknown,
  issues: AgentUiDynamicToolIssue[],
): ParsedToolSpec[] {
  return readArray(value).flatMap((entry, index) => {
    const record = readRecord(entry);
    if (!record) return [];
    const namespace =
      readStringField(record, ["namespace", "callableNamespace"]) ??
      "extension/";
    const normalized = {
      type: "function",
      name: readStringField(record, ["name", "tool", "toolName"]),
      description: readStringField(record, ["description"]) ?? "Extension tool",
      inputSchema: inputSchema(record) ?? {
        type: "object",
      },
      deferLoading: readBooleanField(record, ["deferLoading", "defer_loading"]),
    };
    const parsed = parseFunctionSpec(
      normalized,
      `$.extensionToolExecutors[${index}]`,
      namespace,
      "extension",
    );
    if (!parsed) {
      issues.push(
        issue(
          "missing_tool_name",
          `$.extensionToolExecutors[${index}].name`,
          "Extension tool executors must preserve a dispatchable tool name.",
        ),
      );
    }
    return parsed ? [parsed] : [];
  });
}

function dispatchableToolRefs(value: unknown): string[] {
  return readArray(value)
    .map((entry) => {
      if (typeof entry === "string") return definedString(entry);
      const record = readRecord(entry);
      if (!record) return undefined;
      const namespace = readStringField(record, [
        "namespace",
        "callableNamespace",
        "serverId",
        "server_id",
      ]);
      const name = readStringField(record, [
        "name",
        "tool",
        "toolName",
        "tool_name",
      ]);
      return name ? toolRef(namespace, name) : undefined;
    })
    .filter((ref): ref is string => Boolean(ref));
}

function contentItem(
  value: unknown,
): AgentUiDynamicToolContentItemSnapshot | undefined {
  const record = readRecord(value);
  if (!record) return undefined;
  const type = readStringField(record, ["type"]);
  if (type === "inputText" || type === "input_text") {
    const text = readStringField(record, ["text"]);
    return compactProjectionFields({
      type: "input_text",
      textPreview: truncateText(text),
    } satisfies AgentUiDynamicToolContentItemSnapshot);
  }
  if (type === "inputImage" || type === "input_image") {
    const imageUrl = readStringField(record, ["imageUrl", "image_url", "url"]);
    return compactProjectionFields({
      type: "input_image",
      imageUrl,
      detail: readStringField(record, ["detail"]),
      isRemoteImage: Boolean(imageUrl && /^https?:\/\//i.test(imageUrl)),
    } satisfies AgentUiDynamicToolContentItemSnapshot);
  }
  return undefined;
}

function itemRecord(
  input: AgentUiDynamicToolCallProjectionInput,
): Record<string, unknown> {
  return readRecord(input.dynamicToolCallItem) ?? readRecord(input.item) ?? {};
}

function responseRecord(
  input: AgentUiDynamicToolCallProjectionInput,
): Record<string, unknown> | undefined {
  return readRecord(input.response);
}

function callContentItems(
  item: Record<string, unknown>,
  response: Record<string, unknown> | undefined,
): AgentUiDynamicToolContentItemSnapshot[] {
  return [
    ...readArray(item.contentItems ?? item.content_items),
    ...readArray(response?.contentItems ?? response?.content_items),
  ]
    .map(contentItem)
    .filter((entry): entry is AgentUiDynamicToolContentItemSnapshot =>
      Boolean(entry),
    );
}

function extractCallSnapshot(
  input: AgentUiDynamicToolCallProjectionInput,
): AgentUiDynamicToolCallItemSnapshot {
  const item = itemRecord(input);
  const response = responseRecord(input);
  const namespace = readStringField(item, ["namespace"]);
  const tool = readStringField(item, ["tool", "name", "toolName", "tool_name"]);
  const success =
    readBooleanField(item, ["success"]) ??
    readBooleanField(response, ["success"]);
  const status = normalizeStatus(readStringField(item, ["status"]));
  return compactProjectionFields({
    id: readStringField(item, ["id", "callId", "call_id", "toolCallId"]),
    namespace,
    tool,
    toolRef: tool ? toolRef(namespace, tool) : undefined,
    argumentsPresent: item.arguments !== undefined,
    status,
    success,
    errorPreview: truncateText(readStringField(item, ["error"])),
    contentItems: callContentItems(item, response),
  } satisfies AgentUiDynamicToolCallItemSnapshot);
}

function validateSpecs(
  tools: readonly ParsedToolSpec[],
): AgentUiDynamicToolIssue[] {
  const issues: AgentUiDynamicToolIssue[] = [];
  const refs = new Map<string, string>();
  for (const { tool, path } of tools) {
    if (tool.namespace === "") {
      issues.push(
        issue(
          "missing_namespace_name",
          `${path}.namespace`,
          "Namespaced dynamic tools must preserve a namespace.",
        ),
      );
    }
    if (!tool.name) {
      issues.push(
        issue(
          "missing_tool_name",
          `${path}.name`,
          "Dynamic tool specs must preserve the tool name.",
        ),
      );
    }
    if (!tool.description) {
      issues.push(
        issue(
          "missing_tool_description",
          `${path}.description`,
          "Dynamic tool specs must preserve the tool description.",
        ),
      );
    }
    if (!tool.hasInputSchema) {
      issues.push(
        issue(
          "missing_input_schema",
          `${path}.inputSchema`,
          "Dynamic tool specs must preserve the input schema.",
        ),
      );
    }
    const previousPath = refs.get(tool.ref);
    if (previousPath) {
      issues.push(
        issue(
          "duplicate_tool_in_namespace",
          path,
          `Dynamic tool ${tool.ref} duplicates ${previousPath}.`,
        ),
      );
    } else {
      refs.set(tool.ref, path);
    }
  }
  return issues;
}

function validateInventoryVisibility(
  tools: readonly AgentUiDynamicToolSpecSnapshot[],
  observedVisibleToolRefs: readonly string[],
  dispatchableRefs: readonly string[],
  hasObservedVisibleSpecs: boolean,
): AgentUiDynamicToolIssue[] {
  const issues: AgentUiDynamicToolIssue[] = [];
  const visible = new Set(observedVisibleToolRefs);
  for (const tool of tools) {
    if (tool.deferLoading && visible.has(tool.ref)) {
      issues.push(
        issue(
          "deferred_tool_model_visible",
          "$.modelVisibleSpecs",
          `${tool.ref} is defer-loading and must not be model-visible before discovery.`,
        ),
      );
    }
    if (
      hasObservedVisibleSpecs &&
      !tool.deferLoading &&
      !visible.has(tool.ref)
    ) {
      issues.push(
        issue(
          "visible_tool_not_model_visible",
          "$.modelVisibleSpecs",
          `${tool.ref} is non-deferred and must be model-visible.`,
        ),
      );
    }
    if (
      tool.source === "extension" &&
      hasObservedVisibleSpecs &&
      !visible.has(tool.ref)
    ) {
      issues.push(
        issue(
          "extension_executor_not_model_visible",
          "$.modelVisibleSpecs",
          `${tool.ref} extension executor must be model-visible.`,
        ),
      );
    }
    if (tool.source === "extension" && !dispatchableRefs.includes(tool.ref)) {
      issues.push(
        issue(
          "extension_executor_not_dispatchable",
          "$.dispatchableTools",
          `${tool.ref} extension executor must be dispatchable by namespace and name.`,
        ),
      );
    }
  }
  return issues;
}

function validateCall(
  call: AgentUiDynamicToolCallItemSnapshot,
  tools: readonly AgentUiDynamicToolSpecSnapshot[],
): AgentUiDynamicToolIssue[] {
  const issues: AgentUiDynamicToolIssue[] = [];
  if (!call.id) {
    issues.push(
      issue(
        "missing_call_id",
        "$.item.id",
        "Dynamic tool call items must preserve the call id.",
      ),
    );
  }
  if (!call.tool) {
    issues.push(
      issue(
        "missing_call_tool",
        "$.item.tool",
        "Dynamic tool call items must preserve the tool name.",
      ),
    );
  }
  if (call.status === "unknown") {
    issues.push(
      issue(
        "missing_call_status",
        "$.item.status",
        "Dynamic tool call items must preserve in_progress/completed/failed status.",
      ),
    );
  }
  if (!call.argumentsPresent) {
    issues.push(
      issue(
        "missing_call_arguments",
        "$.item.arguments",
        "Dynamic tool call items must preserve arguments.",
      ),
    );
  }

  if (call.tool && tools.length > 0) {
    const sameName = tools.filter((tool) => tool.name === call.tool);
    const hasTopLevel = sameName.some((tool) => !tool.namespace);
    const ref = call.toolRef;
    if (
      !call.namespace &&
      sameName.some((tool) => tool.namespace) &&
      !hasTopLevel
    ) {
      issues.push(
        issue(
          "missing_call_namespace",
          "$.item.namespace",
          "Namespaced dynamic tool calls must not fall back to naked tool-name matching.",
        ),
      );
    } else if (ref && !tools.some((tool) => tool.ref === ref)) {
      issues.push(
        issue(
          "unknown_dynamic_tool",
          "$.item.tool",
          `${ref} is not present in the dynamic tool inventory.`,
        ),
      );
    }
  }

  if (
    call.status !== "in_progress" &&
    call.success !== undefined &&
    call.contentItems.length === 0 &&
    !call.errorPreview
  ) {
    issues.push(
      issue(
        "content_items_lost",
        "$.item.contentItems",
        "Completed dynamic tool calls must preserve structured content items or an error.",
      ),
    );
  }

  if (
    call.contentItems.some(
      (entry) => entry.type === "input_image" && entry.isRemoteImage,
    ) &&
    call.status !== "failed" &&
    call.success !== false
  ) {
    issues.push(
      issue(
        "remote_image_response_not_rejected",
        "$.item.contentItems",
        "Remote HTTP image responses must become a model-visible error instead of successful image content.",
      ),
    );
  }
  if (call.status === "failed" && call.success === true) {
    issues.push(
      issue(
        "success_status_mismatch",
        "$.item.success",
        "Failed dynamic tool calls cannot be marked success=true.",
      ),
    );
  }
  if (call.status === "completed" && call.success === false) {
    issues.push(
      issue(
        "success_status_mismatch",
        "$.item.success",
        "Completed dynamic tool calls cannot be marked success=false.",
      ),
    );
  }
  return issues;
}

function runtimeStatus(
  issues: readonly AgentUiDynamicToolIssue[],
): AgentUiRuntimeStatus {
  return issues.length > 0 ? "failed" : "completed";
}

function phaseForStatus(status: AgentUiDynamicToolCallStatus): AgentUiPhase {
  if (status === "failed") return "failed";
  if (status === "completed") return "completed";
  return "acting";
}

export function extractDynamicToolCallProjectionSnapshot(
  input: AgentUiDynamicToolCallProjectionInput,
): AgentUiDynamicToolCallProjectionSnapshot {
  const issues: AgentUiDynamicToolIssue[] = [];
  const dynamicTools = parseDynamicToolSpecs(
    input.dynamicTools,
    "dynamic",
    "$.dynamicTools",
    issues,
  );
  const extensionTools = parseExtensionExecutors(
    input.extensionToolExecutors,
    issues,
  );
  const tools = [...dynamicTools, ...extensionTools];
  const toolSnapshots = tools.map((entry) => entry.tool);
  const observedVisible = parseDynamicToolSpecs(
    input.modelVisibleSpecs,
    "dynamic",
    "$.modelVisibleSpecs",
    issues,
  ).map((entry) => entry.tool.ref);
  const hasObservedVisibleSpecs = readArray(input.modelVisibleSpecs).length > 0;
  const dispatchableRefs = dispatchableToolRefs(input.dispatchableTools);
  const call = extractCallSnapshot(input);

  issues.push(
    ...validateSpecs(tools),
    ...validateInventoryVisibility(
      toolSnapshots,
      observedVisible,
      dispatchableRefs,
      hasObservedVisibleSpecs,
    ),
    ...validateCall(call, toolSnapshots),
  );

  const deferredToolRefs = toolSnapshots
    .filter((tool) => tool.deferLoading)
    .map((tool) => tool.ref);
  const expectedModelVisibleToolRefs = toolSnapshots
    .filter((tool) => !tool.deferLoading)
    .map((tool) => tool.ref);

  return {
    tools: toolSnapshots,
    expectedModelVisibleToolRefs,
    observedModelVisibleToolRefs: observedVisible,
    deferredToolRefs,
    dispatchableToolRefs: dispatchableRefs,
    call,
    namespaceQualified: Boolean(call.namespace) || !call.tool,
    deferredToolsHidden: !deferredToolRefs.some((ref) =>
      observedVisible.includes(ref),
    ),
    extensionExecutorsReady: !issues.some(
      (entry) =>
        entry.code === "extension_executor_not_model_visible" ||
        entry.code === "extension_executor_not_dispatchable",
    ),
    contentItemsPreserved:
      call.status === "in_progress" ||
      call.contentItems.length > 0 ||
      Boolean(call.errorPreview),
    validationIssues: issues,
  };
}

export function buildDynamicToolCallItemProjectionEvent(
  input: AgentUiDynamicToolCallProjectionInput,
  context: AgentUiProjectionContext = {},
): AgentUiProjectionEvent {
  const snapshot = extractDynamicToolCallProjectionSnapshot(input);
  return {
    ...buildAgentUiProjectionBase(
      { sourceType: "dynamic_tool_call_item_projection" },
      context,
    ),
    type: "tool.changed",
    sequence: context.sequence,
    toolCallId: snapshot.call.id,
    owner: "tool",
    scope: "tool_call",
    phase: phaseForStatus(snapshot.call.status),
    surface: "tool_ui",
    persistence: "snapshot",
    runtimeEntity: "agent_turn",
    runtimeStatus: runtimeStatus(snapshot.validationIssues),
    payload: {
      tools: snapshot.tools,
      expectedModelVisibleToolRefs: snapshot.expectedModelVisibleToolRefs,
      observedModelVisibleToolRefs: snapshot.observedModelVisibleToolRefs,
      deferredToolRefs: snapshot.deferredToolRefs,
      dispatchableToolRefs: snapshot.dispatchableToolRefs,
      call: snapshot.call,
      namespaceQualified: snapshot.namespaceQualified,
      deferredToolsHidden: snapshot.deferredToolsHidden,
      extensionExecutorsReady: snapshot.extensionExecutorsReady,
      contentItemsPreserved: snapshot.contentItemsPreserved,
      validationIssues: snapshot.validationIssues,
    },
    refs:
      snapshot.validationIssues.length > 0
        ? {
            diagnosticKeys: snapshot.validationIssues.map(
              (entry) => entry.code,
            ),
          }
        : undefined,
  };
}
