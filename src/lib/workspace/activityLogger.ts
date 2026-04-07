/**
 * @file activityLogger.ts
 * @description 活动日志系统 - 记录工作流执行过程中的所有关键操作
 * @module lib/workspace/activityLogger
 */

/**
 * 活动事件类型
 */
export type ActivityEventType =
  | "workflow_start" // 工作流开始
  | "workflow_complete" // 工作流完成
  | "step_start" // 步骤开始
  | "step_complete" // 步骤完成
  | "step_skip" // 步骤跳过
  | "step_error" // 步骤失败
  | "agent_call_start" // Agent调用开始
  | "agent_call_complete" // Agent调用完成
  | "agent_call_error" // Agent调用失败
  | "file_create" // 文件创建
  | "file_update" // 文件更新
  | "chat_request_start" // 对话请求开始
  | "chat_request_complete" // 对话请求完成
  | "chat_request_error" // 对话请求失败
  | "tool_start" // 工具执行开始
  | "tool_complete" // 工具执行完成
  | "tool_error" // 工具执行失败
  | "action_required" // 需要用户确认/输入
  | "user_action"; // 用户操作

/**
 * 日志作用域过滤器
 */
export interface ActivityLogScope {
  workspaceId?: string;
  sessionId?: string | null;
}

/**
 * 活动日志条目
 */
export interface ActivityLog {
  id: string;
  timestamp: number;
  eventType: ActivityEventType;
  status: "pending" | "success" | "error";
  title: string; // 显示标题（如"执行需求分析Agent"）
  description?: string; // 详细描述
  duration?: number; // 耗时（毫秒）
  metadata?: Record<string, unknown>; // 额外数据
  error?: string; // 错误信息
  workspaceId?: string; // 项目工作区ID
  sessionId?: string; // 会话ID
  source?: "aster-chat"; // 日志来源
  correlationId?: string; // 关联ID（如 tool_id/request_id）
}

/**
 * 日志监听器类型
 */
type LogListener = (logs: ActivityLog[]) => void;

/**
 * 活动日志管理器
 *
 * 负责记录、更新和管理所有活动日志。
 */
export class ActivityLogger {
  private logs: ActivityLog[] = [];
  private listeners: Set<LogListener> = new Set();
  private idCounter = 0;

  /**
   * 生成唯一ID
   */
  private generateId(): string {
    return `log_${Date.now()}_${++this.idCounter}`;
  }

  /**
   * 判断日志是否匹配作用域
   */
  private matchesScope(log: ActivityLog, scope?: ActivityLogScope): boolean {
    if (!scope) {
      return true;
    }

    if (
      scope.workspaceId !== undefined &&
      log.workspaceId !== scope.workspaceId
    ) {
      return false;
    }

    if (scope.sessionId !== undefined) {
      if (scope.sessionId === null) {
        return !log.sessionId;
      }
      return log.sessionId === scope.sessionId;
    }

    return true;
  }

  /**
   * 记录日志
   *
   * @param event - 日志事件（不包含id和timestamp）
   * @returns 日志ID，可用于后续更新
   */
  log(event: Omit<ActivityLog, "id" | "timestamp">): string {
    const log: ActivityLog = {
      id: this.generateId(),
      timestamp: Date.now(),
      ...event,
    };
    this.logs.push(log);
    this.notifyListeners();
    return log.id;
  }

  /**
   * 更新日志状态（用于异步操作）
   *
   * @param id - 日志ID
   * @param updates - 要更新的字段
   */
  updateLog(id: string, updates: Partial<ActivityLog>): void {
    const log = this.logs.find((l) => l.id === id);
    if (log) {
      Object.assign(log, updates);
      this.notifyListeners();
    }
  }

  /**
   * 订阅日志变化
   *
   * @param listener - 监听器函数
   * @returns 取消订阅函数
   */
  subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * 获取所有日志
   *
   * @returns 日志数组的副本
   */
  getLogs(scope?: ActivityLogScope): ActivityLog[] {
    if (!scope) {
      return [...this.logs];
    }
    return this.logs.filter((log) => this.matchesScope(log, scope));
  }

  /**
   * 清空日志
   */
  clear(scope?: ActivityLogScope): void {
    if (!scope) {
      this.logs = [];
      this.notifyListeners();
      return;
    }

    this.logs = this.logs.filter((log) => !this.matchesScope(log, scope));
    this.notifyListeners();
  }

  /**
   * 通知所有监听器
   */
  private notifyListeners(): void {
    const logs = this.getLogs();
    this.listeners.forEach((listener) => listener(logs));
  }
}

/**
 * 全局单例
 */
export const activityLogger = new ActivityLogger();
