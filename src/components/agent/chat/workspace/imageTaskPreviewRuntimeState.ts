import type { Message, MessageImageWorkbenchPreview } from "../types";
import { parseImageWorkbenchCommand } from "../utils/imageWorkbenchCommand";
import {
  buildImageWorkbenchCaption,
  sanitizeImageWorkbenchPresentationText,
} from "../utils/imageWorkbenchPresentation";
import {
  resolveImageWorkbenchAssistantMessageId,
  type ImageWorkbenchOutput,
  type ImageWorkbenchTask,
  type SessionImageWorkbenchState,
} from "./imageWorkbenchHelpers";
import { normalizeImageWorkbenchPreviewIdentityText } from "./imageTaskPreviewRuntimeGuards";
import {
  finalizePreviewMessages,
  mergeImageWorkbenchPreviewMessage,
  previewsReferToSameImageWorkbenchTask,
  upsertPreviewMessage,
} from "./imageTaskPreviewRuntimeMessages";
import {
  buildPreviewImageUrls,
  resolvePreviewPhaseFromWorkbenchTaskStatus,
  resolveTaskLabel,
  resolveTaskLabelFromMode,
  type ParsedImageTaskSnapshot,
} from "./imageTaskPreviewRuntimeSnapshot";

function buildImageWorkbenchMessagePatchFromTask(params: {
  task: ImageWorkbenchTask;
  outputs: ImageWorkbenchOutput[];
  preview: MessageImageWorkbenchPreview;
}): Pick<
  Message,
  | "content"
  | "timestamp"
  | "isThinking"
  | "toolCalls"
  | "contentParts"
  | "runtimeStatus"
> {
  const startedAt = new Date(params.task.createdAt || Date.now());

  return {
    content:
      sanitizeImageTaskDisplayText(
        params.task.assistantIntro,
        params.preview.prompt,
      ) || "",
    timestamp: startedAt,
    isThinking: false,
    toolCalls: undefined,
    contentParts: undefined,
    runtimeStatus: undefined,
  };
}

function sanitizeImageTaskDisplayText(
  value: string | null | undefined,
  languageSource?: string | null,
): string | null {
  if (typeof value !== "string") {
    return null;
  }
  return (
    sanitizeImageWorkbenchPresentationText(value, {
      languageSource,
    }) || value
  );
}

function resolvePreviewStatusFromWorkbenchTask(
  status: ImageWorkbenchTask["status"],
): MessageImageWorkbenchPreview["status"] {
  switch (status) {
    case "complete":
      return "complete";
    case "partial":
      return "partial";
    case "cancelled":
      return "cancelled";
    case "error":
      return "failed";
    case "queued":
    case "routing":
    case "running":
    default:
      return "running";
  }
}

function orderTaskOutputs(
  task: ImageWorkbenchTask,
  outputs: ImageWorkbenchOutput[],
): ImageWorkbenchOutput[] {
  const ordered = task.outputIds
    .map((outputId) => outputs.find((output) => output.id === outputId))
    .filter((output): output is ImageWorkbenchOutput => Boolean(output));
  const remaining = outputs.filter(
    (output) => !ordered.some((item) => item.id === output.id),
  );
  return [...ordered, ...remaining];
}

