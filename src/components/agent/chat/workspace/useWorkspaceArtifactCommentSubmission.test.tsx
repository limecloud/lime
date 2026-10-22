import { webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import { act } from "react";
import { createStore, Provider } from "jotai";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { createRuntimeAcceptanceReceipt } from "@/lib/api/agentRuntime/runtimeAcceptance";
import { hashFileBytes } from "@/lib/artifact/fileRevision";
import {
  ArtifactCommentSubmissionContext,
  type ArtifactCommentSubmission,
} from "@/components/artifact/ArtifactCommentSubmissionContext";
import { ArtifactAnnotationComposerAccessory } from "@/components/artifact/annotations/ArtifactAnnotationComposerAccessory";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { DocumentAnnotationComment } from "@/components/artifact/document/documentAnnotation";
import type { WorkbookAnnotationComment } from "@/components/artifact/workbook/workbookAnnotation";
import {
  WorkbookController,
  workbookControllersAtom,
} from "@/components/artifact/workbook/WorkbookController";
import { importWorkbook } from "@/components/artifact/workbook/workbookDocument";
import type { PresentationAnnotationComment } from "@/components/artifact/presentation/presentationAnnotation";
import {
  PresentationController,
  presentationControllersAtom,
} from "@/components/artifact/presentation/PresentationController";
import { importPresentationDocument } from "@/components/artifact/presentation/presentationDocument";
import {
  presentationElements,
  presentationElementText,
} from "@/components/artifact/presentation/presentationElements";
import {
  fromQueueAcceptanceResponse,
  fromRuntimeAcceptanceReceipt,
} from "../hooks/agentSendResult";
import { canRestoreComposerSubmission } from "../components/composerSubmissionSettlement";
import { useWorkspaceArtifactCommentSubmission } from "./useWorkspaceArtifactCommentSubmission";
import { submitArtifactAnnotationBatch } from "@/components/artifact/annotations/artifactAnnotationSubmission";

const mocks = vi.hoisted(() => ({ readBytes: vi.fn() }));
vi.mock("@/lib/api/fileBrowser", () => ({ readFileBytes: mocks.readBytes }));
vi.mock("@/lib/agentDebug", () => ({ logAgentDebug: vi.fn() }));

type Params = Parameters<typeof useWorkspaceArtifactCommentSubmission>[0];
const bytes = new Uint8Array([0, 255, 80, 68, 70]);
const accepted = (threadId = "t1") =>
  fromRuntimeAcceptanceReceipt(
    createRuntimeAcceptanceReceipt(
      { sessionId: "s1", threadId },
      "start",
      "turn2",
    ),
  );
const queued = () =>
  fromQueueAcceptanceResponse(
    { sessionId: "s1", threadId: "t1", clientUserMessageId: "u2" },
    {
      id: "q2",
      clientUserMessageId: "u2",
      input: [{ type: "text", text: "note", text_elements: [] }],
    },
  );
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("批注复用真实 Composer settlement 与 typed acceptance", () => {
  let root: Root;
  let appStore: ReturnType<typeof createStore>;
  let container: HTMLDivElement;
  let submission: ArtifactCommentSubmission | null;
  let params: Params;
  let comment: DocumentAnnotationComment;
  let controller: ComposerController;
  let current: boolean;
  let send: ReturnType<typeof vi.fn<Params["send"]>>;
  const render = async (showAccessory = false) => {
    // Keep the same component identity across navigation updates.
    await act(async () =>
      root.render(
        <Provider store={appStore}>
          <StableHarness
            params={params}
            showAccessory={showAccessory}
            publish={(value) => {
              submission = value;
            }}
          />
        </Provider>,
      ),
    );
  };
  const submit = () =>
    submission!.submit({
      comment,
      controller,
      scopeKey: submission!.scopeKey,
      isCurrent: () => current,
    });
  beforeEach(async () => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    appStore = createStore();
    vi.stubGlobal("crypto", webcrypto);
    mocks.readBytes.mockReset().mockResolvedValue(bytes);
    current = true;
    controller = new ComposerController();
    controller.setText("修改这一处");
    comment = {
      format: "pdf" as const,
      id: "note1",
      path: "/workspace/report.pdf",
      sourceSha256: await hashFileBytes(bytes),
      pageNumber: 2,
      pageCount: 12,
      pageSize: { width: 600, height: 800 },
      anchor: { kind: "point", point: { x: 100, y: 200 } },
      body: "修改这一处",
    };
    send = vi.fn<Params["send"]>().mockResolvedValue(accepted());
    params = {
      sessionId: "s1",
      threadId: "t1",
      originatingTurnId: "turn1",
      projectId: "w1",
      isSending: false,
      activeSessionIdRef: { current: "s1" },
      getNavigationEpoch: () => 1,
      send,
    };
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    await render();
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it.each(["pdf", "docx"] as const)(
    "%s 准确文件与会话被接受后仅清除批注；主输入不受清理或恢复影响",
    async (format) => {
      comment = { ...comment, format, path: `/workspace/report.${format}` };
      const main = new ComposerController();
      main.setText("主输入草稿");
      expect(await submit()).toBe("accepted");
      expect(controller.getDocument().text).toBe("");
      expect(main.getDocument().text).toBe("主输入草稿");
      const options = send.mock.calls[0][0]?.sendOptions;
      if (!options)
        throw new Error("Expected structured annotation submission");
      expect(options).toMatchObject({
        targetSessionId: "s1",
        skipSessionRestore: true,
        composerTarget: "start",
        requestMetadata: {
          artifactAnnotation: {
            path: comment.path,
            sourceSha256: comment.sourceSha256,
            sessionId: "s1",
            threadId: "t1",
            originatingTurnId: "turn1",
          },
        },
      });
      expect(options.composerDraft?.text).toBe(comment.body);
      expect(
        canRestoreComposerSubmission({
          controller: main,
          token: options.composerRestoreToken,
          scope: { projectId: "w1", sessionId: "s1" },
        }),
      ).toBe(false);
    },
  );

  it.each([false, true])(
    "工作表批注前等待文件flush，失败=%s时不创建Turn且正文保留",
    async (fail) => {
      let source = new TextEncoder().encode("name,value\nold,001\n");
      const sourceSha256 = await hashFileBytes(source);
      mocks.readBytes.mockImplementation(async () => source);
      const write = vi.fn(async (_path: string, bytes: Uint8Array) => {
        if (fail) throw new Error("read only");
        source = new Uint8Array(bytes);
      });
      const workbook = new WorkbookController(
        "/workspace/report.csv",
        { sourceSha256, sheets: await importWorkbook(source, "csv") },
        { read: mocks.readBytes, write },
      );
      appStore.get(workbookControllersAtom).set(workbook.path, workbook);
      workbook.setEditing(true);
      workbook.openCellEditor("delimited", "A2");
      workbook.updateFormulaInput("saved before comment");
      const range: WorkbookAnnotationComment = {
        format: "workbook",
        sourceFormat: "csv",
        id: "saved-range",
        path: workbook.path,
        sourceSha256,
        sheetId: "delimited",
        sheetName: "Sheet1",
        address: "A2",
        body: comment.body,
      };
      const submitRange = (value: WorkbookAnnotationComment) =>
        submission!.submit({
          comment: value,
          controller,
          scopeKey: submission!.scopeKey,
          isCurrent: () => current,
        });
      expect(await submitRange(range)).toBe(fail ? "rejected" : "file-changed");
      expect(write).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(controller.getDocument().text).toBe(comment.body);
      expect(workbook.getSnapshot().dirty).toBe(fail);
      if (!fail) {
        expect((await importWorkbook(source, "csv"))[0].cells.A2.raw).toBe(
          "saved before comment",
        );
        expect(
          await submitRange({
            ...range,
            sourceSha256: await hashFileBytes(source),
          }),
        ).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(1);
        expect(controller.getDocument().text).toBe("");
      }
    },
  );

  it.each([false, true])(
    "幻灯片批注前flush原文件；失败=%s时零Turn，保存成功后必须明确使用新SHA",
    async (fail) => {
      let source: Uint8Array = new Uint8Array(
        readFileSync(
          "src/components/artifact/presentation/__fixtures__/review.pptx",
        ),
      );
      const document = await importPresentationDocument(
        source,
        new AbortController().signal,
      );
      mocks.readBytes.mockImplementation(async () => source);
      const write = vi.fn(async (_path: string, value: Uint8Array) => {
        if (fail) throw new Error("read only");
        source = value.slice();
      });
      const presentation = new PresentationController(
        "/workspace/review.pptx",
        document,
        { read: mocks.readBytes, write },
      );
      appStore
        .get(presentationControllersAtom)
        .set(presentation.path, presentation);
      presentation.setEditingEnabled(true);
      const element = presentationElements(document, document.slideIds[0]).find(
        (node) => presentationElementText(node)?.includes("SLIDE_PREVIEW_01"),
      )!;
      presentation.textActivateBlockEnd(element.id);
      presentation.textHandleInput("FLUSH_BEFORE_ANNOTATION");
      const annotation: PresentationAnnotationComment = {
        format: "presentation",
        sourceFormat: "pptx",
        id: "slide-flush",
        path: presentation.path,
        sourceSha256: document.sourceSha256,
        target: { slideId: document.slideIds[0] },
        slideNumber: 1,
        slideCount: document.slideIds.length,
        slideSize: {
          width: document.model.width,
          height: document.model.height,
        },
        body: comment.body,
      };
      const submit = (value: PresentationAnnotationComment) =>
        submission!.submit({
          comment: value,
          controller,
          scopeKey: submission!.scopeKey,
          isCurrent: () => current,
        });
      expect(await submit(annotation)).toBe(fail ? "rejected" : "file-changed");
      expect(write).toHaveBeenCalledTimes(1);
      expect(send).not.toHaveBeenCalled();
      expect(controller.getDocument().text).toBe(comment.body);
      expect(presentation.getSnapshot().dirty).toBe(fail);
      if (!fail) {
        expect(
          await submit({
            ...annotation,
            sourceSha256: await hashFileBytes(source),
          }),
        ).toBe("accepted");
        expect(send).toHaveBeenCalledTimes(1);
      }
    },
  );

  it("工作表单条与跨表批次沿同一原字节校验、typed acceptance 与会话 identity 提交", async () => {
    const range: WorkbookAnnotationComment = {
      format: "workbook",
      sourceFormat: "xlsx",
      id: "range1",
      path: "/workspace/report.xlsx",
      sourceSha256: comment.sourceSha256,
      sheetId: "2",
      sheetName: "预算",
      address: "B2:C4",
      body: comment.body,
    };
    expect(
      await submission!.submit({
        comment: range,
        controller,
        scopeKey: submission!.scopeKey,
        isCurrent: () => current,
      }),
    ).toBe("accepted");
    expect(send.mock.calls[0][0]?.sendOptions?.requestMetadata).toMatchObject({
      artifactAnnotation: {
        type: "workbook",
        path: range.path,
        sheetId: "2",
        sheetName: "预算",
        address: "B2:C4",
        sessionId: "s1",
        threadId: "t1",
        originatingTurnId: "turn1",
      },
    });
    expect(controller.getDocument().text).toBe("");
    const comments = [
      range,
      {
        ...range,
        id: "range2",
        sheetId: "3",
        sheetName: "明细",
        address: "D5",
        body: "第二张工作表",
      },
    ];
    controller.setText(comments.map((item) => item.body).join("\n\n"));
    mocks.readBytes.mockResolvedValueOnce(new Uint8Array([9, 9]));
    expect(
      await submission!.submit({
        comments,
        controller,
        scopeKey: submission!.scopeKey,
        isCurrent: () => current,
      }),
    ).toBe("file-changed");
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.getDocument().text).toContain("第二张工作表");
    expect(
      await submission!.submit({
        comments,
        controller,
        scopeKey: submission!.scopeKey,
        isCurrent: () => current,
      }),
    ).toBe("accepted");
    expect(send.mock.calls[1][0]?.sendOptions?.requestMetadata).toMatchObject({
      artifactAnnotationBatch: {
        type: "workbook",
        path: range.path,
        comments: [
          expect.objectContaining({ sheetId: "2", address: "B2:C4" }),
          expect.objectContaining({ sheetId: "3", address: "D5" }),
        ],
      },
    });
    expect(controller.getDocument().text).toBe("");
  });

  it("幻灯片单条与跨页批次使用源slideId，文件变化拒绝发送并保留正文", async () => {
    const first: PresentationAnnotationComment = {
      format: "presentation",
      sourceFormat: "pptx",
      id: "slide1",
      path: "/workspace/report.pptx",
      sourceSha256: comment.sourceSha256,
      target: { slideId: "900", position: { x: 100, y: 200 } },
      slideNumber: 2,
      slideCount: 3,
      slideSize: { width: 960, height: 540 },
      body: comment.body,
    };
    const request = {
      controller,
      scopeKey: submission!.scopeKey,
      isCurrent: () => current,
    };
    expect(await submission!.submit({ ...request, comment: first })).toBe(
      "accepted",
    );
    expect(send.mock.calls[0][0]?.sendOptions?.requestMetadata).toMatchObject({
      artifactAnnotation: {
        type: "presentation",
        sourceFormat: "pptx",
        target: first.target,
        sessionId: "s1",
        threadId: "t1",
        originatingTurnId: "turn1",
      },
    });
    const comments = [
      first,
      {
        ...first,
        id: "slide2",
        target: { slideId: "300" },
        slideNumber: 3,
        body: "第三页修改",
      },
    ];
    controller.setText(comments.map((entry) => entry.body).join("\n\n"));
    mocks.readBytes.mockResolvedValueOnce(new Uint8Array([9, 9]));
    expect(await submission!.submit({ ...request, comments })).toBe(
      "file-changed",
    );
    expect(send).toHaveBeenCalledTimes(1);
    expect(controller.getDocument().text).toBe("修改这一处\n\n第三页修改");
    expect(await submission!.submit({ ...request, comments })).toBe("accepted");
    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[1][0]?.sendOptions?.requestMetadata).toMatchObject({
      artifactAnnotationBatch: {
        type: "presentation",
        path: first.path,
        sessionId: "s1",
        threadId: "t1",
        comments: [
          expect.objectContaining({
            target: first.target,
            slideNumber: 2,
            sourceSha256: comment.sourceSha256,
          }),
          expect.objectContaining({
            target: { slideId: "300" },
            slideNumber: 3,
            sourceSha256: comment.sourceSha256,
          }),
        ],
      },
    });
    expect(controller.getDocument().text).toBe("");
  });

  it.each(["rejected", "unknown", "local-handled"] as const)(
    "%s 不冒充接受且保留批注",
    async (kind) => {
      send.mockResolvedValueOnce({ kind });
      expect(await submit()).toBe("rejected");
      expect(controller.getDocument().text).toBe(comment.body);
    },
  );

  it.each([false, true])(
    "同文件多批注只提交一次，isSending=%s 继续使用真实 typed acceptance",
    async (isSending) => {
      params = { ...params, isSending };
      await render();
      if (isSending) send.mockResolvedValueOnce(queued());
      const second = {
        ...comment,
        id: "note2",
        pageNumber: 3,
        body: "第二条修改",
      };
      controller.setText(`${comment.body}\n\n${second.body}`);
      expect(
        await submission!.submit({
          comments: [comment, second],
          controller,
          scopeKey: submission!.scopeKey,
          isCurrent: () => current,
        }),
      ).toBe("accepted");
      expect(send).toHaveBeenCalledOnce();
      expect(mocks.readBytes).toHaveBeenCalledOnce();
      expect(send.mock.calls[0][0]?.sendOptions).toMatchObject({
        composerTarget: isSending ? "queue" : "start",
        requestMetadata: {
          artifactAnnotationBatch: {
            path: comment.path,
            sessionId: "s1",
            threadId: "t1",
            originatingTurnId: "turn1",
            comments: [
              { id: "note1", pageNumber: 2 },
              { id: "note2", pageNumber: 3 },
            ],
          },
        },
      });
      expect(controller.getDocument().text).toBe("");
    },
  );

  it("批量源版本不匹配时零发送；混合文件的批次在读取前拒绝", async () => {
    const second = { ...comment, id: "note2", body: "第二条" };
    const body = `${comment.body}\n\n${second.body}`;
    controller.setText(body);
    mocks.readBytes.mockResolvedValueOnce(new Uint8Array([1, 2]));
    const batch = (comments: DocumentAnnotationComment[]) =>
      submission!.submit({
        comments,
        controller,
        scopeKey: submission!.scopeKey,
        isCurrent: () => current,
      });
    expect(await batch([comment, second])).toBe("file-changed");
    expect(
      await batch([comment, { ...second, path: "/workspace/other.pdf" }]),
    ).toBe("rejected");
    expect(mocks.readBytes).toHaveBeenCalledOnce();
    expect(send).not.toHaveBeenCalled();
    expect(controller.getDocument().text).toBe(body);
  });

  it("主 Composer 跳回草稿只打开当前会话文件并发布聚焦，不触发发送", async () => {
    const openFile = vi.fn().mockResolvedValue(true);
    params = { ...params, openFile };
    await render();
    const drafts = submission!.drafts;
    drafts.create(submission!.draftScopeKey, comment);
    drafts.create("other", { ...comment, id: "foreign" });
    await submission!.openComment!("foreign");
    expect(openFile).not.toHaveBeenCalled();
    await submission!.openComment!(comment.id);
    expect(openFile).toHaveBeenCalledExactlyOnceWith(
      comment.path,
      expect.any(Function),
    );
    expect(drafts.getFocusSnapshot()).toMatchObject({
      id: comment.id,
      previewRequestKey: `file:${comment.path}`,
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("等文件重新打开后才聚焦，旧面板不能提前消费请求", async () => {
    const opening = deferred<boolean>();
    const openFile = vi.fn().mockReturnValue(opening.promise);
    params = { ...params, openFile };
    await render();
    const drafts = submission!.drafts;
    drafts.create(submission!.draftScopeKey, comment);
    const request = submission!.openComment!(comment.id);
    expect(drafts.getFocusSnapshot()).toBeNull();
    expect(openFile.mock.calls[0][1]()).toBe(true);
    opening.resolve(true);
    await request;
    expect(drafts.getFocusSnapshot()).toMatchObject({
      id: comment.id,
      previewRequestKey: `file:${comment.path}`,
    });
  });

  it.each(["navigation", "unmount", "newer-request", "removed-draft"] as const)(
    "打开期间 %s 后不让旧聚焦抢回页面",
    async (change) => {
      const opening = deferred<boolean>();
      const openFile = vi.fn().mockReturnValue(opening.promise);
      params = { ...params, openFile };
      await render();
      const drafts = submission!.drafts;
      drafts.create(submission!.draftScopeKey, comment);
      const request = submission!.openComment!(comment.id);
      if (change === "navigation") {
        params = {
          ...params,
          sessionId: "s2",
          threadId: "t2",
          activeSessionIdRef: { current: "s2" },
        };
        await render();
      } else if (change === "unmount") {
        await act(async () => root.render(null));
      } else if (change === "removed-draft") {
        drafts.remove(comment.id);
      } else {
        drafts.create(submission!.draftScopeKey, {
          ...comment,
          id: "newer",
          path: "/workspace/newer.pdf",
        });
        openFile.mockResolvedValueOnce(false);
        await submission!.openComment!("newer");
      }
      expect(openFile.mock.calls[0][1]()).toBe(false);
      opening.resolve(true);
      await request;
      expect(drafts.getFocusSnapshot()).toBeNull();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it.each(["not-opened", "error"])(
    "文件 %s 时保留草稿且不发布聚焦",
    async (result) => {
      const openFile =
        result === "error"
          ? vi.fn().mockRejectedValue(new Error("failed"))
          : vi.fn().mockResolvedValue(false);
      params = { ...params, openFile };
      await render();
      const drafts = submission!.drafts;
      drafts.create(submission!.draftScopeKey, comment);
      drafts.getSnapshot()[0].controller.setText("keep me");
      await submission!.openComment!(comment.id);
      expect(drafts.getFocusSnapshot()).toBeNull();
      expect(drafts.getSnapshot()[0].controller.getDocument().text).toBe(
        "keep me",
      );
    },
  );

  it("错误会话的 observer 和返回 receipt 不清批注", async () => {
    send.mockImplementationOnce(async (...args) => {
      const result = accepted("other-thread");
      if (result.kind === "runtime-accepted")
        args[0]?.sendOptions?.observer?.onRuntimeAccepted?.(result.receipt);
      return result;
    });
    expect(await submit()).toBe("rejected");
    expect(controller.getDocument().text).toBe(comment.body);
  });

  it("截图沿同一 Composer 附件与发送媒体传递，不塞进文本提示", async () => {
    const screenshot = {
      data: "iVBORw0KGgo=",
      mediaType: "image/png" as const,
      width: 100,
      height: 80,
    };
    comment = { ...comment, screenshot };
    controller.setAttachments([screenshot]);
    expect(await submit()).toBe("accepted");
    const payload = send.mock.calls[0][0];
    expect(payload?.images).toEqual([screenshot]);
    expect(payload?.sendOptions?.composerSubmission?.attachments).toEqual([
      screenshot,
    ]);
    expect(payload?.textOverride).not.toContain(screenshot.data);
  });

  it("接受后的回调异常不把已接受的批注判成失败", async () => {
    send.mockImplementationOnce(async (...args) => {
      const result = accepted();
      if (result.kind === "runtime-accepted")
        args[0]?.sendOptions?.observer?.onRuntimeAccepted?.(result.receipt);
      throw new Error("post acceptance");
    });
    expect(await submit()).toBe("accepted");
    expect(controller.getDocument().text).toBe("");
  });

  it("在途 runtime 与验证期间的新输入均由 revision 保护", async () => {
    const gate = deferred<Uint8Array>();
    mocks.readBytes.mockReturnValueOnce(gate.promise);
    const pending = submit();
    controller.setText("验证期间的新输入");
    gate.resolve(bytes);
    expect(await pending).toBe("accepted");
    expect(controller.getDocument().text).toBe("验证期间的新输入");
    expect(send.mock.calls[0][0]?.sendOptions?.composerDraft?.text).toBe(
      comment.body,
    );
  });

  it("正在运行时交给既有 queue authority，真实 queue receipt 才清稿", async () => {
    params = { ...params, isSending: true };
    await render();
    send.mockResolvedValueOnce(queued());
    expect(await submit()).toBe("accepted");
    expect(send.mock.calls[0][0]?.sendOptions?.composerTarget).toBe("queue");
    expect(controller.getDocument().text).toBe("");
  });

  it("文件变化或读取拒绝不创建 Turn，保留原批注", async () => {
    mocks.readBytes.mockResolvedValueOnce(new Uint8Array([1, 2]));
    expect(await submit()).toBe("file-changed");
    mocks.readBytes.mockRejectedValueOnce(new Error("denied"));
    expect(await submit()).toBe("rejected");
    expect(send).not.toHaveBeenCalled();
    expect(controller.getDocument().text).toBe(comment.body);
  });

  it("发送后关闭视图仍结算被接受的原批注，避免重新打开后重复发送", async () => {
    const gate = deferred<ReturnType<typeof accepted>>();
    send.mockReturnValueOnce(gate.promise);
    const pending = submit();
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    current = false;
    await act(async () => root.render(null));
    gate.resolve(accepted());
    expect(await pending).toBe("accepted");
    expect(controller.getDocument().text).toBe("");
  });

  it("Workspace 重挂载保留草稿正文、坐标、附件和失败，独立应用 scope 隔离", async () => {
    const drafts = submission!.drafts;
    const screenshot = {
      data: "iVBORw0KGgo=",
      mediaType: "image/png" as const,
      width: 100,
      height: 120,
    };
    drafts.create(submission!.draftScopeKey, { ...comment, screenshot });
    const draftController = drafts.getSnapshot()[0].controller;
    draftController.setText("离开页面仍保留的批注");
    drafts.begin(comment.id);
    drafts.finish(comment.id, "file-changed");
    const snapshot = drafts.getSnapshot();
    await act(async () => root.render(null));
    await render();
    expect(submission!.drafts.getSnapshot()).toBe(snapshot);
    expect(submission!.drafts.getSnapshot()[0]).toMatchObject({
      comment: { anchor: comment.anchor, screenshot },
      failure: "fileChanged",
      controller: draftController,
    });
    expect(draftController.getDocument()).toMatchObject({
      text: "离开页面仍保留的批注",
      attachments: [screenshot],
    });
    await act(async () => root.render(null));
    appStore = createStore();
    await render();
    expect(submission!.drafts.getSnapshot()).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it("同路径不同会话的批注在真实 Composer 入口隔离，重挂载返回原会话恢复", async () => {
    await changeLimeLocale("zh-CN");
    const original = params;
    const drafts = submission!.drafts;
    drafts.create(submission!.draftScopeKey, comment);
    drafts.getSnapshot()[0].controller.setText("第一会话批注");
    await render(true);
    const review = () =>
      [...container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("report.pdf · 1 条批注"),
      )!;
    await act(async () => review().click());
    expect(container.textContent).toContain("第一会话批注");
    params = {
      ...params,
      sessionId: "s2",
      threadId: "t2",
      activeSessionIdRef: { current: "s2" },
      getNavigationEpoch: () => 2,
    };
    await render(true);
    expect(container.querySelector("section")).toBeNull();
    await act(async () => {
      drafts.create(submission!.draftScopeKey, { ...comment, id: "note2" });
      drafts.getSnapshot()[1].controller.setText("第二会话批注");
    });
    await render(true);
    expect(container.textContent).not.toContain("第一会话批注");
    await act(async () => root.render(null));
    params = { ...original, getNavigationEpoch: () => 3 };
    await render(true);
    await act(async () => review().click());
    expect(container.textContent).toContain("第一会话批注");
    expect(container.textContent).not.toContain("第二会话批注");
    expect(send).not.toHaveBeenCalled();
  });

  it.each(["accepted", "new-edit", "rejected"] as const)(
    "批注发送期间重挂载后 %s 只结算原批次并保留新稿",
    async (result) => {
      const gate = deferred<ReturnType<typeof accepted>>();
      send.mockReturnValueOnce(gate.promise);
      const capturedSubmission = submission!;
      const drafts = capturedSubmission.drafts;
      drafts.create(capturedSubmission.draftScopeKey, comment);
      const draft = drafts.getSnapshot()[0];
      draft.controller.setText(comment.body);
      const pending = submitArtifactAnnotationBatch({
        submission: capturedSubmission,
        drafts: [draft],
        isCurrent: () => true,
      });
      await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
      await act(async () => root.render(null));
      await render();
      expect(submission!.drafts.getSnapshot()[0]?.pending).toBe(true);
      await submitArtifactAnnotationBatch({
        submission: submission!,
        drafts: submission!.drafts.getSnapshot(),
        isCurrent: () => true,
      });
      expect(send).toHaveBeenCalledOnce();
      if (result === "new-edit") draft.controller.setText("重挂载后编辑的新稿");
      gate.resolve(result === "rejected" ? { kind: "rejected" } : accepted());
      await pending;
      const remaining = submission!.drafts.getSnapshot();
      if (result === "accepted") expect(remaining).toEqual([]);
      else {
        expect(remaining).toHaveLength(1);
        expect(remaining[0]).toMatchObject({
          pending: false,
          failure: result === "rejected" ? "submitFailed" : null,
        });
        expect(remaining[0].controller.getDocument().text).toBe(
          result === "new-edit" ? "重挂载后编辑的新稿" : comment.body,
        );
      }
    },
  );

  it.each(["navigation", "editor", "unmount"])(
    "文件验证期间 %s 变化会阻止迟到提交",
    async (change) => {
      const gate = deferred<Uint8Array>();
      mocks.readBytes.mockReturnValueOnce(gate.promise);
      const pending = submit();
      if (change === "navigation") {
        params = { ...params, getNavigationEpoch: () => 2 };
        await render();
      } else if (change === "editor") current = false;
      else await act(async () => root.render(null));
      gate.resolve(bytes);
      expect(await pending).toBe("canceled");
      expect(send).not.toHaveBeenCalled();
      expect(controller.getDocument().text).toBe(comment.body);
    },
  );

  it("提交正文不匹配当前 Controller 时拒绝，不误发新草稿", async () => {
    controller.setText("另一条批注");
    expect(await submit()).toBe("rejected");
    expect(mocks.readBytes).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});

function StableHarness({
  params,
  publish,
  showAccessory,
}: {
  params: Params;
  publish: (value: ArtifactCommentSubmission | null) => void;
  showAccessory: boolean;
}) {
  const submission = useWorkspaceArtifactCommentSubmission(params);
  publish(submission);
  return showAccessory ? (
    <ArtifactCommentSubmissionContext.Provider value={submission}>
      <ArtifactAnnotationComposerAccessory />
    </ArtifactCommentSubmissionContext.Provider>
  ) : null;
}
