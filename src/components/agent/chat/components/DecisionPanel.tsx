/**
 * DecisionPanel - 权限确认面板
 *
 * 用于显示需要用户确认的操作，如：
 * - 工具调用确认
 * - 用户问题（AskUserQuestion）
 * - 权限请求
 *
 * 参考通用协作代理交互设计
 */

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  HelpCircle,
  Terminal,
  FileEdit,
  Globe,
  Loader2,
} from "lucide-react";
import type { ActionRequired, ConfirmResponse, QuestionOption } from "../types";

interface DecisionPanelProps {
  request: ActionRequired;
  onSubmit: (response: ConfirmResponse) => void | Promise<void>;
}

interface DecisionPanelSubmissionState {
  key: string;
  kind: "allow" | "deny";
}

function isPromiseLike(value: unknown): value is Promise<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof (value as Promise<unknown>).then === "function"
  );
}

function isBrowserPreflightRequest(request: ActionRequired): boolean {
  return request.uiKind === "browser_preflight";
}

/** 获取工具图标 */
function getToolIcon(toolName?: string) {
  if (!toolName) return <HelpCircle className="h-4 w-4" />;

  const name = toolName.toLowerCase();
  if (
    name.includes("bash") ||
    name.includes("terminal") ||
    name.includes("exec")
  ) {
    return <Terminal className="h-4 w-4" />;
  }
  if (
    name.includes("write") ||
    name.includes("edit") ||
    name.includes("file")
  ) {
    return <FileEdit className="h-4 w-4" />;
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("http")) {
    return <Globe className="h-4 w-4" />;
  }
  return <AlertTriangle className="h-4 w-4" />;
}

/** 格式化工具参数 */
function formatArguments(args?: Record<string, unknown>): string {
  if (!args) return "";
  try {
    return JSON.stringify(args, null, 2);
  } catch {
    return String(args);
  }
}

/** 从 requested_schema 中提取 answer.enum 选项 */
function extractElicitationOptions(
  requestedSchema?: Record<string, unknown>,
): string[] {
  if (!requestedSchema) return [];
  const properties = requestedSchema.properties as
    | Record<string, unknown>
    | undefined;
  const answer = properties?.answer as Record<string, unknown> | undefined;
  const enumValues = answer?.enum;
  if (!Array.isArray(enumValues)) return [];
  return enumValues.filter((item): item is string => typeof item === "string");
}

/** 从 requested_schema 中提取 answer.description */
function extractElicitationDescription(
  requestedSchema?: Record<string, unknown>,
): string | undefined {
  if (!requestedSchema) return undefined;
  const properties = requestedSchema.properties as
    | Record<string, unknown>
    | undefined;
  const answer = properties?.answer as Record<string, unknown> | undefined;
  const description = answer?.description;
  return typeof description === "string" ? description : undefined;
}