function buildImageWorkbenchPreviewMessageFromTask(params: {
  task: ImageWorkbenchTask;
  outputs: ImageWorkbenchOutput[];
  projectId?: string | null;
  contentId?: string | null;
}): Message {
  const outputs = orderTaskOutputs(params.task, params.outputs);
  const preferredOutput = outputs[0];
  const previewStatus = resolvePreviewStatusFromWorkbenchTask(
    params.task.status,
  );
  const previewProviderName = preferredOutput?.providerName ?? null;
  const previewModelName =
    preferredOutput?.modelName ?? params.task.runtimeContract?.model ?? null;
  const previewPrompt =
    sanitizeImageTaskDisplayText(params.task.prompt, params.task.prompt) ||
    "图片任务";
  const preview: MessageImageWorkbenchPreview = {
    taskId: params.task.id,
    prompt: previewPrompt,
    mode: params.task.mode,
    status: previewStatus,
    projectId: params.projectId ?? null,
    contentId: params.contentId ?? null,
    taskFilePath: params.task.taskFilePath ?? null,
    artifactPath: params.task.artifactPath ?? null,
    imageUrl: preferredOutput?.url || null,
    previewImages: buildPreviewImageUrls(outputs),
    imageCount:
      outputs.length > 0
        ? outputs.length
        : previewStatus === "running"
          ? params.task.expectedCount
          : undefined,
    expectedImageCount: params.task.expectedCount,
    providerName: previewProviderName,
    modelName: previewModelName,
    caption:
      sanitizeImageTaskDisplayText(params.task.caption, previewPrompt) ||
      buildImageWorkbenchCaption({
        prompt: previewPrompt,
        status: previewStatus,
        imageCount: outputs.length || undefined,
        statusMessage: params.task.failureMessage || null,
      }),
    layoutHint: params.task.layoutHint ?? null,
    storyboardSlots: params.task.storyboardSlots,
    sourceImageUrl: params.task.sourceImageUrl ?? null,
    sourceImagePrompt: params.task.sourceImagePrompt ?? null,
    sourceImageRef: params.task.sourceImageRef ?? null,
    sourceImageCount: params.task.sourceImageCount,
    size: preferredOutput?.size,
    phase: resolvePreviewPhaseFromWorkbenchTaskStatus(params.task.status),
    statusMessage:
      previewStatus === "running"
        ? null
        : params.task.status === "error" || params.task.status === "cancelled"
          ? params.task.failureMessage || null
          : null,
    runtimeContract: params.task.runtimeContract ?? null,
    workflowRun: params.task.workflowRun ?? null,

  };

  return {
    id: resolveImageWorkbenchAssistantMessageId(params.task.id),
    role: "assistant",
    ...buildImageWorkbenchMessagePatchFromTask({
      task: params.task,
      outputs,
      preview,
    }),
    imageWorkbenchPreview: preview,
  };
}

function buildImageWorkbenchUserMessageFromTask(
  task: ImageWorkbenchTask,
): Message | null {
  const fallbackTexts = new Set([
    "图片任务",
    `${resolveTaskLabelFromMode(task.mode)}进行中`,
    `${resolveTaskLabel(task.id, task.mode)}进行中`,
  ]);
  const rawText = (task.rawText || "").trim();
  const promptText = (task.prompt || "").trim();
  const content = rawText || promptText;
  if (!content || fallbackTexts.has(content)) {
    return null;
  }

  return {
    id: `image-workbench:${task.id}:user`,
    role: "user",
    content,
    timestamp: new Date(Math.max(0, (task.createdAt || Date.now()) - 1)),
  };
}

function resolveImageTaskSnapshotProgressScore(params: {
  taskStatus?: ImageWorkbenchTask["status"];
  outputCount: number;
}): number {
  if (params.outputCount === 0) {
    switch (params.taskStatus) {
      case "complete":
        return 0;
      case "error":
      case "cancelled":
        return 4;
      case "partial":
      case "running":
        return 2;
      case "queued":
      case "routing":
        return 1;
      default:
        return 1;
    }
  }

  switch (params.taskStatus) {
    case "complete":
    case "error":
    case "cancelled":
      return 4;
    case "partial":
      return 3;
    case "running":
      return params.outputCount > 0 ? 3 : 2;
    case "queued":
    case "routing":
      return params.outputCount > 0 ? 2 : 1;
    default:
      return params.outputCount > 0 ? 2 : 0;
  }
}

