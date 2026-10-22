import { configureBooleanGateway } from "@/hooks/usePersistedBooleanAtom.testFixtures";
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspaceFileThreadSidePanelTab } from "./WorkspaceFileThreadSidePanelTab";
import zhCN from "@/i18n/resources/zh-CN/agent.json";
import zhTW from "@/i18n/resources/zh-TW/agent.json";
import enUS from "@/i18n/resources/en-US/agent.json";
import jaJP from "@/i18n/resources/ja-JP/agent.json";
import koKR from "@/i18n/resources/ko-KR/agent.json";

const atomGateway = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/api/persistedAtoms", () => ({
  sendPersistedAtomState: atomGateway.read,
  updatePersistedAtomState: atomGateway.update,
  listenPersistedAtomUpdates: atomGateway.listen,
}));
const boundary = vi.hoisted(() => ({
  list: vi.fn(),
  read: vi.fn(),
  search: vi.fn(),
  translations: null as Record<string, string> | null,
}));
vi.mock("@/lib/api/fileBrowser", () => ({
  listDirectory: boundary.list,
  readFilePreview: boundary.read,
}));
vi.mock("@/lib/api/fuzzyFileSearch", () => ({
  searchProjectFiles: boundary.search,
}));
vi.mock("react-i18next", () => {
  const t = (key: string) => boundary.translations?.[key] ?? key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("./text-file-editor/TextFileEditorTabContent", () => ({
  TextFileEditorTabContent: ({ path }: { path: string }) => (
    <div data-testid="file-editor" data-path={path} />
  ),
}));
vi.mock("./FilePreviewPanel", () => ({
  FilePreviewPanel: ({
    context,
    mode,
  }: {
    context: {
      selectionPath: string;
      content: string;
      target: { kind: string };
    };
    mode: string;
  }) => (
    <div
      data-testid="file-preview"
      data-path={context.selectionPath}
      data-mode={mode}
      data-target-kind={context.target.kind}
    >
      {context.content}
    </div>
  ),
}));
const roots: Array<{ root: Root; container: HTMLDivElement }> = [];
const entry = (name: string) => ({
  name,
  path: `/work/${name}`,
  isDir: false,
  size: 0,
  modifiedAt: 0,
});
async function flush() {
  await act(async () => {
    await Promise.resolve();
  });
}
beforeEach(() => {
  boundary.translations = null;
  configureBooleanGateway(atomGateway, { "app-shell-file-tree-open": true });
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  boundary.list.mockResolvedValue({
    path: "/work",
    entries: [entry("one.ts"), entry("two.ts")],
    error: null,
  });
  boundary.read.mockImplementation(async (path: string) => ({
    path,
    content: `source:${path}`,
    size: 20,
    isBinary: false,
    error: null,
  }));
  boundary.search.mockResolvedValue([]);
});
afterEach(() => {
  for (const { root, container } of roots.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
  vi.resetAllMocks();
});
function render(
  initialPath: string | null = null,
  onSelect = vi.fn(),
  projectRootPath: string | null = "/work",
) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Probe() {
    const [path, setPath] = React.useState<string | null>(initialPath);
    const tab = React.useMemo(
      () => ({ tabId: `file:${path}`, kind: "files" as const, filePath: path }),
      [path],
    );
    return (
      <WorkspaceFileThreadSidePanelTab
        projectRootPath={projectRootPath}
        filePath={path}
        tab={tab}
        onSelectFile={(path, options) => {
          onSelect(path, options);
          setPath(path);
        }}
      />
    );
  }
  act(() => root.render(<Probe />));
  roots.push({ root, container });
  return container;
}
function fileButton(container: HTMLElement, name: string) {
  return Array.from(
    container.querySelectorAll<HTMLButtonElement>("button"),
  ).find((button) => button.textContent === name)!;
}
describe("Workspace file tab", () => {
  it.each([
    ["zh-CN", zhCN, "调整文件列表宽度"],
    ["zh-TW", zhTW, "調整檔案列表寬度"],
    ["en-US", enUS, "Resize file list"],
    ["ja-JP", jaJP, "ファイル一覧の幅を調整"],
    ["ko-KR", koKR, "파일 목록 너비 조정"],
  ] as const)(
    "%s 文件树宽度拖柄提供已翻译的可访问名称",
    async (_locale, translations, label) => {
      boundary.translations = translations;
      const container = render("/work/README.md");
      await flush();
      const separator = container.querySelector('[role="separator"]');
      expect(separator).not.toBeNull();
      expect(separator?.getAttribute("aria-label")).toBe(label);
      expect(separator?.getAttribute("aria-orientation")).toBe("vertical");
    },
  );

  it("没有项目目录时不发起目录读取，打开文件保持禁用", async () => {
    const container = render(null, vi.fn(), null);
    await flush();
    expect(boundary.list).not.toHaveBeenCalled();
    expect(
      fileButton(container, "agentChat.rightSurface.files.openFile").disabled,
    ).toBe(true);
    expect(
      container.querySelector('[data-testid="workspace-file-tree"]'),
    ).toBeNull();
  });

  it.each([
    { isBinary: true, error: null },
    { isBinary: false, error: "read failed" },
  ])(
    "二进制或读取失败沿当前文件预览显示不可用，不进入文本编辑器：%j",
    async ({ isBinary, error }) => {
      boundary.read.mockResolvedValue({
        path: "/work/binary.dat",
        content: null,
        size: 2048,
        isBinary,
        error,
      });
      const container = render("/work/binary.dat");
      await flush();
      expect(container.querySelector('[data-testid="file-editor"]')).toBeNull();
      expect(
        container
          .querySelector('[data-testid="file-preview"]')
          ?.getAttribute("data-target-kind"),
      ).toBe("unsupported");
      expect(
        container
          .querySelector('[data-testid="file-preview"]')
          ?.getAttribute("data-path"),
      ).toBe("/work/binary.dat");
    },
  );

  it("当前Files重新展开目录时刷新空缓存，展示后来产生的文件", async () => {
    let reads = 0;
    boundary.list.mockImplementation(async (path: string) => ({
      path,
      error: null,
      entries:
        path === "/work"
          ? [{ ...entry("images"), isDir: true }]
          : ++reads === 1
            ? []
            : [{ ...entry("image-1.jpg"), path: "/work/images/image-1.jpg" }],
    }));
    const container = render();
    await flush();
    act(() => fileButton(container, "images").click());
    await flush();
    expect(container.textContent).not.toContain("image-1.jpg");
    act(() => fileButton(container, "images").click());
    await flush();
    act(() => fileButton(container, "images").click());
    await flush();
    expect(boundary.list).toHaveBeenCalledWith("/work/images");
    expect(reads).toBe(2);
    expect(container.textContent).toContain("image-1.jpg");
  });

  it("default closed gives a direct file full width and Open file explicitly focuses the shared tree", async () => {
    configureBooleanGateway(atomGateway);
    const direct = render("/work/README.md");
    await flush();
    expect(
      direct.querySelector("[data-testid=workspace-file-tree]"),
    ).toBeNull();
    expect(direct.querySelector("[data-testid=file-editor]")).not.toBeNull();
    const empty = render();
    await flush();
    expect(empty.querySelector("[data-testid=workspace-file-tree]")).toBeNull();
    await act(async () =>
      fileButton(empty, "agentChat.rightSurface.files.openFile").click(),
    );
    expect(
      empty.querySelector("[data-testid=workspace-file-tree]"),
    ).not.toBeNull();
    expect(
      direct.querySelector("[data-testid=workspace-file-tree]"),
    ).not.toBeNull();
    expect(document.activeElement).toBe(empty.querySelector("input"));
    expect(atomGateway.update).toHaveBeenCalledExactlyOnceWith({
      key: "app-shell-file-tree-open",
      mutation: { op: "set", value: true },
    });
  });

  it("空Files首次选择固定，已有文件页的选择与双击分别传preview和固定", async () => {
    const select = vi.fn();
    const container = render(null, select);
    await flush();
    act(() => fileButton(container, "one.ts").click());
    expect(select).toHaveBeenLastCalledWith("/work/one.ts", {
      isPreview: false,
    });
    await flush();
    const second = fileButton(container, "two.ts");
    act(() => second.click());
    expect(select).toHaveBeenLastCalledWith("/work/two.ts", {
      isPreview: true,
    });
    await flush();
    expect(fileButton(container, "two.ts")).toBe(second);
    act(() =>
      second.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(select).toHaveBeenLastCalledWith("/work/two.ts", {
      isPreview: false,
    });
  });
  it("Markdown路径标签交给同一个可编辑文件owner", async () => {
    const container = render("/work/README.md");
    await flush();
    expect(
      container
        .querySelector('[data-testid="file-editor"]')
        ?.getAttribute("data-path"),
    ).toBe("/work/README.md");
  });
  it("读取真实文件树边界，选中文件进入文件预览而非Git审阅", async () => {
    const container = render();
    await flush();
    expect(boundary.list).toHaveBeenCalledWith("/work");
    expect(
      container.querySelector('[data-testid="workspace-changes-surface"]'),
    ).toBeNull();
    expect(container.textContent).toContain(
      "agentChat.rightSurface.files.selectFile",
    );
    act(() => fileButton(container, "one.ts").click());
    await flush();
    expect(boundary.read).toHaveBeenCalledWith(
      "/work/one.ts",
      expect.any(Number),
    );
    expect(
      container
        .querySelector('[data-testid="file-editor"]')
        ?.getAttribute("data-path"),
    ).toBe("/work/one.ts");
  });
  it("后选文件先返回时，旧读取不能覆盖当前路径和内容", async () => {
    let finish: ((value: unknown) => void) | undefined;
    boundary.read.mockImplementation((path: string) =>
      path.endsWith("one.ts")
        ? new Promise((resolve) => {
            finish = resolve;
          })
        : Promise.resolve({
            path,
            content: "second",
            size: 6,
            isBinary: false,
            error: null,
          }),
    );
    const container = render();
    await flush();
    act(() => fileButton(container, "one.ts").click());
    act(() => fileButton(container, "two.ts").click());
    await flush();
    await act(async () => {
      finish?.({
        path: "/work/one.ts",
        content: "stale-first",
        size: 11,
        isBinary: false,
        error: null,
      });
    });
    const preview = container.querySelector('[data-testid="file-editor"]')!;
    expect(preview.getAttribute("data-path")).toBe("/work/two.ts");
    expect(container.textContent).not.toContain("stale-first");
  });
  it("搜索经current fuzzy网关，迟到搜索结果不会回流", async () => {
    const finish: Array<(value: unknown) => void> = [];
    boundary.search.mockImplementation(
      () => new Promise((resolve) => finish.push(resolve)),
    );
    const container = render();
    await flush();
    const input = container.querySelector("input")!;
    const change = (value: string) =>
      act(() => {
        Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )!.set!.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    change("one");
    change("two");
    expect(boundary.search).toHaveBeenLastCalledWith(
      expect.objectContaining({ query: "two", rootPath: "/work" }),
    );
    await act(async () => {
      finish[1]([{ root: "/work", path: "two.ts" }]);
    });
    await act(async () => {
      finish[0]([{ root: "/work", path: "stale.ts" }]);
    });
    expect(container.textContent).toContain("two.ts");
    expect(container.textContent).not.toContain("stale.ts");
  });
});
