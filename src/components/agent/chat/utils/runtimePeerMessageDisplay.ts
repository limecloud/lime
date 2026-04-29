const TEAMMATE_MESSAGE_RE =
  /<teammate-message\b([^>]*)>([\s\S]*?)<\/teammate-message>/gi;
const CROSS_SESSION_MESSAGE_RE =
  /<cross-session-message\b([^>]*)>([\s\S]*?)<\/cross-session-message>/gi;
const ATTRIBUTE_RE = /([a-zA-Z_:-]+)="([^"]*)"/g;

export type RuntimePeerEnvelopeKind = "teammate" | "cross_session";

export type RuntimePeerMessageBody =
  | {
      kind: "plain";
      markdown: string;
    }
  | {
      kind: "shutdown_request";
      reason: string | null;
    }
  | {
      kind: "shutdown_approved";
    }
  | {
      kind: "shutdown_rejected";
      reason: string | null;
    }
  | {
      kind: "plan_approval_request";
      planFilePath: string | null;
      planContent: string | null;
    }
  | {
      kind: "plan_approval_response";
      approved: boolean | null;
      feedback: string | null;
    }
  | {
      kind: "task_assignment";
      taskId: string | null;
      subject: string | null;
      description: string | null;
      assignedBy: string | null;
    }
  | {
      kind: "task_completed";
      taskId: string | null;
      subject: string | null;
    }
  | {
      kind: "idle_notification";
      summary: string | null;
      completedTaskId: string | null;
      completedStatus: string | null;
    }
  | {
      kind: "teammate_terminated";
      message: string | null;
    };

export interface RuntimePeerEnvelope {
  kind: RuntimePeerEnvelopeKind;
  sender: string;
  summary: string | null;
  rawContent: string;
  body: RuntimePeerMessageBody;
}

interface RuntimePeerEnvelopeMatch extends RuntimePeerEnvelope {
  index: number;
  end: number;
}