export function mergeImageTaskSnapshot(
  current: SessionImageWorkbenchState,
  snapshot: ParsedImageTaskSnapshot,
): SessionImageWorkbenchState {
  const previousTask = current.tasks.find(
    (task) => task.id === snapshot.taskId,
  );
  const previousOutputs = current.outputs.filter(
    (output) => output.taskId === snapshot.taskId,
  );
  const previousProgressScore = previousTask
    ? resolveImageTaskSnapshotProgressScore({
        taskStatus: previousTask.status,
        outputCount: previousOutputs.length,
      })
    : -1;
  const nextProgressScore = resolveImageTaskSnapshotProgressScore({
    taskStatus: snapshot.task.status,
    outputCount: snapshot.outputs.length,
  });

  if (previousTask && nextProgressScore < previousProgressScore) {
    return current;
  }

  const preservedSelectedOutputId = current.outputs.find(
    (output) =>
      output.id === current.selectedOutputId &&
      output.taskId === snapshot.taskId,
  )?.id;
  const preservedSelectedOutputUrl = current.outputs.find(
    (output) =>
      output.id === current.selectedOutputId &&
      output.taskId === snapshot.taskId,
  )?.url;
  const mergedOutputs = snapshot.outputs.map((output) => {
    const previousOutput = previousOutputs.find(
      (candidate) => candidate.url === output.url,
    );
    return previousOutput
      ? {
          ...previousOutput,
          ...output,
        }
      : output;
  });
  const nextTasks = [
    {
      ...snapshot.task,
      sessionId: previousTask?.sessionId || snapshot.task.sessionId,
      assistantIntro:
        sanitizeImageTaskDisplayText(
          snapshot.task.assistantIntro ?? previousTask?.assistantIntro,
          snapshot.task.prompt || previousTask?.prompt,
        ) ?? null,
      caption:
        sanitizeImageTaskDisplayText(
          snapshot.task.caption ?? previousTask?.caption,
          snapshot.task.prompt || previousTask?.prompt,
        ) ?? null,
      taskFilePath:
        snapshot.task.taskFilePath ?? previousTask?.taskFilePath ?? null,
      artifactPath:
        snapshot.task.artifactPath ?? previousTask?.artifactPath ?? null,
      runtimeContract:
        snapshot.task.runtimeContract ?? previousTask?.runtimeContract ?? null,
      workflowRun:
        snapshot.task.workflowRun ?? previousTask?.workflowRun ?? null,

    },
    ...current.tasks.filter((task) => task.id !== snapshot.taskId),
  ];
  const nextOutputs = [
    ...mergedOutputs,
    ...current.outputs.filter((output) => output.taskId !== snapshot.taskId),
  ];
  const isSelectedSnapshotTask = current.selectedTaskId === snapshot.taskId;
  const selectedOutputId = isSelectedSnapshotTask
    ? preservedSelectedOutputId &&
      mergedOutputs.some((output) => output.id === preservedSelectedOutputId)
      ? preservedSelectedOutputId
      : preservedSelectedOutputUrl
        ? (mergedOutputs.find(
            (output) => output.url === preservedSelectedOutputUrl,
          )?.id ??
          mergedOutputs[0]?.id ??
          null)
        : mergedOutputs[0]?.id || null
    : current.selectedOutputId &&
        nextOutputs.some((output) => output.id === current.selectedOutputId)
      ? current.selectedOutputId
      : nextOutputs[0]?.id || null;
  const selectedTaskId =
    current.selectedTaskId &&
    nextTasks.some((task) => task.id === current.selectedTaskId)
      ? current.selectedTaskId
      : selectedOutputId
        ? (nextOutputs.find((output) => output.id === selectedOutputId)
            ?.taskId ?? null)
        : nextTasks[0]?.id || null;

  return {
    ...current,
    tasks: nextTasks,
    outputs: nextOutputs,
    selectedTaskId,
    selectedOutputId,
  };
}

function normalizeImageTaskConversationText(value?: string | null): string {
  return normalizeImageWorkbenchPreviewIdentityText(value).replace(
    /^@\S+(?:\s+\S+)?\s*/u,
    "",
  );
}

function addImageTaskConversationText(
  values: Set<string>,
  value?: string | null,
) {
  const normalized = normalizeImageTaskConversationText(value);
  if (normalized) {
    values.add(normalized);
  }

  const parsed = value ? parseImageWorkbenchCommand(value) : null;
  const parsedPrompt = normalizeImageTaskConversationText(parsed?.prompt);
  if (parsedPrompt) {
    values.add(parsedPrompt);
  }
}

function buildImageTaskConversationTextSet(params: {
  task?: ImageWorkbenchTask;
  preview: MessageImageWorkbenchPreview;
}): Set<string> {
  const values = new Set<string>();
  addImageTaskConversationText(values, params.preview.prompt);
  addImageTaskConversationText(values, params.task?.prompt);
  addImageTaskConversationText(values, params.task?.rawText);
  return values;
}

