/**
 * @file useTerminalAI.ts
 * @description Terminal AI Hook - 管理 AI 聊天状态和操作
 * @module components/terminal/ai/useTerminalAI
 *
 * 复用 Agent 模块的 API，提供 Terminal 专用的 AI 聊天功能。
 * 支持 AI 控制终端执行命令（参考 Waveterm）。
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { toast } from "sonner";
import { safeListen } from "@/lib/dev-bridge";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  startAgentProcess,
  getAgentProcessStatus,
  createAgentSession,
  sendAsterMessageStream,
  sendTerminalCommandResponse,
  sendTermScrollbackResponse,
  type TerminalCommandRequest,
  type TermScrollbackRequest,
} from "@/lib/api/agentRuntime";
import { parseStreamEvent, type StreamEvent } from "@/lib/api/agentStream";
import { requireDefaultProjectId } from "@/lib/api/project";
import { writeToTerminal } from "@/lib/api/terminal";
import type {
  AIMessage,
  AIMessageImage,
  AIContentPart,
  TerminalAIConfig,
  UseTerminalAIReturn,
  PendingTerminalCommand,
} from "./types";

// 存储键
const STORAGE_KEYS = {
  PROVIDER: "terminal_ai_provider",
  MODEL: "terminal_ai_model",
  CONFIG: "terminal_ai_config",
  MESSAGES: "terminal_ai_messages",
};

// 默认配置
const DEFAULT_CONFIG: TerminalAIConfig = {
  widgetContext: true,
  contextLines: 50,
  autoExecute: false, // 默认需要手动批准
};

/**
 * 加载持久化数据
 */
const loadPersisted = <T>(key: string, defaultValue: T): T => {
  try {
    const stored = localStorage.getItem(key);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error("[useTerminalAI] 加载持久化数据失败:", e);
  }
  return defaultValue;
};

/**
 * 保存持久化数据
 */
const savePersisted = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error("[useTerminalAI] 保存持久化数据失败:", e);
  }
};

/**
 * Terminal AI Hook
 *
 * @param getTerminalOutput - 获取终端输出的回调函数
 */