/** 从问题文本中提取选项（用于 ask_user 缺少 options 的兜底场景） */
function extractAskUserOptionsFromText(text?: string): QuestionOption[] {
  if (!text) return [];

  const normalizedText = text.trim();
  if (!normalizedText) return [];

  const maxOptions = 8;
  const maxLabelLength = 120;
  const seen = new Set<string>();
  const options: QuestionOption[] = [];

  const splitFragments = (raw: string): string[] =>
    raw
      .split(/[、,，;/|]/)
      .map((fragment) => fragment.trim())
      .filter(Boolean);

  const pushOption = (raw: string) => {
    if (options.length >= maxOptions) return;
    const label = raw
      .replace(/\s+/g, " ")
      .replace(/^[\s"'“”‘’`]+/, "")
      .replace(/[\s"'“”‘’`]+$/, "")
      .trim();
    if (!label || label.length > maxLabelLength) return;

    const key = label.toLowerCase();
    if (seen.has(key)) return;

    // 过滤明显不是选项的内容
    if (/^(option|options|choices?|可选项?)[:：]?$/i.test(label)) return;
    if (/^[,，、;；/|]+$/.test(label)) return;

    seen.add(key);
    options.push({ label });
  };

  const quotedPatterns = [
    /"([^"\n]{1,160})"/g,
    /“([^”\n]{1,160})”/g,
    /'([^'\n]{1,160})'/g,
    /‘([^’\n]{1,160})’/g,
    /`([^`\n]{1,160})`/g,
  ];

  for (const pattern of quotedPatterns) {
    for (const match of normalizedText.matchAll(pattern)) {
      pushOption(match[1] ?? "");
      if (options.length >= maxOptions) break;
    }
    if (options.length >= maxOptions) break;
  }

  if (options.length > 0) return options;

  const parenthesizedPattern = /[（(]([^()（）\n]{2,180})[）)]/g;
  for (const match of normalizedText.matchAll(parenthesizedPattern)) {
    const fragments = splitFragments(match[1] ?? "");
    if (fragments.length < 2) continue;
    for (const fragment of fragments) {
      pushOption(fragment);
    }
    if (options.length >= maxOptions) break;
  }

  if (options.length > 0) return options;

  const lineCandidates = normalizedText
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const indexedOrBulletedLines = lineCandidates
    .map((line) =>
      line.match(
        /^(?:[-*•●]\s+|(?:\d+|[A-Za-z]|[一二三四五六七八九十]+)[.()\])]\s+)(.+)$/,
      ),
    )
    .filter((match): match is RegExpMatchArray => Boolean(match))
    .map((match) => match[1]?.trim() ?? "")
    .filter(Boolean);

  if (indexedOrBulletedLines.length >= 2) {
    for (const line of indexedOrBulletedLines) {
      const colonIndex = line.search(/[:：]/);
      const maybeOptionLine =
        colonIndex >= 0 ? line.slice(colonIndex + 1).trim() : line;
      const fragments = splitFragments(maybeOptionLine);
      if (fragments.length >= 2) {
        for (const fragment of fragments) {
          pushOption(fragment);
        }
      } else {
        pushOption(line);
      }
      if (options.length >= maxOptions) break;
    }
  }

  if (options.length > 0) return options;

  const optionLinePattern =
    /(options?|choices?|可选项?|选项)\s*[:：]\s*([^\n]+)/i;
  const lineMatch = normalizedText.match(optionLinePattern);
  if (lineMatch?.[2]) {
    const fragments = splitFragments(lineMatch[2]);
    for (const fragment of fragments) {
      pushOption(fragment);
    }
  }

  return options;
}

/** 运行时归一化 options，兼容字符串数组和对象数组 */
function normalizeQuestionOptions(rawOptions: unknown): QuestionOption[] {
  if (!Array.isArray(rawOptions)) return [];

  const normalized: QuestionOption[] = [];
  const seen = new Set<string>();

  const push = (option: QuestionOption) => {
    const label = option.label.trim();
    if (!label) return;
    const key = label.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    normalized.push({ label, description: option.description });
  };

  for (const option of rawOptions) {
    if (typeof option === "string") {
      push({ label: option });
      continue;
    }

    if (!option || typeof option !== "object") continue;
    const candidate = option as Record<string, unknown>;
    const label =
      (typeof candidate.label === "string" && candidate.label) ||
      (typeof candidate.value === "string" && candidate.value) ||
      (typeof candidate.text === "string" && candidate.text) ||
      "";
    if (!label) continue;

    const description =
      typeof candidate.description === "string"
        ? candidate.description
        : undefined;
    push({ label, description });
  }

  return normalized;
}

function summarizeSubmittedValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    const normalized = value
      .map((item) => summarizeSubmittedValue(item))
      .filter((item): item is string => Boolean(item));
    return normalized.length > 0 ? normalized.join("、") : undefined;
  }

  return undefined;
}

function resolveSubmittedAnswerText(
  request: ActionRequired,
): string | undefined {
  const userData = request.submittedUserData;
  if (typeof userData === "string") {
    const value = userData.trim();
    if (value) return value;
    return undefined;
  }

  if (userData && typeof userData === "object") {
    const record = userData as Record<string, unknown>;
    const directAnswer = summarizeSubmittedValue(record.answer);
    if (directAnswer) {
      return directAnswer;
    }
    if (request.questions && request.questions.length > 0) {
      const firstQuestion = request.questions[0]?.question;
      if (
        typeof firstQuestion === "string" &&
        summarizeSubmittedValue(record[firstQuestion])
      ) {
        return summarizeSubmittedValue(record[firstQuestion]);
      }
    }
    try {
      return JSON.stringify(record);
    } catch {
      return undefined;
    }
  }

  if (typeof request.submittedResponse === "string") {
    const value = request.submittedResponse.trim();
    if (!value) return undefined;
    try {
      const parsed = JSON.parse(value);
      if (typeof parsed === "string" && parsed.trim()) {
        return parsed.trim();
      }
      if (parsed && typeof parsed === "object") {
        const record = parsed as Record<string, unknown>;
        const directAnswer = summarizeSubmittedValue(record.answer);
        if (directAnswer) {
          return directAnswer;
        }
      }
    } catch {
      // 非 JSON，继续使用原始文本
    }
    return value;
  }

  return undefined;
}

export function DecisionPanel({ request, onSubmit }: DecisionPanelProps) {
  const requestAnchorProps = {
    "data-request-id": request.requestId,
    id: `agent-request-${request.requestId}`,
  };
  // 解析问题数据（用于 ask_user 类型）
  const questions = request.questions || [];
  const questionOptions = questions.map((question) => {
    const normalized = normalizeQuestionOptions(question.options);
    if (normalized.length > 0) {
      return normalized;
    }

    const fallbackText = [question.question, question.header, request.prompt]
      .filter(
        (item): item is string =>
          typeof item === "string" && item.trim().length > 0,
      )
      .join("\n");
    return extractAskUserOptionsFromText(fallbackText);
  });
  const elicitationOptions = extractElicitationOptions(request.requestedSchema);
  const elicitationDescription = extractElicitationDescription(
    request.requestedSchema,
  );
  const [selectedOptions, setSelectedOptions] = useState<
    Record<number, string[]>
  >({});
  const [otherInputs, setOtherInputs] = useState<Record<number, string>>({});
  const [elicitationAnswer, setElicitationAnswer] = useState("");
  const [elicitationOther, setElicitationOther] = useState("");
  const [submissionState, setSubmissionState] =
    useState<DecisionPanelSubmissionState | null>(null);
  const isSubmitted = request.status === "submitted";
  const isQueued = request.status === "queued";
  const isSubmitting = submissionState !== null;
  const submittedAnswer = resolveSubmittedAnswerText(request);
  const isFallbackAskPending =
    request.actionType === "ask_user" && request.isFallback;
  const usesQuestionnaireUi =
    questions.length > 0 &&
    (request.actionType === "ask_user" || request.actionType === "elicitation");

  // 重置状态当请求变化时
  useEffect(() => {
    setSelectedOptions({});
    setOtherInputs({});
    setElicitationAnswer("");
    setElicitationOther("");
    setSubmissionState(null);
  }, [request.requestId]);

  const submitResponse = (
    response: ConfirmResponse,
    nextSubmissionState: DecisionPanelSubmissionState,
  ) => {
    if (isSubmitting) {
      return;
    }
    setSubmissionState(nextSubmissionState);
    try {
      const result = onSubmit(response);
      if (isPromiseLike(result)) {
        void result.finally(() => {
          setSubmissionState((current) =>
            current?.key === nextSubmissionState.key ? null : current,
          );
        });
        return;
      }
      setSubmissionState((current) =>
        current?.key === nextSubmissionState.key ? null : current,
      );
    } catch (error) {
      setSubmissionState((current) =>
        current?.key === nextSubmissionState.key ? null : current,
      );
      throw error;
    }
  };

  // 切换选项
  const toggleOption = (
    qIndex: number,
    optionLabel: string,
    multiSelect?: boolean,
  ) => {
    setSelectedOptions((prev) => {
      const current = prev[qIndex] ?? [];
      if (multiSelect) {
        const next = current.includes(optionLabel)
          ? current.filter((label) => label !== optionLabel)
          : [...current, optionLabel];
        return { ...prev, [qIndex]: next };
      }
      return { ...prev, [qIndex]: [optionLabel] };
    });
  };

  // 构建答案
  const buildAnswers = () => {
    const answers: Record<string, string | string[]> = {};
    questions.forEach((q, qIndex) => {
      const selected = selectedOptions[qIndex] ?? [];
      const otherText = otherInputs[qIndex]?.trim() ?? "";
      if (q.multiSelect) {
        const combined = [...selected];
        if (otherText) combined.push(otherText);
        if (combined.length > 0) {
          answers[q.question] = combined;
        }
        return;
      }

      const value = otherText || selected[0] || "";
      if (value) {
        answers[q.question] = value;
      }
    });
    return answers;
  };

  // 检查是否���以提交
  const canSubmit = usesQuestionnaireUi
    ? questions.every((_, qIndex) => {
        const selected = selectedOptions[qIndex] ?? [];
        const otherText = otherInputs[qIndex]?.trim() ?? "";
        return selected.length > 0 || otherText.length > 0;
      })
    : request.actionType === "elicitation"
      ? elicitationAnswer.trim().length > 0 ||
        elicitationOther.trim().length > 0
      : questions.length === 0;

  // 处理允许
  const handleAllow = () => {
    if (usesQuestionnaireUi) {
      const answers = buildAnswers();
      const firstAnswer = Object.values(answers)[0];
      const normalizedAnswers =
        questions.length === 1 && firstAnswer !== undefined
          ? { answer: firstAnswer }
          : answers;
      const response =
        questions.length > 0 ? JSON.stringify(normalizedAnswers) : undefined;
      void submitResponse(
        {
          requestId: request.requestId,
          confirmed: true,
          response,
          actionType: request.actionType,
          userData: questions.length > 0 ? normalizedAnswers : undefined,
        },
        { key: "allow", kind: "allow" },
      );
      return;
    }

    if (request.actionType === "elicitation") {
      const answer = elicitationAnswer.trim();
      const other = elicitationOther.trim();
      const userData: Record<string, string> = {};

      if (answer) {
        userData.answer = answer;
      }
      if (other) {
        userData.other = other;
        if (!userData.answer) {
          userData.answer = other;
        }
      }

      void submitResponse(
        {
          requestId: request.requestId,
          confirmed: true,
          response: JSON.stringify(userData),
          actionType: request.actionType,
          userData,
        },
        { key: "allow", kind: "allow" },
      );
      return;
    }

    void submitResponse(
      {
        requestId: request.requestId,
        confirmed: true,
        response: "允许",
        actionType: request.actionType,
      },
      { key: "allow", kind: "allow" },
    );
  };

  const handleDeny = () => {
    void submitResponse(
      {
        requestId: request.requestId,
        confirmed: false,
        response: "用户拒绝了请求",
        actionType: request.actionType,
        userData:
          request.actionType === "tool_confirmation"
            ? undefined
            : ("" as const),
      },
      { key: "deny", kind: "deny" },
    );
  };

  if (isSubmitted || isQueued) {
    const submittedTitle = isQueued
      ? "已记录你的回答"
      : request.actionType === "tool_confirmation"
        ? "已处理权限请求"
        : "已提交你的回答";
    const submittedClassName = isQueued
      ? "border-sky-200 bg-sky-50/50 dark:border-sky-800 dark:bg-sky-950/20"
      : request.actionType === "tool_confirmation"
        ? "border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
        : request.actionType === "elicitation"
          ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
          : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20";

    return (
      <Card className={submittedClassName} {...requestAnchorProps}>
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium">
            <CheckCircle className="h-4 w-4 text-green-600 dark:text-green-400" />
            {submittedTitle}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {request.prompt && (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {request.prompt}
            </p>
          )}

          {request.questions && request.questions.length > 0 && (
            <div className="space-y-1">
              {request.questions.map((question, index) => (
                <p key={index} className="text-sm text-foreground">
                  {question.question}
                </p>
              ))}
            </div>
          )}

          {submittedAnswer && (
            <div className="rounded-md border bg-background/80 px-3 py-2 text-sm">
              <span className="text-muted-foreground">你的回答：</span>
              <span className="ml-2 font-medium text-foreground">
                {submittedAnswer}
              </span>
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            {isQueued
              ? "答案已记录，等待系统请求 ID 就绪后会自动提交。"
              : "已提交，等待助手继续执行..."}
          </p>
        </CardContent>
      </Card>
    );
  }

  if (isBrowserPreflightRequest(request)) {
    const phase = request.browserPrepState || "idle";
    const isLaunching = phase === "launching";
    const isAwaitingUser =
      phase === "awaiting_user" || phase === "ready_to_resume";
    const isFailed = phase === "failed";
    const allowsFallback = request.allowCapabilityFallback === true;
    const requirementLabel =
      request.browserRequirement === "required_with_user_step"
        ? "必须浏览器执行 · 需要你完成登录/授权"
        : request.browserRequirement === "required"
          ? "必须浏览器执行"
          : "优先浏览器执行";
    const detailText =
      request.detail ||
      (request.browserRequirement === "required_with_user_step"
        ? "请先在浏览器工作台完成登录、扫码、验证码或授权，然后回到原入口重新发起任务。"
        : "请先让浏览器工作台中的页面处于可操作状态，然后回到原入口重新发起任务。");
    const title = isLaunching
      ? "正在准备浏览器执行环境"
      : isAwaitingUser
        ? "请先完成浏览器准备"
        : isFailed
          ? "浏览器未就绪"
          : "此任务需要先准备浏览器";
    const handleBrowserAction = (
      browserAction: "launch" | "continue" | "fallback",
      response: string,
    ) => {
      void submitResponse(
        {
          requestId: request.requestId,
          confirmed: true,
          response,
          actionType: request.actionType,
          userData: {
            answer: response,
            browserAction,
          },
        },
        { key: `browser:${browserAction}:${response}`, kind: "allow" },
      );
    };

    return (
      <Card
        className="border-amber-200 bg-amber-50/60 dark:border-amber-800 dark:bg-amber-950/20"
        {...requestAnchorProps}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200">
            {isLaunching ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isFailed ? (
              <AlertTriangle className="h-4 w-4" />
            ) : (
              <Globe className="h-4 w-4" />
            )}
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <Badge variant="secondary" className="bg-amber-100 text-amber-900">
            {requirementLabel}
          </Badge>
          {request.prompt ? (
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {request.prompt}
            </p>
          ) : null}
          <div className="rounded-lg border border-amber-200/80 bg-background/80 px-3 py-2 text-sm text-muted-foreground dark:border-amber-900/60">
            {detailText}
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {isLaunching ? (
              <Button
                size="sm"
                disabled
                className="bg-amber-600 hover:bg-amber-600"
              >
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                启动中...
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() =>
                  handleBrowserAction(
                    "launch",
                    isFailed ? "重新打开浏览器" : "打开浏览器工作台",
                  )
                }
                className="bg-amber-600 hover:bg-amber-700"
                disabled={isSubmitting}
              >
                {submissionState?.key ===
                `browser:launch:${isFailed ? "重新打开浏览器" : "打开浏览器工作台"}` ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="mr-1 h-4 w-4" />
                )}
                {submissionState?.key ===
                `browser:launch:${isFailed ? "重新打开浏览器" : "打开浏览器工作台"}`
                  ? "启动中..."
                  : isFailed
                    ? "重试打开浏览器"
                    : "打开浏览器工作台"}
              </Button>
            )}

            {isAwaitingUser ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBrowserAction("launch", "重新打开浏览器")}
                disabled={isSubmitting}
              >
                {submissionState?.key === "browser:launch:重新打开浏览器" ? (
                  <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                ) : (
                  <Globe className="mr-1 h-4 w-4" />
                )}
                {submissionState?.key === "browser:launch:重新打开浏览器"
                  ? "处理中..."
                  : "重新打开浏览器"}
              </Button>
            ) : null}

            {allowsFallback ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  handleBrowserAction("fallback", "改为仅做网页检索")
                }
                disabled={isSubmitting}
              >
                {submissionState?.key ===
                "browser:fallback:改为仅做网页检索" ? (
                  <>
                    <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                    处理中...
                  </>
                ) : (
                  "改为仅做网页检索"
                )}
              </Button>
            ) : null}
          </div>
        </CardContent>
      </Card>
    );
  }

  // 渲染 elicitation 面板
  if (request.actionType === "elicitation" && !usesQuestionnaireUi) {
    return (
      <Card
        className="border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
        {...requestAnchorProps}
      >
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-sm font-medium text-indigo-700 dark:text-indigo-300">
            <HelpCircle className="h-4 w-4" />
            需要你提供信息
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-foreground">
            {request.prompt || "请提供继续执行所需的信息"}
          </p>

          {elicitationDescription && (
            <p className="text-xs text-muted-foreground">
              {elicitationDescription}
            </p>
          )}

          {elicitationOptions.length > 0 && (
            <div className="grid gap-2">
              {elicitationOptions.map((option) => {
                const isSelected = elicitationAnswer === option;
                return (
                  <button
                    key={option}
                    type="button"
                    className={cn(
                      "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                      isSelected
                        ? "border-indigo-500 bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-900/30"
                        : "border-border bg-background hover:border-indigo-300 hover:bg-muted",
                      isSubmitting && "cursor-not-allowed opacity-70",
                    )}
                    disabled={isSubmitting}
                    onClick={() => setElicitationAnswer(option)}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              回答
            </label>
            <Input
              placeholder="请输入回答..."
              value={elicitationAnswer}
              disabled={isSubmitting}
              onChange={(e) => setElicitationAnswer(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">
              补充说明（可选）
            </label>
            <Input
              placeholder="可选补充内容..."
              value={elicitationOther}
              disabled={isSubmitting}
              onChange={(e) => setElicitationOther(e.target.value)}
            />
          </div>

          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleAllow}
              disabled={!canSubmit || isSubmitting}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {submissionState?.key === "allow" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-1 h-4 w-4" />
              )}
              {submissionState?.key === "allow" ? "提交中..." : "提交"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeny}
              disabled={isSubmitting}
            >
              {submissionState?.key === "deny" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-4 w-4" />
              )}
              {submissionState?.key === "deny" ? "取消中..." : "取消"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 渲染结构化问题面板（ask_user 或带问题元数据的 elicitation）
  if (
    usesQuestionnaireUi &&
    request.questions &&
    request.questions.length > 0
  ) {
    const questions = request.questions;
    const isQuestionElicitation = request.actionType === "elicitation";
    const cardClassName = isQuestionElicitation
      ? "border-indigo-200 bg-indigo-50/50 dark:border-indigo-800 dark:bg-indigo-950/20"
      : "border-blue-200 bg-blue-50/50 dark:border-blue-800 dark:bg-blue-950/20";
    const titleClassName = isQuestionElicitation
      ? "text-indigo-700 dark:text-indigo-300"
      : "text-blue-700 dark:text-blue-300";
    const primaryButtonClassName = isQuestionElicitation
      ? "bg-indigo-600 hover:bg-indigo-700"
      : "bg-blue-600 hover:bg-blue-700";
    const selectedOptionClassName = isQuestionElicitation
      ? "border-indigo-500 bg-indigo-100 dark:border-indigo-400 dark:bg-indigo-900/30"
      : "border-blue-500 bg-blue-100 dark:border-blue-400 dark:bg-blue-900/30";
    const unselectedOptionClassName = isQuestionElicitation
      ? "border-border bg-background hover:border-indigo-300 hover:bg-muted"
      : "border-border bg-background hover:border-blue-300 hover:bg-muted";

    return (
      <Card className={cardClassName} {...requestAnchorProps}>
        <CardHeader className="pb-2">
          <CardTitle
            className={cn(
              "flex items-center gap-2 text-sm font-medium",
              titleClassName,
            )}
          >
            <HelpCircle className="h-4 w-4" />
            {isQuestionElicitation ? "需要你提供信息" : "助手的问题"}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {isQuestionElicitation && request.prompt && (
            <p className="text-sm text-foreground">{request.prompt}</p>
          )}
          {questions.map((q, qIndex) => (
            <div key={qIndex} className="space-y-3">
              <p className="text-sm text-foreground">{q.question}</p>

              {q.header && (
                <Badge variant="secondary" className="text-xs">
                  {q.header}
                </Badge>
              )}

              {/* 选项列表 */}
              {questionOptions[qIndex] &&
                questionOptions[qIndex].length > 0 && (
                  <div className="grid gap-2">
                    {questionOptions[qIndex].map((option, optIndex) => {
                      const isSelected = (
                        selectedOptions[qIndex] ?? []
                      ).includes(option.label);

                      return (
                        <button
                          key={optIndex}
                          type="button"
                          className={cn(
                            "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                            isSelected
                              ? selectedOptionClassName
                              : unselectedOptionClassName,
                            isSubmitting && "cursor-not-allowed opacity-70",
                          )}
                          disabled={isSubmitting}
                          onClick={() =>
                            toggleOption(qIndex, option.label, q.multiSelect)
                          }
                        >
                          <div className="flex items-center gap-2 font-medium">
                            <span>{option.label}</span>
                          </div>
                          {option.description && (
                            <div className="mt-1 text-xs text-muted-foreground">
                              {option.description}
                            </div>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}

              {/* 其他输入 */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">
                  其他
                </label>
                <Input
                  placeholder="输入你的答案..."
                  value={otherInputs[qIndex] ?? ""}
                  disabled={isSubmitting}
                  onChange={(e) =>
                    setOtherInputs((prev) => ({
                      ...prev,
                      [qIndex]: e.target.value,
                    }))
                  }
                />
              </div>

              {q.multiSelect && (
                <p className="text-xs text-muted-foreground">
                  可以选择多个选项
                </p>
              )}
            </div>
          ))}

          {isFallbackAskPending && (
            <p className="text-xs text-muted-foreground">
              如果系统请求 ID
              还没就绪，你现在提交的答案会先被记录，并在就绪后自动提交。
            </p>
          )}

          {/* 操作按钮 */}
          <div className="flex gap-2 pt-2">
            <Button
              size="sm"
              onClick={handleAllow}
              disabled={!canSubmit || isSubmitting}
              className={primaryButtonClassName}
            >
              {submissionState?.key === "allow" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle className="mr-1 h-4 w-4" />
              )}
              {submissionState?.key === "allow"
                ? isFallbackAskPending
                  ? "记录中..."
                  : "提交中..."
                : isFallbackAskPending
                  ? "记录答案"
                  : "提交答案"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={handleDeny}
              disabled={isSubmitting}
            >
              {submissionState?.key === "deny" ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : (
                <XCircle className="mr-1 h-4 w-4" />
              )}
              {submissionState?.key === "deny" ? "取消中..." : "取消"}
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // 渲染工具确认面板
  return (
    <Card
      className="border-amber-200 bg-amber-50/50 dark:border-amber-800 dark:bg-amber-950/20"
      {...requestAnchorProps}
    >
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm font-medium text-amber-700 dark:text-amber-300">
          <AlertTriangle className="h-4 w-4" />
          权限请求
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 工具信息 */}
        <div className="flex items-center gap-2">
          {getToolIcon(request.toolName)}
          <span className="text-sm">
            助手想要使用：
            <span className="ml-1 font-medium">
              {request.toolName || "未知工具"}
            </span>
          </span>
        </div>

        {/* 参数预览 */}
        {request.arguments && (
          <div className="rounded-lg bg-muted/50 p-3">
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words font-mono text-xs text-muted-foreground">
              {formatArguments(request.arguments)}
            </pre>
          </div>
        )}

        {/* 操作按钮 */}
        <div className="flex gap-2 pt-2">
          <Button
            size="sm"
            onClick={handleAllow}
            className="bg-green-600 hover:bg-green-700"
            disabled={isSubmitting}
          >
            {submissionState?.key === "allow" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle className="mr-1 h-4 w-4" />
            )}
            {submissionState?.key === "allow" ? "处理中..." : "允许"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDeny}
            disabled={isSubmitting}
          >
            {submissionState?.key === "deny" ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <XCircle className="mr-1 h-4 w-4" />
            )}
            {submissionState?.key === "deny" ? "处理中..." : "拒绝"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

/** 权限确认列表组件 */
export function DecisionPanelList({
  requests,
  onSubmit,
}: {
  requests: ActionRequired[];
  onSubmit: (response: ConfirmResponse) => void;
}) {
  if (requests.length === 0) return null;

  return (
    <div className="space-y-3">
      {requests.map((request) => (
        <DecisionPanel
          key={request.requestId}
          request={request}
          onSubmit={onSubmit}
        />
      ))}
    </div>
  );
}

export default DecisionPanel;
