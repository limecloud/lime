import { safeListen } from "@/lib/dev-bridge";
import {
  createAgentRuntimeSession,
  deleteAgentRuntimeSession,
  getAgentRuntimeSession,
  initAsterAgent,
  submitAgentRuntimeTurn,
  type AsterExecutionStrategy,
} from "@/lib/api/agentRuntime";
import { parseStreamEvent } from "@/lib/api/agentStream";
import { mapProviderName } from "../hooks/agentChatCoreUtils";
import {
  createTeamDefinitionId,
  normalizeTeamDefinition,
  type TeamDefinition,
} from "./teamDefinitions";

interface GenerateTeamWithModelOptions {
  workspaceId: string;
  providerType: string;
  model: string;
  executionStrategy?: AsterExecutionStrategy;
  activeTheme?: string;
  input: string;
  blueprintTeam?: TeamDefinition | null;
  timeoutMs?: number;
}

interface GeneratedTeamPayload {
  label?: string;
  description?: string;
  roles?: Array<{
    id?: string;
    label?: string;
    summary?: string;
    profileId?: string;
    roleKey?: string;
    skillIds?: string[];
  }>;
  team?: GeneratedTeamPayload;
}

function buildTeamGenerationPrompt(
  input: string,
  activeTheme?: string,
  blueprintTeam?: TeamDefinition | null,
): string {
  const blueprintPayload = blueprintTeam
    ? {
        label: blueprintTeam.label,
        description: blueprintTeam.description,
        roles: blueprintTeam.roles.map((role) => ({
          id: role.id,
          label: role.label,
          summary: role.summary,
          profileId: role.profileId,
          roleKey: role.roleKey,
          skillIds: role.skillIds ?? [],
        })),
      }
    : null;

  return [
    "请根据下面的任务，为 GUI Team 模式生成一个“本轮 Team 配置”。",
    "要求：",
    "1. 仅输出 JSON，不要 Markdown，不要代码块，不要额外解释。",
    "2. 生成 2~4 个角色，角色名称与职责用中文。",
    "3. roleKey 优先从以下集合中选择：explorer、executor、verifier、researcher、planner、reviewer、writer。",
    "4. profileId 仅可使用以下值：code-explorer、code-executor、code-verifier、research-analyst、doc-writer、content-ideator、content-reviewer。",
    "5. skillIds 仅可使用以下值：repo-exploration、bounded-implementation、verification-report、source-grounding、structured-writing。",
    "6. 输出结构必须满足：",
    JSON.stringify(
      {
        label: "本轮 Team 名称",
        description: "一句话描述适用场景",
        roles: [
          {
            id: "role-id",
            label: "角色名称",
            summary: "角色职责",
            profileId: "code-explorer",
            roleKey: "explorer",
            skillIds: ["repo-exploration", "source-grounding"],
          },
        ],
      },
      null,
      2,
    ),
    `当前主题：${activeTheme?.trim() || "general"}`,
    blueprintPayload
      ? "7. 如果下面提供了“参考蓝图 Team”，请把它视为偏好与约束来源；你可以按当前任务动态调整角色结构，但不要完全脱离参考蓝图。"
      : "7. 如果没有参考蓝图，请直接围绕当前任务组织最合适的本轮 Team。",
    blueprintPayload
      ? `参考蓝图 Team：${JSON.stringify(blueprintPayload, null, 2)}`
      : "参考蓝图 Team：无",
    "如果任务本身不复杂，也仍然请输出一个最轻量可用的两角色 Team。",
    `任务描述：${input.trim()}`,
  ].join("\n");
}

function extractAssistantText(detail: Awaited<ReturnType<typeof getAgentRuntimeSession>>): string {
  const assistantMessages = [...detail.messages]
    .filter((message) => message.role === "assistant")
    .sort((left, right) => right.timestamp - left.timestamp);

  for (const message of assistantMessages) {
    const text = message.content
      .map((item) => item.text || item.output || item.error || "")
      .join("\n")
      .trim();
    if (text) {
      return text;
    }
  }

  return "";
}

function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();
  const codeFenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = codeFenceMatch?.[1]?.trim() || trimmed;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("模型未返回可解析的 JSON");
  }
  return candidate.slice(start, end + 1);
}