function imageTaskConversationTextMatches(
  left: string,
  right: string,
): boolean {
  if (!left || !right) {
    return false;
  }
  if (left === right) {
    return true;
  }

  const minLength = Math.min(left.length, right.length);
  return minLength >= 4 && (left.includes(right) || right.includes(left));
}

function userMessageMatchesImageTask(
  message: Message,
  taskTexts: Set<string>,
): boolean {
  if (message.role !== "user" || taskTexts.size === 0) {
    return false;
  }

  const candidates = new Set<string>();
  addImageTaskConversationText(candidates, message.content);
  for (const candidate of candidates) {
    for (const taskText of taskTexts) {
      if (imageTaskConversationTextMatches(candidate, taskText)) {
        return true;
      }
    }
  }
  return false;
}

function hasUserMessageForImageWorkbenchTask(params: {
  messages: Message[];
  task?: ImageWorkbenchTask;
  preview: MessageImageWorkbenchPreview;
}): boolean {
  const taskTexts = buildImageTaskConversationTextSet({
    task: params.task,
    preview: params.preview,
  });
  if (taskTexts.size === 0) {
    return false;
  }

  return params.messages.some((message) =>
    userMessageMatchesImageTask(message, taskTexts),
  );
}

function hasPrecedingUserMessage(messages: Message[], index: number): boolean {
  return messages.slice(0, index).some((message) => message.role === "user");
}

function ensureImageWorkbenchUserMessagesFromState(params: {
  messages: Message[];
  imageWorkbenchState?: SessionImageWorkbenchState;
}): Message[] {
  const taskById = new Map(
    (params.imageWorkbenchState?.tasks || []).map((task) => [task.id, task]),
  );
  let nextMessages = params.messages;

  for (let index = 0; index < nextMessages.length; index += 1) {
    const message = nextMessages[index];
    const preview = message?.imageWorkbenchPreview;
    if (message?.role !== "assistant" || !preview?.taskId) {
      continue;
    }

    const task = taskById.get(preview.taskId);
    const userMessage = task
      ? buildImageWorkbenchUserMessageFromTask(task)
      : null;
    if (
      !userMessage ||
      hasPrecedingUserMessage(nextMessages, index) ||
      hasUserMessageForImageWorkbenchTask({
        messages: nextMessages,
        task,
        preview,
      })
    ) {
      continue;
    }

    if (nextMessages === params.messages) {
      nextMessages = [...params.messages];
    }
    nextMessages.splice(index, 0, userMessage);
    index += 1;
  }

  return nextMessages;
}

function buildImageWorkbenchPreviewMessagesFromState(params: {
  imageWorkbenchState?: SessionImageWorkbenchState;
  projectId?: string | null;
  contentId?: string | null;
  includeUserMessages?: boolean;
}): Message[] {
  const imageWorkbenchState = params.imageWorkbenchState;
  if (!imageWorkbenchState || imageWorkbenchState.tasks.length === 0) {
    return [];
  }

  const outputsByTaskId = new Map<string, ImageWorkbenchOutput[]>();
  imageWorkbenchState.outputs.forEach((output) => {
    const current = outputsByTaskId.get(output.taskId) || [];
    current.push(output);
    outputsByTaskId.set(output.taskId, current);
  });

  return imageWorkbenchState.tasks
    .slice()
    .sort((left, right) => left.createdAt - right.createdAt)
    .flatMap((task) => {
      const assistantMessage = buildImageWorkbenchPreviewMessageFromTask({
        task,
        outputs: outputsByTaskId.get(task.id) || [],
        projectId: params.projectId,
        contentId: params.contentId,
      });
      const userMessage = params.includeUserMessages
        ? buildImageWorkbenchUserMessageFromTask(task)
        : null;
      return userMessage ? [userMessage, assistantMessage] : [assistantMessage];
    });
}

