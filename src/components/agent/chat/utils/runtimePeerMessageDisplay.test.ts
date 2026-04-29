import { describe, expect, it } from "vitest";

import {
  formatRuntimePeerMessageText,
  isPureRuntimePeerMessageText,
  parseRuntimePeerMessageEnvelopes,
} from "./runtimePeerMessageDisplay";

describe("runtimePeerMessageDisplay", () => {
  it("应把 teammate-message 包络格式化为可读协作消息", () => {
    const text = `<teammate-message teammate_id="researcher" summary="同步结果">
继续验证
</teammate-message>`;

    expect(formatRuntimePeerMessageText(text)).toBe(
      "协作消息 · researcher · 同步结果\n\n继续验证",
    );
  });

  it("应把 cross-session-message 包络格式化为可读跨会话消息", () => {
    const text = `<cross-session-message from="uds:session-a">
继续验证
</cross-session-message>`;

    expect(formatRuntimePeerMessageText(text)).toBe(
      "跨会话消息 · uds:session-a\n\n继续验证",
    );
  });

  it("应把 shutdown 审批结果格式化为可读文案", () => {
    const approved = `<teammate-message teammate_id="researcher">
{"type":"shutdown_approved","request_id":"req-1","from":"researcher"}
</teammate-message>`;
    const rejected = `<teammate-message teammate_id="researcher">
{"type":"shutdown_rejected","request_id":"req-2","from":"researcher","reason":"还在收尾"}
</teammate-message>`;

    expect(formatRuntimePeerMessageText(approved)).toBe("");
    expect(formatRuntimePeerMessageText(rejected)).toBe(
      "协作消息 · researcher\n\n拒绝结束当前任务：还在收尾",
    );
  });

  it("应隐藏 idle 和 teammate terminated 这类静默 lifecycle 消息", () => {
    const idleOnly = `<teammate-message teammate_id="researcher">
{"type":"idle_notification","completedTaskId":"task-1","completedStatus":"completed","summary":"等待新任务"}
</teammate-message>`;
    const mixed = [
      idleOnly,
      `<teammate-message teammate_id="researcher">
{"type":"task_completed","taskId":"task-2","taskSubject":"收口 peer message"}
</teammate-message>`,
    ].join("\n");
    const terminated = `<teammate-message teammate_id="researcher">
{"type":"teammate_terminated","message":"worker 已结束"}
</teammate-message>`;

    expect(formatRuntimePeerMessageText(idleOnly)).toBe("");
    expect(formatRuntimePeerMessageText(terminated)).toBe("");
    expect(formatRuntimePeerMessageText(mixed)).toBe(
      "协作消息 · researcher\n\n已完成任务 #task-2：收口 peer message",
    );
    expect(parseRuntimePeerMessageEnvelopes(idleOnly)).toEqual([]);
  });

  it("应保留计划审批请求的正文内容", () => {
    const text = `<teammate-message teammate_id="team-lead">
{"type":"plan_approval_request","from":"researcher","plan_file_path":"plans/alpha.md","plan_content":"# 计划\\n- 第一步"}
</teammate-message>`;

    expect(formatRuntimePeerMessageText(text)).toBe(
      "协作消息 · team-lead\n\n请求审批计划：plans/alpha.md\n\n# 计划\n- 第一步",
    );
  });

  it("未知文本不应被误改写", () => {
    const text = "继续推进主线任务。";

    expect(formatRuntimePeerMessageText(text)).toBe(text);
  });

  it("应按原始顺序解析多条 peer 包络", () => {
    const text = [
      `<cross-session-message from="uds:session-a">继续验证</cross-session-message>`,
      "",
      `<teammate-message teammate_id="researcher">继续补测试</teammate-message>`,
    ].join("\n");

    expect(parseRuntimePeerMessageEnvelopes(text)).toMatchObject([
      {
        kind: "cross_session",
        sender: "uds:session-a",
      },
      {
        kind: "teammate",
        sender: "researcher",
      },
    ]);
  });

  it("应解析 task assignment 的 assignedBy 并写入摘要", () => {
    const text = `<teammate-message teammate_id="worker-1" summary="新任务">
{"type":"task_assignment","taskId":"task-7","subject":"对齐 current surface","description":"补齐 display 语义","assignedBy":"team-lead"}
</teammate-message>`;

    expect(parseRuntimePeerMessageEnvelopes(text)).toMatchObject([
      {
        kind: "teammate",
        sender: "worker-1",
        body: {
          kind: "task_assignment",
          taskId: "task-7",
          subject: "对齐 current surface",
          assignedBy: "team-lead",
        },
      },
    ]);
    expect(formatRuntimePeerMessageText(text)).toBe(
      "协作消息 · worker-1 · 新任务\n\n来自 team-lead 的任务分配 #task-7：对齐 current surface\n\n补齐 display 语义",
    );
  });

  it("应识别纯 peer 包络正文", () => {
    const pureText = `<teammate-message teammate_id="researcher">继续验证</teammate-message>`;
    const mixedText = `${pureText}\n\n附：普通说明`;
    const hiddenOnly = `<teammate-message teammate_id="researcher">
{"type":"shutdown_approved","request_id":"req-1","from":"researcher"}
</teammate-message>`;
    const hiddenAndVisible = [hiddenOnly, pureText].join("\n");

    expect(isPureRuntimePeerMessageText(pureText)).toBe(true);
    expect(isPureRuntimePeerMessageText(mixedText)).toBe(false);
    expect(isPureRuntimePeerMessageText(hiddenOnly)).toBe(false);
    expect(isPureRuntimePeerMessageText(hiddenAndVisible)).toBe(true);
  });
});
