import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { resolveFilePath } from "@/lib/api/session-files";
import { readFilePreview } from "@/lib/api/fileBrowser";
import { useWorkspaceArtifactPreviewActions } from "./useWorkspaceArtifactPreviewActions";

vi.mock("sonner", () => ({ toast: { error: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/api/session-files", () => ({ resolveFilePath: vi.fn() }));
vi.mock("@/lib/api/fileBrowser", () => ({ readFilePreview: vi.fn() }));
vi.mock("../hooks/useArtifactAutoPreviewSync", () => ({
  useArtifactAutoPreviewSync: vi.fn(),
}));

type Props = Parameters<typeof useWorkspaceArtifactPreviewActions>[0];
let root: Root;
let container: HTMLDivElement;
let current: ReturnType<typeof useWorkspaceArtifactPreviewActions>;
function mount(overrides: Partial<Props> = {}) {
  const props = {
    activeTheme: "general",
    layoutMode: "chat",
    isGeneralCanvasOpen: false,
    artifacts: [],
    currentCanvasArtifact: null,
    taskFiles: [],
    sessionFiles: [],
    threadId: "thread-1",
    sessionId: "session-1",
    projectRootPath: "/workspace",
    openWorkspaceFile: vi.fn(),
    readSessionFile: vi.fn(async () => null),
    upsertGeneralArtifact: vi.fn(),
    setSelectedArtifactId: vi.fn(),
    setArtifactViewMode: vi.fn(),
    setLayoutMode: vi.fn(),
    setGeneralCanvasState: vi.fn(),
    onRequestCanvasPreviewOpen: vi.fn(),
    ...overrides,
  } satisfies Props;
  function Probe() {
    current = useWorkspaceArtifactPreviewActions(props);
    return null;
  }
  const render = (next: Partial<Props> = {}) => {
    Object.assign(props, next);
    act(() => root.render(<Probe />));
  };
  render();
  return { props, render };
}
async function click(name: string, content = "stale cached content") {
  await act(async () => {
    current.handleFileClick(name, content);
    await Promise.resolve();
  });
}
function deferred() {
  let resolve!: (value: string) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<string>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const stored = {
  name: "draft.md",
  fileType: "document",
  size: 0,
  createdAt: 1,
  updatedAt: 1,
};
beforeEach(() => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  vi.mocked(resolveFilePath).mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("生产文件点击进入 Files", () => {
  it.each(["general", "coding", "article"])(
    "%s 文件点击只选择原件，不投影缓存正文",
    async (activeTheme) => {
      const { props } = mount({ activeTheme });
      await click("reports/result.md");
      expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
        "/workspace/reports/result.md",
      );
      expect(readFilePreview).not.toHaveBeenCalled();
      expect(props.readSessionFile).not.toHaveBeenCalled();
      expect(props.upsertGeneralArtifact).not.toHaveBeenCalled();
      expect(props.onRequestCanvasPreviewOpen).not.toHaveBeenCalled();
    },
  );
  it.each(["pdf", "docx", "xlsx", "pptx", "html", "json"])(
    "空内容 %s 仍打开真实文件",
    async (ext) => {
      const { props } = mount();
      await click(`empty.${ext}`, "");
      expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
        `/workspace/empty.${ext}`,
      );
      expect(readFilePreview).not.toHaveBeenCalled();
      expect(props.upsertGeneralArtifact).not.toHaveBeenCalled();
    },
  );
  it.each([
    "C:/work/report.md",
    String.raw`D:\work\report.md`,
    String.raw`\\server\share\report.md`,
  ])("保留 Windows 路径 %s", async (path) => {
    const { props } = mount();
    await click(path);
    expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(path);
  });
  it("空路径不打开文件或请求解析", async () => {
    const { props } = mount();
    await click("  ");
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
    expect(resolveFilePath).not.toHaveBeenCalled();
  });
  it("没有项目根时不将相对路径解释为进程工作目录", async () => {
    const { props } = mount({ projectRootPath: null });
    await click("report.md");
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
  });
  it("会话文件通过 canonical 路径打开，空文件和缓存内容均不改变 authority", async () => {
    vi.mocked(resolveFilePath).mockResolvedValue(
      "/session/thread-1/files/draft.md",
    );
    const { props } = mount({ sessionFiles: [stored] });
    await click("draft.md", "");
    expect(resolveFilePath).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "draft.md",
    );
    expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/session/thread-1/files/draft.md",
    );
    expect(props.readSessionFile).not.toHaveBeenCalled();
    expect(props.onRequestCanvasPreviewOpen).not.toHaveBeenCalled();
  });
  it("不同目录同名文件不能绑定会话摘要", async () => {
    const { props } = mount({ sessionFiles: [stored] });
    await click("reports/draft.md");
    expect(resolveFilePath).not.toHaveBeenCalled();
    expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/workspace/reports/draft.md",
    );
  });
  it("会话摘要尚未刷新时依据 TaskFile 的 session-file 身份解析", async () => {
    vi.mocked(resolveFilePath).mockResolvedValue(
      "/session/thread-1/files/draft.md",
    );
    const { props } = mount({
      taskFiles: [
        {
          id: "session-file:draft.md",
          name: "draft.md",
          type: "document",
          version: 1,
          createdAt: 1,
          updatedAt: 1,
        },
      ],
    });
    await click("draft.md");
    expect(resolveFilePath).toHaveBeenCalledExactlyOnceWith(
      "session-1",
      "draft.md",
    );
    expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/session/thread-1/files/draft.md",
    );
  });
  it("缺少存储会话身份时不把会话文件重定向到项目同名文件", async () => {
    const { props } = mount({ sessionId: null, sessionFiles: [stored] });
    await click("draft.md");
    expect(resolveFilePath).not.toHaveBeenCalled();
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });
  it.each(["relative/draft.md", "https://example.test/draft.md", ""])(
    "拒绝非法 canonical 路径 %s",
    async (path) => {
      vi.mocked(resolveFilePath).mockResolvedValue(path);
      const { props } = mount({ sessionFiles: [stored] });
      await click("draft.md");
      expect(props.openWorkspaceFile).not.toHaveBeenCalled();
      expect(toast.error).toHaveBeenCalledOnce();
    },
  );
  it("解析失败暴露已有错误状态且不恢复 Canvas", async () => {
    vi.mocked(resolveFilePath).mockRejectedValue(
      new Error("storage unavailable"),
    );
    const { props } = mount({ sessionFiles: [stored] });
    await click("draft.md");
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
    expect(props.onRequestCanvasPreviewOpen).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledOnce();
  });
  it.each(["success", "failure"])("新点击使旧解析 %s 失效", async (outcome) => {
    const pending = deferred();
    vi.mocked(resolveFilePath).mockReturnValue(pending.promise);
    const { props } = mount({ sessionFiles: [stored] });
    await click("draft.md");
    await click("new.md");
    await act(async () => {
      if (outcome === "success") pending.resolve("/old/draft.md");
      else pending.reject(new Error("stale"));
      await pending.promise.catch(() => undefined);
    });
    expect(props.openWorkspaceFile).toHaveBeenCalledExactlyOnceWith(
      "/workspace/new.md",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
  it.each([
    { sessionId: "session-2" },
    { threadId: "thread-2" },
    { projectRootPath: "/other" },
  ])("切换 scope 使旧解析失效 %j", async (next) => {
    const pending = deferred();
    vi.mocked(resolveFilePath).mockReturnValue(pending.promise);
    const { props, render } = mount({ sessionFiles: [stored] });
    await click("draft.md");
    render(next);
    await act(async () => {
      pending.resolve("/old/draft.md");
      await pending.promise;
    });
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
  it("卸载后旧成功与错误不回流", async () => {
    const pending = deferred();
    vi.mocked(resolveFilePath).mockReturnValue(pending.promise);
    const { props } = mount({ sessionFiles: [stored] });
    await click("draft.md");
    act(() => root.unmount());
    root = createRoot(container);
    await act(async () => {
      pending.reject(new Error("unmounted"));
      await pending.promise.catch(() => undefined);
    });
    expect(props.openWorkspaceFile).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();
  });
});