function attachImageWorkbenchPreviewToMatchingTurn(params: {
  messages: Message[];
  previewMessage: Message;
  task?: ImageWorkbenchTask;
}): { messages: Message[]; attached: boolean } {
  const preview = params.previewMessage.imageWorkbenchPreview;
  if (!preview) {
    return { messages: params.messages, attached: false };
  }

  const taskTexts = buildImageTaskConversationTextSet({
    task: params.task,
    preview,
  });
  if (taskTexts.size === 0) {
    return { messages: params.messages, attached: false };
  }

  for (let index = 0; index < params.messages.length; index += 1) {
    const message = params.messages[index];
    if (!message || !userMessageMatchesImageTask(message, taskTexts)) {
      continue;
    }

    let insertIndex = index + 1;
    for (
      let candidateIndex = index + 1;
      candidateIndex < params.messages.length;
      candidateIndex += 1
    ) {
      const candidate = params.messages[candidateIndex];
      if (!candidate || candidate.role === "user") {
        break;
      }

      insertIndex = candidateIndex + 1;
      if (candidate.role !== "assistant") {
        continue;
      }

      if (
        previewsReferToSameImageWorkbenchTask(
          candidate.imageWorkbenchPreview,
          preview,
        )
      ) {
        return { messages: params.messages, attached: true };
      }

      if (!candidate.imageWorkbenchPreview) {
        const nextMessages = [...params.messages];
        nextMessages[candidateIndex] = mergeImageWorkbenchPreviewMessage({
          existingMessage: candidate,
          nextMessage: params.previewMessage,
        });
        return { messages: nextMessages, attached: true };
      }
    }

    const nextMessages = [...params.messages];
    nextMessages.splice(insertIndex, 0, params.previewMessage);
    return { messages: nextMessages, attached: true };
  }

  return { messages: params.messages, attached: false };
}

function patchMessagesWithImageWorkbenchState(params: {
  messages: Message[];
  imageWorkbenchState?: SessionImageWorkbenchState;
}): Message[] {
  const imageWorkbenchState = params.imageWorkbenchState;
  if (!imageWorkbenchState || params.messages.length === 0) {
    return params.messages;
  }

  const outputsByTaskId = new Map<string, ImageWorkbenchOutput[]>();
  imageWorkbenchState.outputs.forEach((output) => {
    const current = outputsByTaskId.get(output.taskId) || [];
    current.push(output);
    outputsByTaskId.set(output.taskId, current);
  });

  let changed = false;
  const nextMessages = params.messages.map((message) => {
    const preview = message.imageWorkbenchPreview;
    if (!preview?.taskId) {
      return message;
    }

    const task = imageWorkbenchState.tasks.find(
      (item) => item.id === preview.taskId,
    );
    if (!task) {
      return message;
    }

    const outputs = orderTaskOutputs(task, outputsByTaskId.get(task.id) || []);
    const preferredOutput = outputs[0];
    const nextPreviewStatus = resolvePreviewStatusFromWorkbenchTask(
      task.status,
    );
    const nextProviderName =
      preferredOutput?.providerName ?? preview.providerName ?? null;
    const nextModelName =
      preferredOutput?.modelName ??
      task.runtimeContract?.model ??
      preview.runtimeContract?.model ??
      preview.modelName ??
      null;
    const nextPreview: MessageImageWorkbenchPreview = {
      ...preview,
      prompt:
        sanitizeImageTaskDisplayText(
          preview.prompt || task.prompt,
          task.prompt,
        ) ||
        preview.prompt ||
        task.prompt,
      mode: task.mode,
      status: nextPreviewStatus,
      taskFilePath: task.taskFilePath ?? preview.taskFilePath ?? null,
      artifactPath: task.artifactPath ?? preview.artifactPath ?? null,
      imageUrl: preferredOutput?.url || preview.imageUrl || null,
      previewImages:
        outputs.length > 0
          ? buildPreviewImageUrls(outputs)
          : preview.previewImages,
      imageCount: outputs.length > 0 ? outputs.length : preview.imageCount,
      expectedImageCount: task.expectedCount || preview.expectedImageCount,
      providerName: nextProviderName,
      modelName: nextModelName,
      caption:
        sanitizeImageTaskDisplayText(
          task.caption,
          preview.prompt || task.prompt,
        ) ||
        sanitizeImageTaskDisplayText(
          preview.caption,
          preview.prompt || task.prompt,
        ) ||
        buildImageWorkbenchCaption({
          prompt: preview.prompt || task.prompt,
          status: nextPreviewStatus,
          imageCount: outputs.length || preview.imageCount,
          statusMessage: task.failureMessage || preview.statusMessage || null,
        }),
      layoutHint: task.layoutHint ?? preview.layoutHint ?? null,
      storyboardSlots: task.storyboardSlots ?? preview.storyboardSlots,
      sourceImageUrl: task.sourceImageUrl ?? preview.sourceImageUrl ?? null,
      sourceImagePrompt:
        task.sourceImagePrompt ?? preview.sourceImagePrompt ?? null,
      sourceImageRef: task.sourceImageRef ?? preview.sourceImageRef ?? null,
      sourceImageCount: task.sourceImageCount ?? preview.sourceImageCount,
      size: preferredOutput?.size || preview.size,
      phase: resolvePreviewPhaseFromWorkbenchTaskStatus(task.status),
      statusMessage:
        nextPreviewStatus === "running"
          ? (preview.statusMessage ?? null)
          : task.status === "error" || task.status === "cancelled"
            ? task.failureMessage || preview.statusMessage || null
            : null,
      runtimeContract: task.runtimeContract ?? preview.runtimeContract ?? null,
      workflowRun: task.workflowRun ?? preview.workflowRun ?? null,

      retryable:
        typeof preview.retryable === "boolean"
          ? preview.retryable
          : task.status === "error"
            ? false
            : preview.retryable,
    };
    const nextMessage = mergeImageWorkbenchPreviewMessage({
      existingMessage: message,
      nextMessage: {
        ...message,
        ...buildImageWorkbenchMessagePatchFromTask({
          task,
          outputs,
          preview: nextPreview,
        }),
        imageWorkbenchPreview: nextPreview,
      },
    });

    if (nextMessage === message) {
      return message;
    }

    changed = true;
    return nextMessage;
  });

  return finalizePreviewMessages(
    params.messages,
    changed ? nextMessages : params.messages,
  );
}

