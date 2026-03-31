/**
 * @file activityLogger.test.ts
 * @description 活动日志系统测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { ActivityLogger } from "./activityLogger";

describe('ActivityLogger', () => {
  let logger: ActivityLogger;

  beforeEach(() => {
    logger = new ActivityLogger();
  });

  it('应该能够记录日志', () => {
    const logId = logger.log({
      eventType: 'workflow_start',
      status: 'success',
      title: '测试工作流',
      description: '这是一个测试',
    });

    expect(logId).toBeTruthy();
    const logs = logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].title).toBe('测试工作流');
  });

  it('应该能够更新日志', () => {
    const logId = logger.log({
      eventType: 'agent_call_start',
      status: 'pending',
      title: '调用Agent',
    });

    logger.updateLog(logId, {
      status: 'success',
      duration: 1000,
    });

    const logs = logger.getLogs();
    expect(logs[0].status).toBe('success');
    expect(logs[0].duration).toBe(1000);
  });

  it('应该能够订阅日志变化', () => {
    let callCount = 0;
    const unsubscribe = logger.subscribe(() => {
      callCount++;
    });

    logger.log({
      eventType: 'step_start',
      status: 'pending',
      title: '步骤1',
    });

    expect(callCount).toBe(1);

    unsubscribe();

    logger.log({
      eventType: 'step_complete',
      status: 'success',
      title: '步骤1完成',
    });

    expect(callCount).toBe(1); // 不应该再增加
  });

  it('应该能够清空日志', () => {
    logger.log({
      eventType: 'workflow_start',
      status: 'success',
      title: '工作流1',
    });

    logger.log({
      eventType: 'workflow_start',
      status: 'success',
      title: '工作流2',
    });

    expect(logger.getLogs()).toHaveLength(2);

    logger.clear();

    expect(logger.getLogs()).toHaveLength(0);
  });

  it('应该按 workspaceId 和 sessionId 过滤日志', () => {
    logger.log({
      eventType: 'chat_request_start',
      status: 'pending',
      title: '会话A请求',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    });

    logger.log({
      eventType: 'chat_request_start',
      status: 'pending',
      title: '会话B请求',
      workspaceId: 'workspace-a',
      sessionId: 'session-b',
    });

    logger.log({
      eventType: 'chat_request_start',
      status: 'pending',
      title: '其他工作区请求',
      workspaceId: 'workspace-b',
      sessionId: 'session-c',
    });

    const sessionALogs = logger.getLogs({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    });
    expect(sessionALogs).toHaveLength(1);
    expect(sessionALogs[0].title).toBe('会话A请求');
  });

  it('应该只清空指定作用域日志', () => {
    logger.log({
      eventType: 'chat_request_start',
      status: 'pending',
      title: '会话A请求',
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    });

    logger.log({
      eventType: 'chat_request_start',
      status: 'pending',
      title: '会话B请求',
      workspaceId: 'workspace-a',
      sessionId: 'session-b',
    });

    logger.clear({
      workspaceId: 'workspace-a',
      sessionId: 'session-a',
    });

    const logs = logger.getLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0].title).toBe('会话B请求');
  });
});