function parseGeneratedTeam(
  raw: string,
  activeTheme?: string,
): TeamDefinition {
  const json = extractJsonObject(raw);
  const parsed = JSON.parse(json) as GeneratedTeamPayload;
  const payload = parsed.team && typeof parsed.team === "object" ? parsed.team : parsed;
  const normalized = normalizeTeamDefinition({
    id: createTeamDefinitionId("ephemeral-team"),
    source: "ephemeral",
    label: payload.label,
    description: payload.description,
    theme: activeTheme?.trim() || undefined,
    roles: payload.roles,
  });

  if (!normalized) {
    throw new Error("模型返回的 Team 结构不完整");
  }

  return {
    ...normalized,
    source: "ephemeral",
  };
}

export async function generateEphemeralTeamWithModel(
  options: GenerateTeamWithModelOptions,
): Promise<TeamDefinition> {
  const {
    workspaceId,
    providerType,
    model,
    executionStrategy = "react",
    activeTheme,
    input,
    blueprintTeam,
    timeoutMs = 45_000,
  } = options;
  const trimmedInput = input.trim();
  if (!workspaceId.trim()) {
    throw new Error("缺少 workspace，暂时无法生成 Team");
  }
  if (!providerType.trim() || !model.trim()) {
    throw new Error("请先选择可用模型，再生成 Team");
  }
  if (!trimmedInput) {
    throw new Error("请先输入任务描述，再生成 Team");
  }

  await initAsterAgent();
  const resolvedExecutionStrategy =
    executionStrategy === "code_orchestrated" ? "react" : executionStrategy;
  const sessionId = await createAgentRuntimeSession(
    workspaceId,
    "Team 规划",
    resolvedExecutionStrategy,
  );
  const eventName = `agent_team_draft:${sessionId}:${Date.now()}`;
  let unlisten: (() => void) | null = null;

  try {
    const completion = new Promise<TeamDefinition>((resolve, reject) => {
      let settled = false;
      const timer = globalThis.setTimeout(() => {
        settle(() => reject(new Error("生成 Team 超时，请稍后重试")));
      }, timeoutMs);
      const settle = (callback: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        globalThis.clearTimeout(timer);
        callback();
      };

      void (async () => {
        try {
          unlisten = await safeListen(eventName, async (event) => {
            const parsed = parseStreamEvent(event.payload);
            if (!parsed) {
              return;
            }

            if (parsed.type === "turn_failed" || parsed.type === "error") {
              settle(() =>
                reject(
                    new Error(
                      parsed.type === "turn_failed"
                        ? parsed.turn.error_message?.trim() ||
                          "Team 生成失败"
                      : parsed.message.trim() || "Team 生成失败",
                    ),
                ),
              );
              return;
            }

            if (
              parsed.type !== "turn_completed" &&
              parsed.type !== "final_done"
            ) {
              return;
            }

            try {
              const detail = await getAgentRuntimeSession(sessionId);
              const responseText = extractAssistantText(detail);
              const generatedTeam = parseGeneratedTeam(responseText, activeTheme);
              settle(() => resolve(generatedTeam));
            } catch (error) {
              settle(() =>
                reject(
                  error instanceof Error
                    ? error
                    : new Error("解析 Team 结果失败"),
                ),
              );
            }
          });

          await submitAgentRuntimeTurn({
            message: buildTeamGenerationPrompt(
              trimmedInput,
              activeTheme,
              blueprintTeam,
            ),
            session_id: sessionId,
            event_name: eventName,
            workspace_id: workspaceId,
            turn_config: {
              provider_config: {
                provider_id: providerType,
                provider_name: mapProviderName(providerType),
                model_name: model,
              },
              execution_strategy: resolvedExecutionStrategy,
              web_search: false,
              search_mode: "disabled",
              system_prompt:
                "你是 GUI Team 规划器。当前唯一任务是输出结构化 JSON Team 定义，不要调用工具，不要输出解释。",
              metadata: {
                source: "team_auto_generation",
                auto_team: true,
                theme: activeTheme || "general",
              },
            },
          });
        } catch (error) {
          settle(() =>
              reject(
                error instanceof Error
                  ? error
                  : new Error("提交 Team 生成任务失败"),
              ),
            );
        }
      })();
    });

    return await completion;
  } finally {
    try {
      unlisten?.();
    } catch {
      // ignore cleanup failure
    }
    try {
      await deleteAgentRuntimeSession(sessionId);
    } catch {
      // ignore cleanup failure
    }
  }
}
