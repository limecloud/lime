import { describe, expect, it, vi } from "vitest";
import { Plugin, TextSelection } from "@tiptap/pm/state";
import { undo, redo } from "@tiptap/pm/history";
import {
  ComposerController,
  LARGE_PASTE_CHAR_THRESHOLD,
} from "./ComposerController";

describe("ComposerController", () => {
  it("merges persistent text history into local navigation order", () => {
    const controller = new ComposerController({ text: "current draft" });
    controller.replaceHistory([
      { text: "older" },
      { text: "newer" },
      { text: "newer" },
    ]);

    expect(controller.recallHistory("previous")?.text).toBe("newer");
    expect(controller.recallHistory("previous")?.text).toBe("older");
    expect(controller.recallHistory("next")?.text).toBe("newer");
    expect(controller.recallHistory("next")?.text).toBe("current draft");
  });

  it("does not lose a local submission when persistent history resolves late", () => {
    const controller = new ComposerController();
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("empty");

    controller.setText("本地刚提交");
    const accepted = controller.submit("start");
    expect(accepted.kind).toBe("accepted");
    if (accepted.kind === "accepted") {
      expect(controller.commit(accepted)).toBe(true);
    }

    controller.mergeHistory([{ text: "服务端旧记录" }]);

    expect(controller.getHistory().map((entry) => entry.text)).toEqual([
      "服务端旧记录",
      "本地刚提交",
    ]);
  });

  it("合并服务端快照时去掉读取边界上的重复提交", () => {
    const controller = new ComposerController();
    controller.setText("本地刚提交", { start: 0, end: 0 });
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("accepted");
    if (receipt.kind === "accepted") {
      expect(controller.commit(receipt)).toBe(true);
    }
    controller.mergeHistory([
      { text: "服务端更早记录" },
      { text: "本地刚提交" },
    ]);

    expect(controller.getHistory().map((entry) => entry.text)).toEqual([
      "服务端更早记录",
      "本地刚提交",
    ]);
  });

  it("服务端同文本不会吞掉带附件的会话内历史", () => {
    const controller = new ComposerController({ text: "带图片的输入" });
    controller.setAttachments([{ data: "ZmFrZQ==", mediaType: "image/png" }]);
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("accepted");
    if (receipt.kind === "accepted") {
      expect(controller.commit(receipt)).toBe(true);
    }

    controller.mergeHistory([{ text: "带图片的输入" }]);

    expect(controller.getHistory()).toHaveLength(2);
    expect(controller.getHistory()[1]?.attachments).toHaveLength(1);
  });

  it("有界服务端快照命中中间条目时保留本地前缀", () => {
    const controller = new ComposerController();
    for (const text of ["本地较早", "本地最新"]) {
      controller.setText(text);
      const receipt = controller.submit("start");
      expect(receipt.kind).toBe("accepted");
      if (receipt.kind === "accepted") {
        expect(controller.commit(receipt)).toBe(true);
      }
    }

    controller.mergeHistory([{ text: "本地最新" }]);

    expect(controller.getHistory().map((entry) => entry.text)).toEqual([
      "本地较早",
      "本地最新",
    ]);
  });

  it("归一化换行并保留显示文本的 UTF-16 选择范围", () => {
    const controller = new ComposerController({
      text: "a\r\nb",
      selectionStart: 1,
      selectionEnd: 2,
    });

    expect(controller.getDocument()).toMatchObject({
      text: "a\nb",
      selectionStart: 1,
      selectionEnd: 2,
    });
    controller.setText("hello");
    expect(controller.getDocument()).toMatchObject({
      text: "hello",
      selectionStart: 1,
      selectionEnd: 2,
    });
  });

  it("大粘贴先使用占位符，提交时展开并在成功后清理草稿", () => {
    const controller = new ComposerController({
      text: "before",
      selectionStart: 6,
    });
    const listener = vi.fn();
    controller.subscribe(listener);
    const pasted = "x".repeat(LARGE_PASTE_CHAR_THRESHOLD + 1);
    const pasteResult = controller.ingestPaste(pasted, { platform: "windows" });

    expect(pasteResult.placeholder).toMatch(/Pasted text 1/);
    expect(controller.getDocument().text).toContain(pasteResult.placeholder!);
    const receipt = controller.submit("queue");
    expect(receipt).toMatchObject({ kind: "accepted", target: "queue" });
    if (receipt.kind === "accepted") {
      expect(receipt.draft.text).toContain(pasteResult.placeholder!);
      expect(receipt.submission.text).toBe(`before${pasted}`);
      controller.commit(receipt);
    }
    expect(controller.getDocument().text).toBe("");
    expect(listener).toHaveBeenCalled();
  });

  it("preferPasteAtom 让短文本也折叠为粘贴原子", () => {
    const controller = new ComposerController();
    const text = "应用快照窗口文本";
    const pasteResult = controller.ingestPaste(text, {
      preferPasteAtom: true,
    });
    expect(pasteResult.placeholder).toMatch(/Pasted text 1/);
    expect(controller.getDocument().text).toContain(pasteResult.placeholder!);
    const receipt = controller.submit("queue");
    expect(receipt).toMatchObject({ kind: "accepted", target: "queue" });
    if (receipt.kind === "accepted") {
      expect(receipt.submission.text).toBe(text);
    }
  });

  it("空白草稿不会产生 start/steer 请求，但 interrupt 可接受", () => {
    const controller = new ComposerController();
    expect(controller.submit("start").kind).toBe("empty");
    expect(controller.submit("steer").kind).toBe("empty");
    expect(controller.submit("interrupt").kind).toBe("accepted");
  });

  it("异步提交期间出现新输入时不应由旧回执清空新草稿", () => {
    const controller = new ComposerController({ text: "发送内容" });
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("accepted");

    controller.setText("发送后的新草稿");
    if (receipt.kind === "accepted") {
      expect(controller.commit(receipt)).toBe(false);
    }
    expect(controller.getDocument().text).toBe("发送后的新草稿");
  });

  it("成功提交后记录会话内历史，并支持上下键回放与恢复当前草稿", () => {
    const controller = new ComposerController({ text: "第一条" });
    const firstReceipt = controller.submit("start");
    expect(firstReceipt.kind).toBe("accepted");
    if (firstReceipt.kind === "accepted") {
      expect(controller.commit(firstReceipt)).toBe(true);
    }

    controller.setText("第二条");
    const secondReceipt = controller.submit("start");
    expect(secondReceipt.kind).toBe("accepted");
    if (secondReceipt.kind === "accepted") {
      expect(controller.commit(secondReceipt)).toBe(true);
    }
    controller.setText("当前草稿");

    expect(controller.getHistory().map((entry) => entry.text)).toEqual([
      "第一条",
      "第二条",
    ]);
    expect(controller.recallHistory("previous")?.text).toBe("第二条");
    expect(controller.recallHistory("previous")?.text).toBe("第一条");
    expect(controller.recallHistory("previous")).toBeNull();
    expect(controller.recallHistory("next")?.text).toBe("第二条");
    expect(controller.recallHistory("next")?.text).toBe("当前草稿");
    expect(controller.recallHistory("next")).toBeNull();
  });

  it("未 commit 的回执不会进入会话历史", () => {
    const controller = new ComposerController({ text: "待确认" });
    const receipt = controller.submit("start");
    expect(receipt.kind).toBe("accepted");
    expect(controller.getHistory()).toHaveLength(0);
  });

  it("历史恢复后的真实 PM selection 事务保留导航游标，下一条返回原空草稿", () => {
    const controller = new ComposerController({
      text: "历史😀 ",
      attachments: [{ data: "image", mediaType: "image/png" }],
      pathReferences: [
        { id: "brief", path: "/tmp/brief.md", name: "brief.md", isDir: false },
      ],
      inputCapabilityRoute: { kind: "skill", name: "review" },
    });
    controller.insertMention({
      id: "review",
      kind: "skill",
      name: "review",
      path: "/skills/review/SKILL.md",
      label: "/review",
    });
    controller.ingestPaste("历史粘贴😀".repeat(200));
    controller.setSelection(0);
    const receipt = controller.submit("start");
    if (receipt.kind !== "accepted")
      throw new Error("expected accepted receipt");
    expect(controller.commit(receipt)).toBe(true);
    const currentDraft = controller.captureDraft();

    expect(controller.recallHistory("previous")).toEqual(receipt.draft);
    const state = controller.getEditorState();
    const transaction = state.tr.setSelection(
      TextSelection.create(state.doc, state.doc.content.size - 1),
    );
    expect(transaction.docChanged).toBe(false);
    expect(transaction.selectionSet).toBe(true);
    controller.applyTransaction(transaction);
    expect(controller.getDocument().selectionStart).toBe(
      receipt.draft.text.length,
    );
    expect(controller.getDocument().editorDocument).toEqual(
      receipt.draft.editorDocument,
    );

    expect(controller.recallHistory("next")).toEqual(currentDraft);
    expect(controller.getDocument()).toMatchObject({
      text: "",
      attachments: [],
      pathReferences: [],
    });
  });

  it("真实 PM 事务原子应用 appended transactions", () => {
    const controller = new ComposerController({ text: "a" });
    const state = controller.getEditorState();
    const extended = state.reconfigure({
      plugins: [
        ...state.plugins,
        new Plugin({
          appendTransaction: (transactions, _oldState, nextState) =>
            transactions.some((transaction) => transaction.docChanged) &&
            !nextState.doc.textContent.endsWith("!")
              ? nextState.tr.insertText("!", nextState.doc.content.size - 1)
              : null,
        }),
      ],
    });
    // Exercise PM's actual extension result through the Controller's transaction boundary.
    vi.spyOn(state, "applyTransaction").mockImplementation((transaction) =>
      extended.applyTransaction(transaction),
    );
    const listener = vi.fn();
    controller.subscribe(listener);
    const revision = controller.getSnapshot().revision;
    controller.applyTransaction(state.tr.insertText("中😀", 2));
    expect(controller.getDocument().text).toBe("a中😀!");
    expect(controller.getSnapshot().revision).toBe(revision + 1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("mention 编辑重映射显示范围，提交保留资源路径且删除无悬空身份", () => {
    const controller = new ComposerController({ text: "中 " });
    controller.insertMention({
      id: "s",
      kind: "skill",
      name: "审阅",
      path: "/review",
      label: "$审阅",
    });
    expect(controller.getDocument().textElements[0]).toEqual({
      byteRange: { start: 4, end: 11 },
      placeholder: "$审阅",
    });
    controller.applyTransaction(
      controller.getEditorState().tr.insertText("😀", 1),
    );
    expect(controller.getDocument().mentionBindings[0]).toMatchObject({
      from: 4,
      to: 7,
    });
    expect(controller.submit("steer").submission).toMatchObject({
      text: "😀中 [$审阅](/review)",
      textElements: [],
    });
    expect(controller.getDocument().textElements[0].byteRange).toEqual({
      start: 8,
      end: 15,
    });
    controller.replaceRange({ start: 4, end: 7 }, "");
    expect(controller.getDocument().text).toBe("😀中 ");
    expect(controller.submit("queue").submission.inputMentions).toEqual([]);
  });

  it("atom 移动后以真实事务的新位置发送，删除没有悬空 metadata", () => {
    const controller = new ComposerController({ text: "ab" });
    controller.insertMention(
      { id: "f", kind: "file", name: "文件", path: "/a", label: "@文件" },
      { start: 1, end: 1 },
    );
    const state = controller.getEditorState();
    const atom = state.doc.child(0).child(1);
    controller.applyTransaction(state.tr.delete(2, 3).insert(1, atom));
    expect(controller.getDocument().text).toBe("@文件ab");
    expect(controller.getDocument().mentionBindings[0]).toMatchObject({
      from: 0,
      to: 3,
    });
    controller.replaceRange({ start: 1, end: 2 }, "替换");
    expect(controller.getDocument().text).toBe("替换ab");
    expect(controller.getDocument().textElements).toEqual([]);
  });

  it("多行 selection 替换保留尾段落和末尾换行", () => {
    const controller = new ComposerController({ text: "前abc后\n尾" });
    controller.replaceRange({ start: 1, end: 4 }, "中\r\n😀\n");
    expect(controller.getDocument().text).toBe("前中\n😀\n后\n尾");
    expect(controller.getDocument().selectionStart).toBe(6);
  });

  it("large paste 原文只有 PM atom，删除后不再展开", () => {
    const controller = new ComposerController();
    controller.ingestPaste("中😀".repeat(400));
    const draft = controller.captureDraft();
    expect(draft.editorDocument.content[0].content?.[0].type).toBe("paste");
    expect(draft.pendingPastes).toHaveLength(1);
    controller.replaceRange({ start: 0, end: draft.text.length }, "");
    expect(controller.getDocument().pendingPastes).toEqual([]);
    expect(controller.submit("start").submission.text).toBe("");
  });

  it("restore 与会话历史原子恢复全部 JSON、附件、路径、capability 和 selection", () => {
    const controller = new ComposerController({ text: "中 " });
    controller.insertMention({
      id: "p",
      kind: "plugin",
      name: "检索",
      path: "plugin:search",
      label: "@检索",
    });
    controller.ingestPaste("长".repeat(1_001));
    controller.setAttachments([{ data: "image", mediaType: "image/png" }]);
    controller.setPathReferences([
      { id: "r", name: "a", path: "/a", isDir: false },
    ]);
    controller.setInputCapabilityRoute({ kind: "plugin", id: "search" });
    controller.setSelection(0);
    const original = controller.captureDraft();
    const receipt = controller.submit("start");
    if (receipt.kind !== "accepted")
      throw new Error("expected accepted receipt");
    controller.commit(receipt);
    controller.setText("临时草稿");
    const temporary = controller.captureDraft();
    expect(controller.recallHistory("previous")).toEqual(original);
    expect(controller.recallHistory("next")).toEqual(temporary);
    controller.restoreDraft(original);
    expect(controller.captureDraft()).toEqual(original);
    expect(controller.submit("queue").submission.text).toBe(
      `中 [@检索](plugin:search)${"长".repeat(1_001)}`,
    );
  });

  it("同显示文本同步不丢 token，草稿快照与回执不引用 Controller 私有数据", () => {
    const controller = new ComposerController();
    controller.insertMention({
      id: "f",
      kind: "file",
      name: "文件",
      path: "/a",
      label: "@文件",
    });
    controller.setAttachments([
      { data: "x", mediaType: "image/png", metadata: { nested: { value: 1 } } },
    ]);
    const draft = controller.captureDraft();
    const revision = controller.getSnapshot().revision;
    controller.setText(draft.text);
    expect(controller.getSnapshot().revision).toBe(revision);
    expect(controller.getDocument().mentionBindings).toHaveLength(1);
    draft.textElements[0].byteRange.start = 99;
    (draft.attachments[0].metadata?.nested as { value: number }).value = 99;
    expect(controller.getDocument().textElements[0].byteRange.start).toBe(0);
    expect(controller.getDocument().attachments[0].metadata).toEqual({
      nested: { value: 1 },
    });
  });

  it("旧回执不能清理已恢复 JSON 或附件，新 commit 后 undo 不复活提交草稿", () => {
    const controller = new ComposerController({ text: "old" });
    const receipt = controller.submit("start");
    controller.restoreDraft({
      text: "restored",
      attachments: [{ data: "x", mediaType: "image/png" }],
    });
    if (receipt.kind !== "accepted") throw new Error("expected receipt");
    expect(controller.commit(receipt)).toBe(false);
    controller.replaceRange({ start: 8, end: 8 }, " edit");
    const accepted = controller.submit("start");
    if (accepted.kind !== "accepted") throw new Error("expected receipt");
    expect(controller.commit(accepted)).toBe(true);
    expect(
      undo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(false);
    expect(controller.getDocument().text).toBe("");
  });

  it("PM undo/redo 保留 atom，完整恢复重置当前文档的编辑历史", () => {
    const controller = new ComposerController();
    controller.insertMention({
      id: "s",
      kind: "skill",
      name: "s",
      path: "/s",
      label: "$s",
    });
    expect(
      undo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(true);
    expect(controller.getDocument().mentionBindings).toEqual([]);
    expect(
      redo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(true);
    expect(controller.getDocument().mentionBindings).toHaveLength(1);
    controller.restoreDraft({ text: "fresh" });
    expect(
      undo(controller.getEditorState(), (transaction) =>
        controller.applyTransaction(transaction),
      ),
    ).toBe(false);
  });

  it("同内容 restore 也代表新草稿，旧提交回执必须失效", () => {
    const controller = new ComposerController({ text: "same" });
    const draft = controller.captureDraft();
    const receipt = controller.submit("start");
    controller.restoreDraft(draft);
    if (receipt.kind !== "accepted") throw new Error("expected receipt");
    expect(controller.commit(receipt)).toBe(false);
    expect(controller.getSnapshot().lastIntent).toBe("edit");
  });
});
