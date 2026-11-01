import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { safeInvoke, safeListen } from "@/lib/dev-bridge";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  deferred,
  harness as coordinatorHarness,
  local,
} from "@/components/input-kit/ComposerDraftCoordinator.testFixtures";
import type { ThreadGoal } from "@limecloud/app-server-client";
import { useThreadGoalComposer } from "./useThreadGoalComposer";
import { useInputbarSend } from "./useInputbarSend";

const { setThreadGoalMock, toastError, fsClient } = vi.hoisted(() => ({
  setThreadGoalMock: vi.fn(),
  toastError: vi.fn(),
  fsClient: {
    createDirectory: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    remove: vi.fn(),
  },
}));
vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
  safeListen: vi.fn(),
}));
vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: vi.fn(function () {
    return fsClient;
  }),
}));
vi.mock("@/lib/api/agentRuntime/threadGoalClient", () => ({
  setThreadGoal: setThreadGoalMock,
}));
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const savedGoal: ThreadGoal = {
  threadId: "thread-1",
  objective: "saved goal",
  status: "complete",
  createdAt: 1,
  updatedAt: 2,
  tokensUsed: 0,
  timeUsedSeconds: 0,
};
type GoalParams = Parameters<typeof useThreadGoalComposer>[0];
let latest: ReturnType<typeof useThreadGoalComposer>;
let latestSend: ReturnType<typeof useInputbarSend>;
const onSend = vi.fn().mockResolvedValue({ kind: "local-handled" });
const onCommitted = vi.fn();
const focusComposer = vi.fn();
const onGoalSaved = vi.fn();
const noop = () => undefined;
const originalBridge = window.electronAPI;
const attachmentId = "650b212f-cdd5-4378-b5a3-57673cdb9401";
const attachmentDirectory = `/isolated/app-server/attachments/${attachmentId}`;
function Harness(props: GoalParams) {
  latest = useThreadGoalComposer(props);
  latestSend = useInputbarSend({
    input: "",
    pendingImages: [],
    pathReferences: [],
    activeCapability: null,
    composerController: props.controller,
    composerDraftCoordinator: props.coordinator,
    onSend,
    clearPendingImages: noop,
    clearActiveCapability: noop,
    prepareThreadGoalSubmit: latest.prepareThreadGoalSubmit,
  });
  return null;
}

let root: Root;
let container: HTMLDivElement;
let props: ComponentProps<typeof Harness>;
const coordinators: Awaited<ReturnType<typeof coordinatorHarness>>[] = [];
function render(overrides: Partial<GoalParams> = {}) {
  props = {
    controller: new ComposerController({ text: "new goal" }),
    threadId: "thread-1",
    sessionId: "session-1",
    focusComposer,
    onCommitted,
    onGoalSaved,
    ...overrides,
  };
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(<Harness {...props} />));
  return props.controller;
}
function rerender(overrides: Partial<GoalParams>) {
  props = { ...props, ...overrides };
  act(() => root.render(<Harness {...props} />));
}
function open() {
  act(() => latest.openGoalEditor());
}
async function send() {
  let result;
  await act(async () => {
    result = await latestSend();
  });
  return result;
}
async function persistent() {
  const h = await coordinatorHarness({ safeInvoke, safeListen });
  coordinators.push(h);
  await h.coordinator.connect();
  await h.coordinator.bindCommitted(local);
  h.controller.setText("new goal");
  await h.coordinator.idle();
  return h;
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  vi.clearAllMocks();
  for (const method of Object.values(fsClient))
    method.mockReset().mockResolvedValue({ result: {} });
  fsClient.readFile.mockResolvedValue({ result: { dataBase64: "AQID" } });
  vi.spyOn(crypto, "randomUUID").mockReturnValueOnce(attachmentId);
  window.electronAPI = {
    agentRoot: "/isolated/app-server",
    invoke: vi.fn(),
    listen: vi.fn(),
    emit: vi.fn(),
  };
  setThreadGoalMock.mockReset().mockResolvedValue({
    ...savedGoal,
    objective: "new goal",
    status: "active",
  });
});
afterEach(async () => {
  if (root) act(() => root.unmount());
  container?.remove();
  for (const h of coordinators.splice(0)) await h.close();
  vi.restoreAllMocks();
  window.electronAPI = originalBridge;
});

