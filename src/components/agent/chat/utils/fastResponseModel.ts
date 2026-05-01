import type { ConfiguredProvider } from "@/hooks/useConfiguredProviders";
import type { ChatToolPreferences } from "./chatToolPreferences";

export const AGENT_FAST_RESPONSE_MODE_STORAGE_KEY =
  "lime:agent-fast-response-mode";

export type AgentFastResponseMode = "auto" | "off";

export interface AgentFastResponseDecision {
  enabled: boolean;
  reason: string;
  providerOverride?: string;
  modelOverride?: string;
  label?: string;
}

interface ResolveAgentFastResponseModelOptions {
  mode?: AgentFastResponseMode;
  mappedTheme: string;
  isThemeWorkbench: boolean;
  contentId?: string | null;
  messageCount: number;
  sourceText: string;
  imagesCount: number;
  currentProviderType?: string | null;
  currentModel?: string | null;
  configuredProviders?: ConfiguredProvider[];
  toolPreferences: ChatToolPreferences;
  effectiveWebSearch?: boolean;
  effectiveThinking?: boolean;
  hasExplicitProviderOverride?: boolean;
  hasExplicitModelOverride?: boolean;
  hasServiceModelOverride?: boolean;
  hasCapabilityRoute?: boolean;
  hasSkillRequest?: boolean;
  hasSelectedTeam?: boolean;
  hasMentionedCharacters?: boolean;
  hasContextWorkspace?: boolean;
  hasPurpose?: boolean;
  hasAutoContinue?: boolean;
}

const FAST_RESPONSE_PROVIDER_ALIASES = ["deepseek"] as const;
const FAST_RESPONSE_MODEL_FALLBACK = "deepseek-chat";
const LIGHTWEIGHT_FIRST_TURN_MAX_CHARS = 800;

function disabled(reason: string): AgentFastResponseDecision {
  return { enabled: false, reason };
}

function normalizeIdentifier(value?: string | null): string {
  return value?.trim().toLowerCase() || "";
}

function hasValue(value?: string | null): boolean {
  return Boolean(value?.trim());
}

function normalizeMode(mode?: AgentFastResponseMode): AgentFastResponseMode {
  return mode === "off" ? "off" : "auto";
}

function isConfiguredProviderMatch(provider: ConfiguredProvider): boolean {
  const candidates = [
    provider.key,
    provider.providerId,
    provider.registryId,
    provider.fallbackRegistryId,
    provider.type,
  ].map(normalizeIdentifier);

  return FAST_RESPONSE_PROVIDER_ALIASES.some((alias) =>
    candidates.some((candidate) => candidate.includes(alias)),
  );
}

function resolveProviderSelectionId(
  provider: ConfiguredProvider,
): string | null {
  return provider.providerId?.trim() || provider.key?.trim() || null;
}

function resolveFastResponseModel(provider: ConfiguredProvider): string | null {
  const customModels = provider.customModels || [];
  return (
    customModels.find(
      (model) =>
        normalizeIdentifier(model) ===
        normalizeIdentifier(FAST_RESPONSE_MODEL_FALLBACK),
    ) || FAST_RESPONSE_MODEL_FALLBACK
  );
}

function findFastResponseProvider(
  providers: ConfiguredProvider[] | undefined,
): ConfiguredProvider | null {
  return (
    providers?.find(
      (provider) =>
        isConfiguredProviderMatch(provider) &&
        Boolean(resolveFastResponseModel(provider)) &&
        Boolean(resolveProviderSelectionId(provider)),
    ) ?? null
  );
}

function resolveCurrentFastResponseProviderSelectionId(
  providerType?: string | null,
): string | null {
  const normalizedProvider = normalizeIdentifier(providerType);
  if (!normalizedProvider) {
    return null;
  }

  return FAST_RESPONSE_PROVIDER_ALIASES.some((alias) =>
    normalizedProvider.includes(alias),
  )
    ? providerType?.trim() || null
    : null;
}

export function shouldUseAgentFastResponseSelection(params: {
  providerType?: string | null;
  model?: string | null;
}): boolean {
  const provider = normalizeIdentifier(params.providerType);
  const model = normalizeIdentifier(params.model);
  if (!provider || !model) {
    return false;
  }

  const isLimeHub = provider === "lime-hub" || provider === "limehub";
  if (isLimeHub) {
    return model === "gpt-5.5" || model === "gpt-5.4";
  }

  const isDeepSeek = provider.includes("deepseek");
  if (!isDeepSeek) {
    return false;
  }

  // deepseek-v4-flash/pro 在真实 E2E 中会暴露思考内容且偶发不遵守单字格式；
  // 轻量首轮统一切到非推理 chat 模型，优先保证首字与排版稳定。
  if (model === normalizeIdentifier(FAST_RESPONSE_MODEL_FALLBACK)) {
    return false;
  }

  return (
    model.includes("v4") ||
    model.includes("flash") ||
    model.includes("pro") ||
    model.includes("reason") ||
    model.includes("r1")
  );
}

