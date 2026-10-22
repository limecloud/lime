import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ArtifactCommentSubmissionContext } from "@/components/artifact/ArtifactCommentSubmissionContext";
import { ArtifactAnnotationDraftStore } from "@/components/artifact/annotations/ArtifactAnnotationDraftStore";
import { useArtifactAnnotations } from "@/components/artifact/annotations/useArtifactAnnotations";
import type { DocumentAnnotationComment } from "@/components/artifact/document/documentAnnotation";
import { FilePreviewTabContent } from "./FilePreviewTabContent";
import { resolveFilePreviewModeState } from "./filePreviewModel";
import type { ThreadSidePanelTab } from "./right-surface/threadSidePanelTabs";

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("./right-surface/useWorkspaceFileActions", () => ({
  useWorkspaceFileActions: () => ({ canSaveAs: false }),
}));
vi.mock("./FilePreviewPanel", () => ({
  FilePreviewPanel: () => <Annotations />,
}));
let ready = true;
let mounts = 0;
const navigate = vi.fn();
function Annotations() {
  useEffect(() => {
    mounts++;
  }, []);
  const annotations = useArtifactAnnotations({
    path: comment.path,
    format: "pdf",
    sourceSha256: ready ? comment.sourceSha256 : undefined,
    reload: () => {},
    navigateToComment: navigate,
  });
  return (
    <output data-testid="annotation">
      {annotations.activeDraft?.controller.getDocument().text}
    </output>
  );
}
const comment: DocumentAnnotationComment = {
  format: "pdf",
  id: "note",
  path: "/work/report.pdf",
  sourceSha256: "a".repeat(64),
  pageNumber: 2,
  pageCount: 3,
  pageSize: { width: 600, height: 800 },
  anchor: { kind: "point", point: { x: 100, y: 200 } },
  body: "保留原批注正文",
};
const context = {
  selectionPath: comment.path,
  title: "report.pdf",
  content: "",
  target: { kind: "text" as const, title: "report.pdf", content: "" },
};
const tab: ThreadSidePanelTab = {
  tabId: `file:${comment.path}`,
  kind: "files",
  filePath: comment.path,
  contentInstance: "existing-editor",
};
let root: Root;
let node: HTMLDivElement;
let drafts: ArtifactAnnotationDraftStore;
function render(active = true, showFile = true) {
  act(() => {
    root.render(
      <ArtifactCommentSubmissionContext.Provider
        value={{
          scopeKey: "scope",
          draftScopeKey: "draft-scope",
          drafts,
          submit: async () => "rejected",
        }}
      >
        <div data-testid="old-canvas">
          <Annotations />
        </div>
        {showFile ? (
          <FilePreviewTabContent
            tab={tab}
            active={active}
            context={context}
            mode="code"
            modeState={resolveFilePreviewModeState(context)}
            translate={(key) => key}
          />
        ) : null}
      </ArtifactCommentSubmissionContext.Provider>,
    );
  });
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  ready = true;
  mounts = 0;
  navigate.mockReset();
  drafts = new ArtifactAnnotationDraftStore();
  drafts.create("draft-scope", comment);
  drafts.getSnapshot()[0].controller.setText(comment.body);
  node = document.createElement("div");
  document.body.append(node);
  root = createRoot(node);
});
afterEach(() => {
  act(() => root.unmount());
  node.remove();
  vi.unstubAllGlobals();
});
describe("Files 批注定位", () => {
  it("同路径重开只定位既有编辑器，旧 Canvas 不消费请求", () => {
    render();
    const editor = node.querySelectorAll("output")[1];
    const controller = drafts.getSnapshot()[0].controller;
    act(() => {
      drafts.focus(comment.id, tab.tabId);
    });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(comment);
    expect(editor?.textContent).toBe(comment.body);
    expect(
      node.querySelector('[data-testid="old-canvas"] output')?.textContent,
    ).toBe("");
    act(() => {
      controller.setText("编辑中的正文");
    });
    act(() => {
      drafts.focus(comment.id, tab.tabId);
    });
    expect(node.querySelectorAll("output")[1]).toBe(editor);
    expect(editor?.textContent).toBe("编辑中的正文");
    expect(drafts.getSnapshot()[0].controller).toBe(controller);
    expect(mounts).toBe(2);
    expect(drafts.getFocusSnapshot()).toBeNull();
  });
  it("隐藏 Files 不抢定位，激活且 SHA 就绪后才消费", () => {
    ready = false;
    render(false);
    act(() => {
      drafts.focus(comment.id, tab.tabId);
    });
    ready = true;
    render(false);
    expect(navigate).not.toHaveBeenCalled();
    expect(drafts.getFocusSnapshot()?.id).toBe(comment.id);
    render();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(comment);
    expect(drafts.getFocusSnapshot()).toBeNull();
    expect(mounts).toBe(2);
  });
  it("关闭后冷开等待源文件就绪，保留原草稿和定位", () => {
    render(true, false);
    act(() => {
      drafts.focus(comment.id, tab.tabId);
    });
    ready = false;
    render();
    expect(navigate).not.toHaveBeenCalled();
    ready = true;
    render();
    expect(navigate).toHaveBeenCalledExactlyOnceWith(comment);
    expect(node.querySelectorAll("output")[1]?.textContent).toBe(comment.body);
  });
});