describe("ThreadGoal Composer", () => {
  it("已有目标不隐式进入编辑；打开目标编辑只聚焦并保留同一富文档", () => {
    const controller = render({ threadGoal: savedGoal });
    controller.setSelection(2);
    const draft = controller.captureDraft();
    expect(latest.pendingThreadGoalObjective).toBeNull();
    expect(latest.prepareThreadGoalSubmit()).toBeNull();
    open();
    expect(latest.pendingThreadGoalObjective).toBe("");
    expect(controller.captureDraft()).toEqual(draft);
    expect(focusComposer).toHaveBeenCalledOnce();
  });

  it("已有线程保存只调用目标 API，成功清当前稿并结束模式", async () => {
    const controller = render();
    open();
    expect(await send()).toEqual({ kind: "local-handled" });
    expect(setThreadGoalMock).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      objective: "new goal",
      status: "active",
    });
    expect(onSend).not.toHaveBeenCalled();
    expect(controller.getDocument().text).toBe("");
    expect(controller.getHistory()[0]?.text).toBe("new goal");
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(latest.pendingThreadGoalObjective).toBeNull();
  });

  it("/goal 命令进入同一专用提交，普通输入继续普通发送", async () => {
    const controller = render();
    await send();
    expect(onSend).toHaveBeenCalledOnce();
    onSend.mockClear();
    controller.setText(" /gooal  new goal");
    await send();
    expect(setThreadGoalMock).toHaveBeenCalledWith({
      threadId: "thread-1",
      objective: "new goal",
      status: "active",
    });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("目标为空只保留模式与草稿，不发送普通消息", async () => {
    const controller = render();
    controller.setText("/goal ");
    await send();
    expect(latest.pendingThreadGoalObjective).toBe("");
    expect(controller.getDocument().text).toBe("/goal ");
    expect(setThreadGoalMock).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("替换取消保留选择区和原稿；确认后保存捕获目标并重新激活", async () => {
    const controller = render({ threadGoal: savedGoal });
    controller.setSelection(2);
    const draft = controller.captureDraft();
    open();
    await send();
    expect(latest.goalReplacementConfirmation).toBe("new goal");
    expect(setThreadGoalMock).not.toHaveBeenCalled();
    act(() => latest.handleCloseGoalReplacement());
    expect(controller.captureDraft()).toEqual(draft);
    expect(latest.pendingThreadGoalObjective).toBe("");
    await send();
    await act(async () => {
      await latest.handleConfirmGoalReplacement();
    });
    expect(setThreadGoalMock).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      objective: "new goal",
      status: "active",
    });
    expect(controller.getDocument().text).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("失败保留完整草稿，重试仍只保存目标", async () => {
    const controller = render();
    controller.setSelection(3);
    const draft = controller.captureDraft();
    open();
    setThreadGoalMock.mockRejectedValueOnce(new Error("goal unavailable"));
    expect(await send()).toMatchObject({ kind: "rejected" });
    expect(controller.captureDraft()).toEqual(draft);
    expect(latest.pendingThreadGoalObjective).toBe("");
    expect(toastError).toHaveBeenCalledWith("goal unavailable");
    await send();
    expect(controller.getDocument().text).toBe("");
    expect(onSend).not.toHaveBeenCalled();
  });

  it("保存中重复提交被阻止，新 revision 保留", async () => {
    const request = deferred<ThreadGoal>();
    setThreadGoalMock.mockReturnValue(request.promise);
    const controller = render();
    open();
    let pending: ReturnType<typeof latestSend>;
    act(() => {
      pending = latestSend();
    });
    expect(latest.isSubmitting).toBe(true);
    await send();
    controller.setText("newer draft");
    controller.setSelection(4);
    const newer = controller.captureDraft();
    await act(async () => {
      request.resolve(savedGoal);
      await pending;
    });
    expect(setThreadGoalMock).toHaveBeenCalledOnce();
    expect(controller.captureDraft()).toEqual(newer);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("替换确认期间的新输入不被旧目标确认清除", async () => {
    const controller = render({ threadGoal: savedGoal });
    open();
    await send();
    controller.setText("draft edited while confirming");
    await act(async () => {
      await latest.handleConfirmGoalReplacement();
    });
    expect(setThreadGoalMock).toHaveBeenCalledWith({
      threadId: "thread-1",
      objective: "new goal",
      status: "active",
    });
    expect(controller.getDocument().text).toBe("draft edited while confirming");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("切换线程后的迟到结果不清稿、不抢焦点、不更新新线程模式", async () => {
    const request = deferred<ThreadGoal>();
    setThreadGoalMock.mockReturnValue(request.promise);
    const controller = render();
    open();
    let pending: ReturnType<typeof latestSend>;
    act(() => {
      pending = latestSend();
    });
    rerender({ threadId: "thread-2", sessionId: "session-2" });
    controller.setText("thread two draft");
    focusComposer.mockClear();
    await act(async () => {
      request.resolve(savedGoal);
      await pending;
    });
    expect(controller.getDocument().text).toBe("thread two draft");
    expect(onCommitted).not.toHaveBeenCalled();
    expect(onGoalSaved).not.toHaveBeenCalled();
    expect(focusComposer).not.toHaveBeenCalled();
    expect(latest.pendingThreadGoalObjective).toBeNull();
  });

  it("持久草稿保存成功复用 coordinator CAS 清理，不伪造 Turn consume", async () => {
    const h = await persistent();
    render({ controller: h.controller, coordinator: h.coordinator });
    open();
    await send();
    expect(h.controller.getDocument().text).toBe("");
    expect(await h.read(local)).toBeNull();
    expect(h.mutations.some((mutation) => mutation.op === "clear")).toBe(true);
    expect(h.mutations.some((mutation) => mutation.op === "consume")).toBe(
      false,
    );
    expect(onCommitted).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("CAS 清理在途时发生编辑，保留新文档和持久草稿", async () => {
    const h = await persistent();
    const entered = deferred<void>(),
      release = deferred<void>();
    h.intercept(async (_command, args, execute) => {
      if ((args.mutation as { op?: string } | undefined)?.op === "clear") {
        entered.resolve();
        await release.promise;
      }
      return execute();
    });
    render({ controller: h.controller, coordinator: h.coordinator });
    open();
    await act(async () => {
      const pending = latestSend();
      await entered.promise;
      h.controller.setText("newer durable goal draft");
      release.resolve();
      await pending;
    });
    await h.coordinator.idle();
    expect(h.controller.getDocument().text).toBe("newer durable goal draft");
    expect(await h.read(local)).not.toBeNull();
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("目标已保存时历史观察者失败仍清当前稿，不误报保存失败", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(noop);
    onGoalSaved.mockImplementationOnce(() => {
      throw new Error("history unavailable");
    });
    const controller = render();
    open();
    expect(await send()).toEqual({ kind: "local-handled" });
    expect(controller.getDocument().text).toBe("");
    expect(toastError).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      "[ThreadGoal] prompt history update failed",
    );
    expect(setThreadGoalMock).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it("目标已保存后持久清稿失败应保留草稿，不误报请求被拒绝", async () => {
    const diagnostic = vi.spyOn(console, "error").mockImplementation(noop);
    const h = await persistent();
    vi.spyOn(h.coordinator, "replaceCommittedDraft").mockRejectedValueOnce(
      new Error("draft storage unavailable"),
    );
    render({ controller: h.controller, coordinator: h.coordinator });
    const draft = h.controller.captureDraft();
    open();
    expect(await send()).toEqual({ kind: "local-handled" });
    expect(h.controller.captureDraft()).toEqual(draft);
    expect(await h.read(local)).not.toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledWith(
      "[ThreadGoal] saved goal draft cleanup failed",
    );
    expect(onCommitted).not.toHaveBeenCalled();
    expect(setThreadGoalMock).toHaveBeenCalledOnce();
    expect(onSend).not.toHaveBeenCalled();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "%s 未映射上下文显式拒绝并保留，不静默降级为普通消息",
    async (locale) => {
      await changeLimeLocale(locale);
      const controller = render();
      controller.setPathReferences([
        { id: "file", name: "file", path: "/work/file", isDir: false },
      ]);
      const draft = controller.captureDraft();
      open();
      expect(await send()).toEqual({ kind: "rejected" });
      expect(controller.captureDraft()).toEqual(draft);
      expect(setThreadGoalMock).not.toHaveBeenCalled();
      expect(onSend).not.toHaveBeenCalled();
      expect(toastError.mock.calls[0]?.[0]).not.toContain("agentChat.");
    },
  );

  it("仅图片目标通过真实物化网关保存，成功保留素材并清富文档", async () => {
    const controller = render();
    controller.setText("");
    controller.setAttachments([{ data: "AQID", mediaType: "image/jpeg" }]);
    open();
    expect(await send()).toEqual({ kind: "local-handled" });
    expect(fsClient.createDirectory).toHaveBeenCalledExactlyOnceWith({
      path: attachmentDirectory,
      recursive: true,
    });
    expect(fsClient.writeFile).toHaveBeenCalledExactlyOnceWith({
      path: `${attachmentDirectory}/image-1.jpg`,
      dataBase64: "AQID",
    });
    expect(setThreadGoalMock).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      objective: `Referenced image files:\n- [Image #1]: ${attachmentDirectory}/image-1.jpg`,
      status: "active",
    });
    expect(fsClient.remove).not.toHaveBeenCalled();
    expect(controller.getDocument().attachments).toEqual([]);
    expect(onSend).not.toHaveBeenCalled();
  });

  it("粘贴文本只写引用素材，不在目标正文再次展开", async () => {
    const controller = render();
    controller.setText("");
    const source = "中😀".repeat(400);
    controller.ingestPaste(source);
    open();
    await send();
    expect(fsClient.writeFile).toHaveBeenCalledExactlyOnceWith({
      path: `${attachmentDirectory}/pasted-text-1.txt`,
      dataBase64: btoa(
        String.fromCharCode(...new TextEncoder().encode(source)),
      ),
    });
    expect(setThreadGoalMock).toHaveBeenCalledExactlyOnceWith({
      threadId: "thread-1",
      objective: `Referenced pasted text files:\n- pasted text file: ${attachmentDirectory}/pasted-text-1.txt. Read this file before continuing.`,
      status: "active",
    });
    expect(controller.getDocument().pendingPastes).toEqual([]);
    expect(fsClient.remove).not.toHaveBeenCalled();
  });

  it.each(["paste", "image"])(
    "正文与已有目标相同但含 %s 仍先确认，取消时没有文件副作用",
    async (kind) => {
      const controller = render({ threadGoal: savedGoal });
      controller.setText(savedGoal.objective);
      if (kind === "image")
        controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
      else {
        controller.setSelection(controller.getDocument().text.length);
        controller.ingestPaste("paste\n".repeat(1000));
      }
      const before = controller.captureDraft();
      open();
      await send();
      expect(latest.goalReplacementConfirmation).toBe(savedGoal.objective);
      expect(fsClient.createDirectory).not.toHaveBeenCalled();
      expect(setThreadGoalMock).not.toHaveBeenCalled();
      act(() => latest.handleCloseGoalReplacement());
      expect(controller.captureDraft()).toEqual(before);
      await send();
      await act(async () => {
        await latest.handleConfirmGoalReplacement();
      });
      expect(setThreadGoalMock).toHaveBeenCalledOnce();
      expect(fsClient.remove).not.toHaveBeenCalled();
    },
  );

  it("保存失败经 typed fs/remove 强制递归回收本次目录，完整附件草稿可重试", async () => {
    const controller = render();
    controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
    const before = controller.captureDraft();
    open();
    setThreadGoalMock.mockRejectedValueOnce(new Error("goal unavailable"));
    expect(await send()).toMatchObject({ kind: "rejected" });
    expect(fsClient.remove).toHaveBeenCalledExactlyOnceWith({
      path: attachmentDirectory,
      recursive: true,
      force: true,
    });
    expect(controller.captureDraft()).toEqual(before);
    expect(onSend).not.toHaveBeenCalled();
    await send();
    expect(setThreadGoalMock).toHaveBeenCalledTimes(2);
    expect(controller.getDocument().attachments).toEqual([]);
    expect(fsClient.remove).toHaveBeenCalledOnce();
  });

  it("准备附件期间切换线程回收 owned 目录，不把目标发到错误线程", async () => {
    const created = deferred<{ result: object }>();
    fsClient.createDirectory.mockReturnValueOnce(created.promise);
    const controller = render();
    controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
    open();
    let pending: ReturnType<typeof latestSend>;
    act(() => {
      pending = latestSend();
    });
    rerender({ threadId: "thread-2", sessionId: "session-2" });
    controller.setText("thread two draft");
    const newer = controller.captureDraft();
    await act(async () => {
      created.resolve({ result: {} });
      await pending;
    });
    expect(fsClient.remove).toHaveBeenCalledExactlyOnceWith({
      path: attachmentDirectory,
      recursive: true,
      force: true,
    });
    expect(fsClient.writeFile).not.toHaveBeenCalled();
    expect(setThreadGoalMock).not.toHaveBeenCalled();
    expect(controller.captureDraft()).toEqual(newer);
    expect(onCommitted).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("附件准备等待期间同一草稿持久版本推进，仍保存目标并以当前 CAS 清稿", async () => {
    const h = await persistent();
    const entered = deferred<void>();
    const released = deferred<{ result: object }>();
    fsClient.createDirectory.mockImplementationOnce(async () => {
      entered.resolve();
      return released.promise;
    });
    render({ controller: h.controller, coordinator: h.coordinator });
    h.controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
    open();
    await act(async () => {
      const pending = latestSend();
      await entered.promise;
      await h.coordinator.idle();
      released.resolve({ result: {} });
      await pending;
    });
    expect(setThreadGoalMock).toHaveBeenCalledOnce();
    expect(h.controller.getDocument().attachments).toEqual([]);
    expect(await h.read(local)).toBeNull();
    expect(toastError).not.toHaveBeenCalled();
    expect(fsClient.remove).not.toHaveBeenCalled();
  });

  it("准备附件期间同一表面绑定切换后停止保存并回收本次目录", async () => {
    const h = await persistent();
    const entered = deferred<void>();
    const released = deferred<{ result: object }>();
    fsClient.createDirectory.mockImplementationOnce(async () => {
      entered.resolve();
      return released.promise;
    });
    render({ controller: h.controller, coordinator: h.coordinator });
    h.controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
    open();
    await act(async () => {
      const pending = latestSend();
      await entered.promise;
      await h.coordinator.bindCommitted({
        workspaceId: "w",
        kind: "local",
        id: "new-session",
      });
      h.controller.setText("new binding draft");
      released.resolve({ result: {} });
      await pending;
    });
    expect(setThreadGoalMock).not.toHaveBeenCalled();
    expect(fsClient.writeFile).not.toHaveBeenCalled();
    expect(fsClient.remove).toHaveBeenCalledOnce();
    expect(h.controller.getDocument().text).toBe("new binding draft");
    expect(onCommitted).not.toHaveBeenCalled();
  });

  it("本地图片使用同一 typed fs/readFile，成功物化保留源图", async () => {
    const controller = render();
    controller.setAttachments([
      { data: "", mediaType: "image/webp", sourcePath: "/work/source.webp" },
    ]);
    open();
    await send();
    expect(fsClient.readFile).toHaveBeenCalledExactlyOnceWith({
      path: "/work/source.webp",
    });
    expect(fsClient.writeFile).toHaveBeenCalledExactlyOnceWith({
      path: `${attachmentDirectory}/image-1.webp`,
      dataBase64: "AQID",
    });
    expect(fsClient.remove).not.toHaveBeenCalled();
    expect(setThreadGoalMock).toHaveBeenCalledOnce();
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "%s 准备失败文案本地化且保留附件，禁止缺失 root 时猜测路径",
    async (locale) => {
      await changeLimeLocale(locale);
      window.electronAPI = { invoke: vi.fn(), listen: vi.fn(), emit: vi.fn() };
      const controller = render();
      controller.setAttachments([{ data: "AQID", mediaType: "image/png" }]);
      const before = controller.captureDraft();
      open();
      expect(await send()).toMatchObject({ kind: "rejected" });
      expect(toastError.mock.calls[0]?.[0]).not.toContain("agentChat.");
      expect(controller.captureDraft()).toEqual(before);
      expect(fsClient.createDirectory).not.toHaveBeenCalled();
      expect(setThreadGoalMock).not.toHaveBeenCalled();
      expect(onSend).not.toHaveBeenCalled();
    },
  );
});
