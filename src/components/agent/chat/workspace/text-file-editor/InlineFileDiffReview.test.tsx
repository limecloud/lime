import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildCanvasWorkbenchDiff } from "../../utils/canvasWorkbenchDiff";
import { InlineFileDiffReview } from "./InlineFileDiffReview";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../utils/canvasWorkbenchDiff", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../utils/canvasWorkbenchDiff")>();
  return {
    ...actual,
    buildCanvasWorkbenchDiff: vi.fn(actual.buildCanvasWorkbenchDiff),
  };
});
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  vi.mocked(buildCanvasWorkbenchDiff).mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe("外部文件冲突审阅", () => {
  it("完整统一差异保留上下文，底部依序换行、编辑、拒绝和接受", () => {
    const onAction = vi.fn();
    act(() =>
      root.render(
        <InlineFileDiffReview
          oldFile={{ name: "notes.txt", contents: "context\nold" }}
          newFile={{ name: "notes.txt", contents: "context\nnew" }}
          canEdit
          onAction={onAction}
        />,
      ),
    );
    expect(
      [...host.querySelectorAll("[data-diff-line-type]")].map((line) =>
        line.getAttribute("data-diff-line-type"),
      ),
    ).toEqual(["context", "remove", "add"]);
    const buttons = host.querySelectorAll<HTMLButtonElement>("button");
    expect(
      [...buttons].map((button) => button.dataset.testid ?? "wrap"),
    ).toEqual([
      "wrap",
      "file-editor-conflict-edit",
      "file-editor-conflict-reject",
      "file-editor-conflict-accept",
    ]);
    expect(buttons[0].getAttribute("aria-pressed")).toBe("true");
    act(() => buttons[0].click());
    expect(buttons[0].getAttribute("aria-pressed")).toBe("false");
    for (const button of [...buttons].slice(1)) act(() => button.click());
    expect(onAction.mock.calls).toEqual([["edit"], ["reject"], ["accept"]]);
  });

  it("差异面板与上下文消费代码主题语义变量", () => {
    act(() =>
      root.render(
        <InlineFileDiffReview
          oldFile={{ name: "notes.txt", contents: "context\nold" }}
          newFile={{ name: "notes.txt", contents: "context\nnew" }}
          canEdit
          onAction={vi.fn()}
        />,
      ),
    );
    const panel = host.querySelector(
      '[data-testid="canvas-workbench-inline-diff"]',
    );
    const context = host.querySelector('[data-diff-line-type="context"]');
    expect(panel?.className).toContain("--lime-code-diff-surface");
    expect(context?.className).toContain("--lime-code-diff-text");
  });

  it.each(["x".repeat(262145), "x\n".repeat(5000)])(
    "超限输入跳过差异计算并保留审阅动作（%#）",
    (contents) => {
      const onAction = vi.fn();
      act(() =>
        root.render(
          <InlineFileDiffReview
            oldFile={{ name: "notes.txt", contents }}
            newFile={{ name: "notes.txt", contents: "new" }}
            canEdit={false}
            canAccept={false}
            onAction={onAction}
          />,
        ),
      );
      expect(buildCanvasWorkbenchDiff).not.toHaveBeenCalled();
      expect(host.textContent).toContain("agentChat.fileEditor.changeTooLarge");
      const buttons = host.querySelectorAll<HTMLButtonElement>("button");
      expect(buttons).toHaveLength(3);
      expect(buttons[0].disabled).toBe(true);
      expect(buttons[1].disabled).toBe(false);
      expect(buttons[2].disabled).toBe(true);
      act(() => buttons[1].click());
      expect(onAction).toHaveBeenCalledWith("reject");
    },
  );

  it.each(["x".repeat(262144), Array(5000).fill("x").join("\n")])(
    "上限以内的提议仍计算差异（%#）",
    (contents) => {
      act(() =>
        root.render(
          <InlineFileDiffReview
            oldFile={{ name: "notes.txt", contents: "old" }}
            newFile={{ name: "notes.txt", contents }}
            canEdit
            onAction={vi.fn()}
          />,
        ),
      );
      expect(buildCanvasWorkbenchDiff).toHaveBeenCalledOnce();
      expect(host.textContent).not.toContain(
        "agentChat.fileEditor.changeTooLarge",
      );
    },
  );
});