export function syncMessagesWithImageWorkbenchState(params: {
  messages: Message[];
  imageWorkbenchState?: SessionImageWorkbenchState;
  projectId?: string | null;
  contentId?: string | null;
  allowAppendCachedPreviewMessages?: boolean;
}): Message[] {
  const patchedMessages = ensureImageWorkbenchUserMessagesFromState({
    messages: patchMessagesWithImageWorkbenchState({
      messages: params.messages,
      imageWorkbenchState: params.imageWorkbenchState,
    }),
    imageWorkbenchState: params.imageWorkbenchState,
  });
  if (params.allowAppendCachedPreviewMessages !== true) {
    return patchedMessages;
  }

  const cachedPreviewMessages = buildImageWorkbenchPreviewMessagesFromState({
    imageWorkbenchState: params.imageWorkbenchState,
    projectId: params.projectId,
    contentId: params.contentId,
    includeUserMessages: patchedMessages.length === 0,
  }).filter(
    (candidateMessage) =>
      !patchedMessages.some(
        (message) =>
          message.role === "assistant" &&
          previewsReferToSameImageWorkbenchTask(
            message.imageWorkbenchPreview,
            candidateMessage.imageWorkbenchPreview,
          ),
      ),
  );
  if (cachedPreviewMessages.length === 0) {
    return patchedMessages;
  }

  const taskById = new Map(
    (params.imageWorkbenchState?.tasks || []).map((task) => [task.id, task]),
  );
  let nextMessages = patchedMessages;
  for (const message of cachedPreviewMessages) {
    const preview = message.imageWorkbenchPreview;
    const task = preview?.taskId ? taskById.get(preview.taskId) : undefined;
    if (patchedMessages.length > 0) {
      const attached = attachImageWorkbenchPreviewToMatchingTurn({
        messages: nextMessages,
        previewMessage: message,
        task,
      });
      if (attached.attached) {
        nextMessages = attached.messages;
      }
      continue;
    }

    nextMessages = upsertPreviewMessage(nextMessages, message);
  }
  return finalizePreviewMessages(patchedMessages, nextMessages);
}