export function useTerminalAI(
  getTerminalOutput?: () => string | null,
): UseTerminalAIReturn {
  // 模型选择状态
  const [providerId, setProviderId] = useState(() =>
    loadPersisted(STORAGE_KEYS.PROVIDER, "claude"),
  );
  const [modelId, setModelId] = useState(() =>
    loadPersisted(STORAGE_KEYS.MODEL, "claude-sonnet-4-20250514"),
  );

  // 配置状态
  const [config, setConfig] = useState<TerminalAIConfig>(() =>
    loadPersisted(STORAGE_KEYS.CONFIG, DEFAULT_CONFIG),
  );

  // 消息状态
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [isSending, setIsSending] = useState(false);

  // 会话 ID
  const [sessionId, setSessionId] = useState<string | null>(null);
  const workspaceIdRef = useRef<string | null>(null);

  // 终端控制状态
  const [terminalSessionId, setTerminalSessionId] = useState<string | null>(
    null,
  );
  const [pendingCommands, setPendingCommands] = useState<
    PendingTerminalCommand[]
  >([]);
  const pendingCommandsRef = useRef<Map<string, PendingTerminalCommand>>(
    new Map(),
  );

  // 使用 ref 存储最新的 config，避免闭包问题
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);

  // 使用 ref 存储 approveCommand 函数引用
  const approveCommandRef = useRef<
    ((commandId: string) => Promise<void>) | null
  >(null);

  // 持久化
  useEffect(() => {
    savePersisted(STORAGE_KEYS.PROVIDER, providerId);
  }, [providerId]);

  useEffect(() => {
    savePersisted(STORAGE_KEYS.MODEL, modelId);
  }, [modelId]);

  useEffect(() => {
    savePersisted(STORAGE_KEYS.CONFIG, config);
  }, [config]);

  // 初始化 Agent 进程
  useEffect(() => {
    const initAgent = async () => {
      try {
        const status = await getAgentProcessStatus();
        if (!status.running) {
          await startAgentProcess();
        }
      } catch (e) {
        console.error("[useTerminalAI] 初始化 Agent 失败:", e);
      }
    };
    initAgent();
  }, []);

  const ensureWorkspaceId = useCallback(async (): Promise<string> => {
    if (workspaceIdRef.current) {
      return workspaceIdRef.current;
    }

    const resolvedWorkspaceId =
      await requireDefaultProjectId("未找到默认工作区，请先创建或选择项目");
    workspaceIdRef.current = resolvedWorkspaceId;
    return resolvedWorkspaceId;
  }, []);

  /**
   * 确保会话存在
   */
  const ensureSession = useCallback(async (): Promise<string | null> => {
    if (sessionId) return sessionId;

    try {
      // 构建系统提示词
      const systemPrompt = `你是一个终端助手，帮助用户解决命令行相关的问题。
你可以：
- 解释命令的用法和参数
- 帮助调试错误信息
- 建议更好的命令或脚本
- 解答 shell 脚本相关问题

请用简洁清晰的语言回答，必要时提供代码示例。`;

      const resolvedWorkspaceId = await ensureWorkspaceId();
      const response = await createAgentSession(
        providerId,
        resolvedWorkspaceId,
        modelId,
        systemPrompt,
        undefined,
      );

      setSessionId(response.session_id);
      return response.session_id;
    } catch (error) {
      console.error("[useTerminalAI] 创建会话失败:", error);
      toast.error("创建 AI 会话失败");
      return null;
    }
  }, [sessionId, providerId, modelId, ensureWorkspaceId]);

  /**
   * 获取终端上下文
   */
  const getTerminalContext = useCallback((): string | null => {
    if (!config.widgetContext || !getTerminalOutput) {
      return null;
    }

    const output = getTerminalOutput();
    if (!output) return null;

    // 限制行数
    const lines = output.split("\n");
    const limitedLines = lines.slice(-config.contextLines);
    return limitedLines.join("\n");
  }, [config.widgetContext, config.contextLines, getTerminalOutput]);

  /**
   * 发送消息
   */
  const sendMessage = useCallback(
    async (content: string, images?: AIMessageImage[]) => {
      if (!content.trim() && (!images || images.length === 0)) return;

      // 创建用户消息
      const userMsg: AIMessage = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        images,
        timestamp: new Date(),
      };

      // 创建助手消息占位符
      const assistantMsgId = crypto.randomUUID();
      const assistantMsg: AIMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isThinking: true,
        thinkingContent: "思考中...",
        contentParts: [],
      };

      setMessages((prev) => [...prev, userMsg, assistantMsg]);
      setIsSending(true);

      let accumulatedContent = "";
      let unlisten: UnlistenFn | null = null;

      /**
       * 追加文本到 contentParts
       */
      const appendTextToParts = (
        parts: AIContentPart[],
        text: string,
      ): AIContentPart[] => {
        const newParts = [...parts];
        const lastPart = newParts[newParts.length - 1];

        if (lastPart && lastPart.type === "text") {
          newParts[newParts.length - 1] = {
            type: "text",
            text: lastPart.text + text,
          };
        } else {
          newParts.push({ type: "text", text });
        }
        return newParts;
      };

      try {
        const activeSessionId = await ensureSession();
        if (!activeSessionId) {
          throw new Error("无法创建会话");
        }

        const eventName = `terminal_ai_stream_${assistantMsgId}`;

        // 设置事件监听
        unlisten = await safeListen<StreamEvent>(eventName, (event) => {
          const data = parseStreamEvent(event.payload);
          if (!data) return;

          switch (data.type) {
            case "text_delta":
              accumulatedContent += data.text;
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        content: accumulatedContent,
                        thinkingContent: undefined,
                        contentParts: appendTextToParts(
                          msg.contentParts || [],
                          data.text,
                        ),
                      }
                    : msg,
                ),
              );
              break;

            case "final_done":
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: accumulatedContent || "(无响应)",
                      }
                    : msg,
                ),
              );
              setIsSending(false);
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;

            case "error":
              toast.error(`AI 响应错误: ${data.message}`);
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        isThinking: false,
                        content: accumulatedContent || `错误: ${data.message}`,
                      }
                    : msg,
                ),
              );
              setIsSending(false);
              if (unlisten) {
                unlisten();
                unlisten = null;
              }
              break;

            case "tool_start": {
              const newToolCall = {
                id: data.tool_id,
                name: data.tool_name,
                arguments: data.arguments,
                status: "running" as const,
                startTime: new Date(),
              };
              setMessages((prev) =>
                prev.map((msg) =>
                  msg.id === assistantMsgId
                    ? {
                        ...msg,
                        toolCalls: [...(msg.toolCalls || []), newToolCall],
                        contentParts: [
                          ...(msg.contentParts || []),
                          { type: "tool_use" as const, toolCall: newToolCall },
                        ],
                      }
                    : msg,
                ),
              );
              break;
            }

            case "tool_end": {
              setMessages((prev) =>
                prev.map((msg) => {
                  if (msg.id !== assistantMsgId) return msg;

                  const updatedToolCalls = (msg.toolCalls || []).map((tc) =>
                    tc.id === data.tool_id
                      ? {
                          ...tc,
                          status: data.result.success
                            ? ("completed" as const)
                            : ("failed" as const),
                          result: data.result,
                          endTime: new Date(),
                        }
                      : tc,
                  );

                  const updatedContentParts = (msg.contentParts || []).map(
                    (part) => {
                      if (
                        part.type === "tool_use" &&
                        part.toolCall.id === data.tool_id
                      ) {
                        return {
                          ...part,
                          toolCall: {
                            ...part.toolCall,
                            status: data.result.success
                              ? ("completed" as const)
                              : ("failed" as const),
                            result: data.result,
                            endTime: new Date(),
                          },
                        };
                      }
                      return part;
                    },
                  );

                  return {
                    ...msg,
                    toolCalls: updatedToolCalls,
                    contentParts: updatedContentParts,
                  };
                }),
              );
              break;
            }
          }
        });

        // 构建消息内容（包含终端上下文）
        let messageContent = content;
        const terminalContext = getTerminalContext();
        if (terminalContext) {
          messageContent = `[终端上下文]\n\`\`\`\n${terminalContext}\n\`\`\`\n\n[用户问题]\n${content}`;
        }

        // 发送请求
        const imagesToSend = images?.map((img) => ({
          data: img.data,
          media_type: img.mediaType,
        }));

        const resolvedWorkspaceId = await ensureWorkspaceId();

        await sendAsterMessageStream(
          messageContent,
          activeSessionId,
          eventName,
          resolvedWorkspaceId,
          imagesToSend,
          providerId
            ? {
                provider_id: providerId,
                provider_name: providerId,
                model_name: modelId || "claude-sonnet-4-20250514",
              }
            : undefined,
        );
      } catch (error) {
        console.error("[useTerminalAI] 发送消息失败:", error);
        toast.error(`发送失败: ${error}`);
        setMessages((prev) => prev.filter((msg) => msg.id !== assistantMsgId));
        setIsSending(false);
        if (unlisten) {
          unlisten();
        }
      }
    },
    [ensureSession, ensureWorkspaceId, getTerminalContext, modelId, providerId],
  );

  /**
   * 清空消息
   */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setSessionId(null);
    toast.success("对话已清空");
  }, []);

  /**
   * 切换终端上下文
   */
  const toggleWidgetContext = useCallback(() => {
    setConfig((prev) => ({
      ...prev,
      widgetContext: !prev.widgetContext,
    }));
  }, []);

  /**
   * 设置上下文行数
   */
  const setContextLines = useCallback((lines: number) => {
    setConfig((prev) => ({
      ...prev,
      contextLines: lines,
    }));
  }, []);

  // ============================================================================
  // 终端控制功能
  // ============================================================================

  /**
   * 连接到终端
   */
  const connectTerminal = useCallback((sessionId: string) => {
    setTerminalSessionId(sessionId);
    console.log("[useTerminalAI] 已连接到终端:", sessionId);
  }, []);

  /**
   * 断开终端连接
   */
  const disconnectTerminal = useCallback(() => {
    setTerminalSessionId(null);
    setPendingCommands([]);
    pendingCommandsRef.current.clear();
    console.log("[useTerminalAI] 已断开终端连接");
  }, []);

  /**
   * 监听后端发送的终端命令请求
   */
  useEffect(() => {
    if (!terminalSessionId) return;

    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await safeListen<TerminalCommandRequest>(
        "terminal_command_request",
        (event) => {
          const request = event.payload;
          console.log("[useTerminalAI] 收到终端命令请求:", request);

          // 创建待审批命令
          const pendingCommand: PendingTerminalCommand = {
            id: request.request_id,
            command: request.command,
            status: "pending",
            createdAt: new Date(),
            workingDir: request.working_dir,
            timeoutSecs: request.timeout_secs,
          };

          pendingCommandsRef.current.set(pendingCommand.id, pendingCommand);
          setPendingCommands(Array.from(pendingCommandsRef.current.values()));

          // 如果开启了自动执行，直接批准命令
          if (configRef.current.autoExecute) {
            console.log("[useTerminalAI] 自动执行模式已启用，自动批准命令");
            // 使用 setTimeout 确保状态更新后再执行
            setTimeout(() => {
              if (approveCommandRef.current) {
                approveCommandRef.current(pendingCommand.id);
              }
            }, 0);
            // 不显示 toast，避免遮挡终端输出
            console.log("[useTerminalAI] AI 命令自动执行:", request.command);
          } else {
            // 显示通知，需要手动批准（这个保留，因为需要用户注意）
            toast.info("AI 请求执行命令，请审批", {
              description:
                request.command.slice(0, 50) +
                (request.command.length > 50 ? "..." : ""),
            });
          }
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [terminalSessionId]);

  /**
   * 监听后端发送的终端滚动缓冲区请求
   */
  useEffect(() => {
    if (!terminalSessionId) return;

    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await safeListen<TermScrollbackRequest>(
        "term_get_scrollback_request",
        async (event) => {
          const request = event.payload;
          console.log("[useTerminalAI] 收到终端滚动缓冲区请求:", request);

          try {
            // 获取终端输出
            const output = getTerminalOutput ? getTerminalOutput() : null;

            if (!output) {
              // 没有输出
              await sendTermScrollbackResponse({
                request_id: request.request_id,
                success: true,
                total_lines: 0,
                line_start: 0,
                line_end: 0,
                content: "",
                has_more: false,
              });
              return;
            }

            // 分割成行
            const lines = output.split("\n");
            const totalLines = lines.length;

            // 计算实际的起始和结束行号
            const requestedStart = request.line_start ?? 0;
            const requestedCount = request.count ?? totalLines;

            const actualStart = Math.max(
              0,
              Math.min(requestedStart, totalLines - 1),
            );
            const actualEnd = Math.min(
              actualStart + requestedCount,
              totalLines,
            );

            // 提取请求的行
            const requestedLines = lines.slice(actualStart, actualEnd);
            const content = requestedLines.join("\n");

            // 发送响应
            await sendTermScrollbackResponse({
              request_id: request.request_id,
              success: true,
              total_lines: totalLines,
              line_start: actualStart,
              line_end: actualEnd,
              content,
              has_more: actualEnd < totalLines,
            });

            console.log(
              `[useTerminalAI] 已发送滚动缓冲区响应: ${actualStart}-${actualEnd}/${totalLines} 行`,
            );
          } catch (error) {
            console.error("[useTerminalAI] 处理滚动缓冲区请求失败:", error);

            // 发送错误响应
            await sendTermScrollbackResponse({
              request_id: request.request_id,
              success: false,
              total_lines: 0,
              line_start: 0,
              line_end: 0,
              content: "",
              has_more: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [terminalSessionId, getTerminalOutput]);

  /**
   * 发送命令到终端（需要用户审批）- 本地创建的命令
   */
  const sendCommandToTerminal = useCallback(
    async (command: string): Promise<string> => {
      if (!terminalSessionId) {
        throw new Error("终端未连接");
      }

      const pendingCommand: PendingTerminalCommand = {
        id: crypto.randomUUID(),
        command,
        status: "pending",
        createdAt: new Date(),
      };

      pendingCommandsRef.current.set(pendingCommand.id, pendingCommand);
      setPendingCommands(Array.from(pendingCommandsRef.current.values()));

      return pendingCommand.id;
    },
    [terminalSessionId],
  );

  /**
   * 批准并执行命令（内部实现）
   */
  const approveCommandInternal = useCallback(
    async (commandId: string): Promise<void> => {
      const command = pendingCommandsRef.current.get(commandId);
      if (!command || !terminalSessionId) {
        return;
      }

      if (command.status !== "pending") {
        return;
      }

      // 更新状态为执行中
      command.status = "executing";
      command.executedAt = new Date();
      pendingCommandsRef.current.set(commandId, command);
      setPendingCommands(Array.from(pendingCommandsRef.current.values()));

      try {
        // 发送命令到终端（添加换行符执行）
        const commandWithNewline = command.command.endsWith("\n")
          ? command.command
          : command.command + "\n";

        await writeToTerminal(terminalSessionId, commandWithNewline);

        // 更新状态为完成
        command.status = "completed";
        command.completedAt = new Date();
        pendingCommandsRef.current.set(commandId, command);
        setPendingCommands(Array.from(pendingCommandsRef.current.values()));

        // 发送响应给后端（告知 TerminalTool 命令已执行）
        // 对于简单的 echo 命令，模拟输出以避免 AI 重复执行
        let simulatedOutput = "";
        const echoMatch = command.command.match(/^echo\s+(.+)$/i);
        if (echoMatch) {
          // 提取 echo 的内容（去除引号）
          let echoContent = echoMatch[1];
          // 移除外层引号
          if (
            (echoContent.startsWith('"') && echoContent.endsWith('"')) ||
            (echoContent.startsWith("'") && echoContent.endsWith("'"))
          ) {
            echoContent = echoContent.slice(1, -1);
          }
          simulatedOutput = `${echoContent}`;
        }

        // 构建明确的成功响应
        const successOutput = simulatedOutput
          ? `[COMMAND EXECUTED SUCCESSFULLY]\nOutput:\n${simulatedOutput}\n[END OF OUTPUT]`
          : `[COMMAND EXECUTED SUCCESSFULLY]\nThe command "${command.command}" has been executed in the user's terminal.\nNote: Output is displayed in the terminal window. Do NOT re-execute this command.\n[END OF OUTPUT]`;

        await sendTerminalCommandResponse({
          request_id: commandId,
          success: true,
          output: successOutput,
          rejected: false,
        });

        // 不显示 toast，避免遮挡终端输出
        // 命令执行状态已经在 AI 面板中显示
        console.log("[useTerminalAI] 命令已执行:", command.command);

        // 延迟移除已完成的命令
        setTimeout(() => {
          pendingCommandsRef.current.delete(commandId);
          setPendingCommands(Array.from(pendingCommandsRef.current.values()));
        }, 2000);
      } catch (error) {
        command.status = "failed";
        command.error = error instanceof Error ? error.message : String(error);
        pendingCommandsRef.current.set(commandId, command);
        setPendingCommands(Array.from(pendingCommandsRef.current.values()));

        // 发送失败响应给后端
        await sendTerminalCommandResponse({
          request_id: commandId,
          success: false,
          output: "",
          error: command.error,
          rejected: false,
        });

        toast.error(`命令执行失败: ${command.error}`);
      }
    },
    [terminalSessionId],
  );

  // 更新 ref
  useEffect(() => {
    approveCommandRef.current = approveCommandInternal;
  }, [approveCommandInternal]);

  /**
   * 批准并执行命令
   */
  const approveCommand = useCallback(
    async (commandId: string): Promise<void> => {
      await approveCommandInternal(commandId);
    },
    [approveCommandInternal],
  );

  /**
   * 拒绝命令
   */
  const rejectCommand = useCallback(
    async (commandId: string): Promise<void> => {
      const command = pendingCommandsRef.current.get(commandId);
      if (!command) {
        return;
      }

      command.status = "rejected";
      pendingCommandsRef.current.set(commandId, command);
      setPendingCommands(Array.from(pendingCommandsRef.current.values()));

      // 发送拒绝响应给后端
      await sendTerminalCommandResponse({
        request_id: commandId,
        success: false,
        output: "",
        error: "用户拒绝执行此命令",
        rejected: true,
      });

      toast.info("命令已拒绝");

      // 延迟移除
      setTimeout(() => {
        pendingCommandsRef.current.delete(commandId);
        setPendingCommands(Array.from(pendingCommandsRef.current.values()));
      }, 1000);
    },
    [],
  );

  /**
   * 切换自动执行模式
   */
  const toggleAutoExecute = useCallback(() => {
    setConfig((prev) => {
      const newConfig = { ...prev, autoExecute: !prev.autoExecute };
      savePersisted(STORAGE_KEYS.CONFIG, newConfig);
      return newConfig;
    });
  }, []);

  return {
    messages,
    isSending,
    config,
    providerId,
    setProviderId,
    modelId,
    setModelId,
    sendMessage,
    clearMessages,
    toggleWidgetContext,
    toggleAutoExecute,
    setContextLines,
    getTerminalContext,
    // 终端控制
    isTerminalConnected: terminalSessionId !== null,
    pendingCommands,
    connectTerminal,
    disconnectTerminal,
    sendCommandToTerminal,
    approveCommand,
    rejectCommand,
  };
}
