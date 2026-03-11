/**
 * @file TerminalController.ts
 * @description 终端控制器 - 管理 AI 与终端的通信
 * @module components/terminal/ai/TerminalController
 *
 * 提供 AI 控制终端的核心能力：
 * - 发送命令到活动终端
 * - 获取终端输出上下文
 * - 跟踪终端状态（Shell Integration）
 *
 * ## 架构说明（参考 Waveterm）
 * Waveterm 使用 `sendDataToController()` 方法将命令发送到终端。
 * 我们实现类似的机制，通过 `writeToTerminal` API 发送数据。
 */

import { writeToTerminal } from "@/lib/api/terminal";
import type { TermWrap } from "../termwrap";

/** 终端控制器配置 */
export interface TerminalControllerConfig {
  /** 是否需要用户确认执行命令 */
  requireApproval?: boolean;
  /** 命令执行超时（毫秒） */
  timeout?: number;
}

/** 命令执行状态 */
export type CommandExecutionStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "executing"
  | "completed"
  | "failed"
  | "timeout";

/** 待执行命令 */
export interface PendingCommand {
  id: string;
  command: string;
  status: CommandExecutionStatus;
  createdAt: Date;
  executedAt?: Date;
  completedAt?: Date;
  error?: string;
}

/** 终端控制器回调 */
export interface TerminalControllerCallbacks {
  /** 命令需要审批时调用 */
  onCommandPending?: (command: PendingCommand) => void;
  /** 命令状态变化时调用 */
  onCommandStatusChange?: (command: PendingCommand) => void;
  /** 命令执行完成时调用 */
  onCommandComplete?: (command: PendingCommand) => void;
}

/**
 * 终端控制器
 *
 * 管理 AI 与终端的通信，支持命令审批流程。
 */
export class TerminalController {
  private sessionId: string | null = null;
  private termWrap: TermWrap | null = null;
  private config: TerminalControllerConfig;
  private callbacks: TerminalControllerCallbacks;
  private pendingCommands: Map<string, PendingCommand> = new Map();

  constructor(
    config: TerminalControllerConfig = {},
    callbacks: TerminalControllerCallbacks = {},
  ) {
    this.config = {
      requireApproval: true,
      timeout: 30000,
      ...config,
    };
    this.callbacks = callbacks;
  }

  /**
   * 连接到终端
   */
  connect(sessionId: string, termWrap?: TermWrap): void {
    this.sessionId = sessionId;
    this.termWrap = termWrap || null;
    console.log("[TerminalController] 已连接到终端:", sessionId);
  }

  /**
   * 断开终端连接
   */
  disconnect(): void {
    this.sessionId = null;
    this.termWrap = null;
    this.pendingCommands.clear();
    console.log("[TerminalController] 已断开终端连接");
  }

  /**
   * 检查是否已连接
   */
  isConnected(): boolean {
    return this.sessionId !== null;
  }

  /**
   * 获取当前会话 ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * 发送命令到终端
   *
   * 如果配置了 requireApproval，命令会先进入待审批状态。
   *
   * @param command - 要执行的命令
   * @param autoExecute - 是否自动执行（跳过审批）
   * @returns 命令 ID
   */
  async sendCommand(
    command: string,
    autoExecute: boolean = false,
  ): Promise<string> {
    if (!this.sessionId) {
      throw new Error("终端未连接");
    }

    const pendingCommand: PendingCommand = {
      id: crypto.randomUUID(),
      command,
      status: "pending",
      createdAt: new Date(),
    };

    this.pendingCommands.set(pendingCommand.id, pendingCommand);

    if (this.config.requireApproval && !autoExecute) {
      // 需要用户审批
      this.callbacks.onCommandPending?.(pendingCommand);
      return pendingCommand.id;
    }

    // 直接执行
    await this.executeCommand(pendingCommand.id);
    return pendingCommand.id;
  }

  /**
   * 批准并执行命令
   */
  async approveCommand(commandId: string): Promise<void> {
    const command = this.pendingCommands.get(commandId);
    if (!command) {
      throw new Error(`命令不存在: ${commandId}`);
    }

    if (command.status !== "pending") {
      throw new Error(`命令状态无效: ${command.status}`);
    }

    command.status = "approved";
    this.callbacks.onCommandStatusChange?.(command);

    await this.executeCommand(commandId);
  }

  /**
   * 拒绝命令
   */
  rejectCommand(commandId: string): void {
    const command = this.pendingCommands.get(commandId);
    if (!command) {
      return;
    }

    command.status = "rejected";
    this.callbacks.onCommandStatusChange?.(command);
    this.pendingCommands.delete(commandId);
  }

  /**
   * 执行命令
   */
  private async executeCommand(commandId: string): Promise<void> {
    const command = this.pendingCommands.get(commandId);
    if (!command || !this.sessionId) {
      return;
    }

    command.status = "executing";
    command.executedAt = new Date();
    this.callbacks.onCommandStatusChange?.(command);

    try {
      // 发送命令到终端（添加换行符执行）
      const commandWithNewline = command.command.endsWith("\n")
        ? command.command
        : command.command + "\n";

      await writeToTerminal(this.sessionId, commandWithNewline);

      command.status = "completed";
      command.completedAt = new Date();
      this.callbacks.onCommandComplete?.(command);
    } catch (error) {
      command.status = "failed";
      command.error = error instanceof Error ? error.message : String(error);
      this.callbacks.onCommandStatusChange?.(command);
    }
  }

  /**
   * 直接发送数据到终端（不添加换行符）
   *
   * 用于发送特殊按键、控制序列等。
   */
  async sendData(data: string): Promise<void> {
    if (!this.sessionId) {
      throw new Error("终端未连接");
    }

    await writeToTerminal(this.sessionId, data);
  }

  /**
   * 发送 Ctrl+C 中断信号
   */
  async sendInterrupt(): Promise<void> {
    await this.sendData("\x03");
  }

  /**
   * 发送 Ctrl+D EOF 信号
   */
  async sendEOF(): Promise<void> {
    await this.sendData("\x04");
  }

  /**
   * 获取终端输出（用于 AI 上下文）
   */
  getTerminalOutput(): string | null {
    if (!this.termWrap) {
      return null;
    }

    // 从 xterm.js 获取缓冲区内容
    const terminal = this.termWrap.terminal;
    if (!terminal) {
      return null;
    }

    const buffer = terminal.buffer.active;
    const lines: string[] = [];

    // 获取所有行
    for (let i = 0; i < buffer.length; i++) {
      const line = buffer.getLine(i);
      if (line) {
        lines.push(line.translateToString(true));
      }
    }

    return lines.join("\n");
  }

  /**
   * 获取待审批的命令列表
   */
  getPendingCommands(): PendingCommand[] {
    return Array.from(this.pendingCommands.values()).filter(
      (cmd) => cmd.status === "pending",
    );
  }

  /**
   * 清除所有待审批命令
   */
  clearPendingCommands(): void {
    for (const [id, command] of this.pendingCommands) {
      if (command.status === "pending") {
        command.status = "rejected";
        this.callbacks.onCommandStatusChange?.(command);
        this.pendingCommands.delete(id);
      }
    }
  }
}

// 全局终端控制器实例（单例）
let globalController: TerminalController | null = null;

/**
 * 获取全局终端控制器
 */
export function getTerminalController(): TerminalController {
  if (!globalController) {
    globalController = new TerminalController();
  }
  return globalController;
}

/**
 * 重置全局终端控制器
 */
export function resetTerminalController(): void {
  if (globalController) {
    globalController.disconnect();
    globalController = null;
  }
}