function isLightweightFirstTurnText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) {
    return false;
  }
  if (normalized.length > LIGHTWEIGHT_FIRST_TURN_MAX_CHARS) {
    return false;
  }
  return !normalized.includes("```");
}

function hasHeavyToolPreference(params: {
  toolPreferences: ChatToolPreferences;
  effectiveWebSearch?: boolean;
  effectiveThinking?: boolean;
}): boolean {
  return Boolean(
    params.effectiveWebSearch ||
      params.effectiveThinking ||
      params.toolPreferences.webSearch ||
      params.toolPreferences.thinking ||
      params.toolPreferences.task ||
      params.toolPreferences.subagent,
  );
}

export function resolveAgentFastResponseModel(
  options: ResolveAgentFastResponseModelOptions,
): AgentFastResponseDecision {
  if (normalizeMode(options.mode) === "off") {
    return disabled("mode-off");
  }

  if (options.mappedTheme !== "general") {
    return disabled("non-general-theme");
  }
  if (options.isThemeWorkbench) {
    return disabled("theme-workbench");
  }
  if (hasValue(options.contentId)) {
    return disabled("content-bound");
  }
  if (options.messageCount > 0) {
    return disabled("not-first-turn");
  }
  if (options.imagesCount > 0) {
    return disabled("image-input");
  }
  if (!isLightweightFirstTurnText(options.sourceText)) {
    return disabled("not-lightweight-text");
  }
  if (
    options.hasExplicitProviderOverride ||
    options.hasExplicitModelOverride ||
    options.hasServiceModelOverride
  ) {
    return disabled("explicit-model-override");
  }
  if (
    options.hasCapabilityRoute ||
    options.hasSkillRequest ||
    options.hasSelectedTeam ||
    options.hasMentionedCharacters ||
    options.hasContextWorkspace ||
    options.hasPurpose ||
    options.hasAutoContinue
  ) {
    return disabled("non-plain-chat");
  }
  if (
    hasHeavyToolPreference({
      toolPreferences: options.toolPreferences,
      effectiveWebSearch: options.effectiveWebSearch,
      effectiveThinking: options.effectiveThinking,
    })
  ) {
    return disabled("heavy-capability-enabled");
  }
  if (
    !shouldUseAgentFastResponseSelection({
      providerType: options.currentProviderType,
      model: options.currentModel,
    })
  ) {
    return disabled("current-model-not-slow");
  }

  const configuredProvider = findFastResponseProvider(
    options.configuredProviders,
  );
  const providerOverride =
    (configuredProvider
      ? resolveProviderSelectionId(configuredProvider)
      : null) ??
    resolveCurrentFastResponseProviderSelectionId(options.currentProviderType);
  if (!providerOverride) {
    return disabled("fast-provider-unavailable");
  }

  const modelOverride = configuredProvider
    ? resolveFastResponseModel(configuredProvider)
    : FAST_RESPONSE_MODEL_FALLBACK;
  if (!modelOverride) {
    return disabled("fast-model-unavailable");
  }

  if (
    normalizeIdentifier(providerOverride) ===
      normalizeIdentifier(options.currentProviderType) &&
    normalizeIdentifier(modelOverride) === normalizeIdentifier(options.currentModel)
  ) {
    return disabled("already-fast-model");
  }

  return {
    enabled: true,
    reason: "first-turn-low-latency",
    providerOverride: providerOverride || undefined,
    modelOverride,
    label: "快速响应",
  };
}

export function buildAgentFastResponseMetadata(
  decision: AgentFastResponseDecision,
): Record<string, unknown> | undefined {
  if (!decision.enabled || !decision.providerOverride || !decision.modelOverride) {
    return undefined;
  }

  return {
    mode: "auto",
    label: decision.label || "快速响应",
    reason: decision.reason,
    provider: decision.providerOverride,
    model: decision.modelOverride,
  };
}

export function buildAgentFastResponseSystemPrompt(now = new Date()): string {
  const date = new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(now);

  return `你是 Lime 的快速响应助手。当前日期：${date}。
本回合是轻量首轮普通对话，请直接回答用户。
规则：
- 严格遵守用户要求的字数、格式和语言；如果用户要求只回答一个字，就只输出一个字。
- 不输出思维链、推理过程、标题、前后缀或额外寒暄。
- 不主动联网、不调用工具、不创建文件；证据不足时用一句话说明必要假设。`;
}