function decodeXmlAttributeValue(value: string): string {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function parseXmlAttributes(raw: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  ATTRIBUTE_RE.lastIndex = 0;

  for (const match of raw.matchAll(ATTRIBUTE_RE)) {
    const key = match[1]?.trim();
    const value = match[2];
    if (!key || value === undefined) {
      continue;
    }
    attributes[key] = decodeXmlAttributeValue(value);
  }

  return attributes;
}

function resolveTextValue(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const normalized = value.trim();
  return normalized || null;
}

function resolveBooleanValue(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function parseStructuredPeerMessageBody(
  content: string,
): RuntimePeerMessageBody {
  const trimmed = content.trim();
  if (!trimmed) {
    return {
      kind: "plain",
      markdown: "",
    };
  }

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    if (!payload || Array.isArray(payload)) {
      return {
        kind: "plain",
        markdown: trimmed,
      };
    }

    const messageType = resolveTextValue(payload.type);
    if (!messageType) {
      return {
        kind: "plain",
        markdown: trimmed,
      };
    }

    switch (messageType) {
      case "shutdown_request":
        return {
          kind: "shutdown_request",
          reason: resolveTextValue(payload.reason),
        };
      case "shutdown_approved":
        return {
          kind: "shutdown_approved",
        };
      case "shutdown_rejected":
        return {
          kind: "shutdown_rejected",
          reason: resolveTextValue(payload.reason),
        };
      case "plan_approval_request":
        return {
          kind: "plan_approval_request",
          planFilePath:
            resolveTextValue(payload.plan_file_path) ||
            resolveTextValue(payload.planFilePath),
          planContent:
            resolveTextValue(payload.plan_content) ||
            resolveTextValue(payload.planContent),
        };
      case "plan_approval_response":
        return {
          kind: "plan_approval_response",
          approved:
            resolveBooleanValue(payload.approve) ??
            resolveBooleanValue(payload.approved),
          feedback: resolveTextValue(payload.feedback),
        };
      case "task_assignment":
        return {
          kind: "task_assignment",
          taskId: resolveTextValue(payload.taskId),
          subject: resolveTextValue(payload.subject),
          description: resolveTextValue(payload.description),
          assignedBy: resolveTextValue(payload.assignedBy),
        };
      case "task_completed":
        return {
          kind: "task_completed",
          taskId: resolveTextValue(payload.taskId),
          subject:
            resolveTextValue(payload.taskSubject) ||
            resolveTextValue(payload.subject),
        };
      case "idle_notification":
        return {
          kind: "idle_notification",
          summary: resolveTextValue(payload.summary),
          completedTaskId: resolveTextValue(payload.completedTaskId),
          completedStatus: resolveTextValue(payload.completedStatus),
        };
      case "teammate_terminated":
        return {
          kind: "teammate_terminated",
          message: resolveTextValue(payload.message),
        };
      default:
        return {
          kind: "plain",
          markdown: trimmed,
        };
    }
  } catch {
    return {
      kind: "plain",
      markdown: trimmed,
    };
  }
}

function collectEnvelopeMatches(
  text: string,
  kind: RuntimePeerEnvelopeKind,
  regex: RegExp,
): RuntimePeerEnvelopeMatch[] {
  regex.lastIndex = 0;

  return Array.from(text.matchAll(regex))
    .map((match) => {
      const rawAttributes = match[1] || "";
      const rawContent = match[2] || "";
      const attributes = parseXmlAttributes(rawAttributes);
      const sender =
        kind === "teammate"
          ? resolveTextValue(attributes.teammate_id) || "unknown"
          : resolveTextValue(attributes.from) || "unknown";
      const index = match.index ?? -1;
      if (index < 0) {
        return null;
      }

      return {
        kind,
        sender,
        summary: resolveTextValue(attributes.summary),
        rawContent: rawContent.trim(),
        body: parseStructuredPeerMessageBody(rawContent),
        index,
        end: index + match[0].length,
      } satisfies RuntimePeerEnvelopeMatch;
    })
    .filter((match): match is RuntimePeerEnvelopeMatch => Boolean(match))
    .sort((left, right) => left.index - right.index);
}

function collectAllEnvelopeMatches(text: string): RuntimePeerEnvelopeMatch[] {
  return [
    ...collectEnvelopeMatches(text, "teammate", TEAMMATE_MESSAGE_RE),
    ...collectEnvelopeMatches(text, "cross_session", CROSS_SESSION_MESSAGE_RE),
  ].sort((left, right) => left.index - right.index);
}

function shouldHideRuntimePeerMessageBody(
  body: RuntimePeerMessageBody,
): boolean {
  switch (body.kind) {
    case "shutdown_approved":
    case "idle_notification":
    case "teammate_terminated":
      return true;
    default:
      return false;
  }
}

export function shouldHideRuntimePeerEnvelope(
  envelope: RuntimePeerEnvelope,
): boolean {
  return shouldHideRuntimePeerMessageBody(envelope.body);
}

function formatRuntimePeerMessageBody(body: RuntimePeerMessageBody): string {
  switch (body.kind) {
    case "plain":
      return body.markdown;
    case "shutdown_request":
      return body.reason
        ? `请求结束当前任务：${body.reason}`
        : "请求结束当前任务。";
    case "shutdown_approved":
      return "";
    case "shutdown_rejected":
      return body.reason
        ? `拒绝结束当前任务：${body.reason}`
        : "拒绝结束当前任务。";
    case "plan_approval_request": {
      const header = body.planFilePath
        ? `请求审批计划：${body.planFilePath}`
        : "请求审批计划。";
      return body.planContent ? `${header}\n\n${body.planContent}` : header;
    }
    case "plan_approval_response":
      if (body.approved === true) {
        return "已批准计划，可继续执行。";
      }
      if (body.approved === false) {
        return body.feedback ? `已拒绝计划：${body.feedback}` : "已拒绝计划。";
      }
      return "";
    case "task_assignment": {
      const taskId = body.taskId || "unknown";
      const assignmentPrefix = body.assignedBy
        ? `来自 ${body.assignedBy} 的任务分配`
        : "收到任务分配";
      const header = body.subject
        ? `${assignmentPrefix} #${taskId}：${body.subject}`
        : `${assignmentPrefix} #${taskId}`;
      return body.description ? `${header}\n\n${body.description}` : header;
    }
    case "task_completed": {
      const taskId = body.taskId || "unknown";
      return body.subject
        ? `已完成任务 #${taskId}：${body.subject}`
        : `已完成任务 #${taskId}`;
    }
    case "idle_notification": {
      return "";
    }
    case "teammate_terminated":
      return "";
    default:
      return "";
  }
}

function formatRuntimePeerEnvelope(envelope: RuntimePeerEnvelope): string {
  const headerParts = [
    envelope.kind === "teammate" ? "协作消息" : "跨会话消息",
    envelope.sender,
  ];
  if (envelope.summary) {
    headerParts.push(envelope.summary);
  }
  const header = headerParts.join(" · ");
  const body = formatRuntimePeerMessageBody(envelope.body);
  return body ? `${header}\n\n${body}` : header;
}

export function parseRuntimePeerMessageEnvelopes(
  text: string,
): RuntimePeerEnvelope[] {
  return collectAllEnvelopeMatches(text)
    .filter((envelope) => !shouldHideRuntimePeerEnvelope(envelope))
    .map(({ index: _index, end: _end, ...envelope }) => envelope);
}

export function isPureRuntimePeerMessageText(text: string): boolean {
  const matches = collectAllEnvelopeMatches(text);
  if (matches.length === 0) {
    return false;
  }

  let cursor = 0;
  let hasVisibleEnvelope = false;
  for (const match of matches) {
    if (text.slice(cursor, match.index).trim()) {
      return false;
    }
    if (!shouldHideRuntimePeerEnvelope(match)) {
      hasVisibleEnvelope = true;
    }
    cursor = match.end;
  }

  return hasVisibleEnvelope && text.slice(cursor).trim().length === 0;
}

export function formatRuntimePeerMessageText(text: string): string {
  const matches = collectAllEnvelopeMatches(text);
  if (matches.length === 0) {
    return text;
  }

  const parts: string[] = [];
  let cursor = 0;

  for (const match of matches) {
    const leadingText = text.slice(cursor, match.index).trim();
    if (leadingText) {
      parts.push(leadingText);
    }
    if (!shouldHideRuntimePeerEnvelope(match)) {
      const formatted = formatRuntimePeerEnvelope(match);
      if (formatted) {
        parts.push(formatted);
      }
    }
    cursor = match.end;
  }

  const trailingText = text.slice(cursor).trim();
  if (trailingText) {
    parts.push(trailingText);
  }

  return parts
    .join("\n\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
