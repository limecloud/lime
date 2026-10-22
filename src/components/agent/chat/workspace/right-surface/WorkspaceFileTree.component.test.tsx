import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import type { ProjectFileSearchResult } from "@/lib/api/fuzzyFileSearch";
import type { FileTreeState } from "./useFileTreeState";
import { WorkspaceFileTree } from "./WorkspaceFileTree";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const search = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api/fuzzyFileSearch", () => ({ searchProjectFiles: search }));
let root: Root;
let container: HTMLDivElement;
const select = vi.fn();
const toggleDirectory = vi.fn();
const state: FileTreeState = {
  directoryCache: {
    "/work": {
      path: "/work",
      parentPath: null,
      error: null,
      entries: [
        { name: "src", path: "/work/src", isDir: true, size: 0, modifiedAt: 0 },
      ],
    },
    "/work/src": {
      path: "/work/src",
      parentPath: "/work",
      error: null,
      entries: [
        {
          name: "ordinary.ts",
          path: "/work/src/ordinary.ts",
          isDir: false,
          size: 0,
          modifiedAt: 0,
        },
      ],
    },
  },
  expandedDirectories: { "/work/src": true },
  loadingDirectories: {},
  workspaceFileSelections: {},
  loadDirectory: vi.fn(),
  refreshDirectorySubtree: vi.fn(),
  toggleDirectory,
  selectWorkspaceFile: vi.fn(),
};
const hit = (path: string, resultRoot = "/work"): ProjectFileSearchResult => ({
  root: resultRoot,
  path,
  file_name: path.split(/[\\/]/).at(-1)!,
  score: 1,
  match_type: "file",
});
beforeEach(async () => {
  vi.clearAllMocks();
  search.mockResolvedValue([]);
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
function render(scope = "/work") {
  act(() =>
    root.render(
      <WorkspaceFileTree
        root={scope}
        state={state}
        selectedPath={null}
        onSelectFile={select}
      />,
    ),
  );
}
async function query(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    input.focus();
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return input;
}
function row(path: string) {
  return [
    ...container.querySelectorAll<HTMLButtonElement>('[role="treeitem"]'),
  ].find((item) => item.dataset.itemPath === path)!;
}
async function press(target: HTMLElement, key: string) {
  await act(async () =>
    target.dispatchEvent(
      new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }),
    ),
  );
}

describe("WorkspaceFileTree 真实搜索 DOM", () => {
  it("折叠搜索目录后加选仍消费首个文件，隐藏行不会丢失身份", async () => {
    search.mockResolvedValue([hit("src/one.ts"), hit("other.ts")]);
    render();
    await query("files");
    act(() => row("/work/src/one.ts").click());
    select.mockClear();
    const folder = row("/work/src");
    act(() => folder.focus());
    await press(folder, "ArrowLeft");
    expect(row("/work/src/one.ts")).toBeUndefined();
    expect(select).not.toHaveBeenCalled();
    await act(async () =>
      row("/work/other.ts").dispatchEvent(
        new MouseEvent("click", { bubbles: true, metaKey: true }),
      ),
    );
    expect(select).toHaveBeenCalledExactlyOnceWith("/work/src/one.ts", {
      isPreview: true,
    });
    expect(row("/work/other.ts").getAttribute("aria-selected")).toBe("true");
    await press(folder, "ArrowRight");
    expect(row("/work/src/one.ts").getAttribute("aria-selected")).toBe("true");
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("input 经 current fuzzy gateway 进入共享树，层级/键盘与preview打开同路", async () => {
    search.mockResolvedValue([
      hit("src/components/one.ts"),
      hit("src/components/two.ts"),
    ]);
    render();
    const input = await query("components");
    expect(search).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        query: "components",
        rootPath: "/work",
        cancellationToken: expect.any(String),
      }),
    );
    expect(container.querySelectorAll('[role="tree"]')).toHaveLength(1);
    expect(row("/work/src/components").textContent).toBe("src/components");
    expect(row("/work/src/components/one.ts").getAttribute("aria-level")).toBe(
      "2",
    );
    expect(
      container.querySelectorAll('[role="treeitem"][tabindex="0"]'),
    ).toHaveLength(1);
    expect(document.activeElement).toBe(input);
    const folder = row("/work/src/components");
    act(() => folder.focus());
    await press(folder, "ArrowRight");
    expect(document.activeElement).toBe(row("/work/src/components/one.ts"));
    await press(document.activeElement as HTMLElement, "End");
    const last = row("/work/src/components/two.ts");
    expect(document.activeElement).toBe(last);
    expect(select).not.toHaveBeenCalled();
    act(() => last.click());
    expect(select).toHaveBeenLastCalledWith("/work/src/components/two.ts", {
      isPreview: true,
    });
    act(() =>
      last.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })),
    );
    expect(select).toHaveBeenLastCalledWith("/work/src/components/two.ts", {
      isPreview: false,
    });
  });

  it("query 重置搜索展开/选择，清空恢复原目录展开且不污染缓存", async () => {
    search.mockResolvedValue([hit("src/components/one.ts")]);
    const before = JSON.stringify(state.directoryCache);
    render();
    await query("one");
    act(() => row("/work/src/components/one.ts").click());
    expect(
      row("/work/src/components/one.ts").getAttribute("aria-selected"),
    ).toBe("true");
    act(() => row("/work/src/components").click());
    expect(row("/work/src/components/one.ts")).toBeUndefined();
    const input = await query("two");
    expect(row("/work/src/components").getAttribute("aria-expanded")).toBe(
      "true",
    );
    expect(
      row("/work/src/components/one.ts").getAttribute("aria-selected"),
    ).toBe("false");
    expect(document.activeElement).toBe(input);
    await query("");
    expect(row("/work/src").getAttribute("aria-expanded")).toBe("true");
    expect(row("/work/src/ordinary.ts")).toBeDefined();
    expect(toggleDirectory).not.toHaveBeenCalled();
    expect(JSON.stringify(state.directoryCache)).toBe(before);
  });

  it("root/query 在途立即隐藏旧scope，迟到成功与失败不回流", async () => {
    const requests: Array<{
      resolve: (files: ProjectFileSearchResult[]) => void;
      reject: (error: Error) => void;
    }> = [];
    search.mockImplementation(
      () =>
        new Promise<ProjectFileSearchResult[]>((resolve, reject) =>
          requests.push({ resolve, reject }),
        ),
    );
    render();
    await query("old");
    await act(async () => requests[0].resolve([hit("old.ts")]));
    expect(row("/work/old.ts")).toBeDefined();
    await query("next");
    expect(row("/work/old.ts")).toBeUndefined();
    render("/other");
    expect(container.querySelector('[role="tree"]')).toBeNull();
    expect(container.querySelector('[role="status"]')).not.toBeNull();
    await act(async () => requests[1].reject(new Error("old-scope-error")));
    expect(container.textContent).not.toContain("old-scope-error");
    await act(async () => requests[2].resolve([hit("new.ts", "/other")]));
    expect(row("/other/new.ts")).toBeDefined();
    expect(row("/work/old.ts")).toBeUndefined();
    await query("unmounted");
    await act(async () => root.render(null));
    await act(async () => requests[3].resolve([hit("late.ts", "/other")]));
    expect(container.childElementCount).toBe(0);
  });

  it("大量搜索命中复用viewport与sticky，滚动不挂载全部结果", async () => {
    search.mockResolvedValue(
      Array.from({ length: 500 }, (_, index) =>
        hit(`src/nested/file${index}.ts`),
      ),
    );
    render();
    await query("file");
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(
      40,
    );
    const scroll = container.querySelector<HTMLDivElement>(
      "[data-file-tree-virtualized-scroll]",
    )!;
    act(() => {
      scroll.scrollTop = 2800;
      scroll.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    const sticky = container.querySelector<HTMLButtonElement>(
      "[data-file-tree-sticky-row]",
    )!;
    expect(sticky.textContent).toBe("src/nested");
    expect(sticky.closest('[aria-hidden="true"]')).not.toBeNull();
    expect(sticky.hasAttribute("role")).toBe(false);
    expect(container.querySelectorAll('[role="treeitem"]').length).toBeLessThan(
      50,
    );
    act(() => sticky.click());
    expect(container.querySelector("[data-file-tree-sticky-row]")).toBeNull();
    expect(document.activeElement).toBe(row("/work/src/nested"));
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
    "%s 保留可访问搜索、空与失败终态",
    async (locale) => {
      await changeLimeLocale(locale);
      render();
      const t = getLimeI18n().getFixedT(locale, "agent");
      expect(container.querySelector("input")!.getAttribute("aria-label")).toBe(
        t("agentChat.rightSurface.files.search"),
      );
      await query("none");
      expect(container.textContent).toContain(
        t("agentChat.rightSurface.files.noResults"),
      );
      expect(container.querySelector('[role="tree"]')).toBeNull();
      search.mockRejectedValueOnce(new Error("search failed"));
      await query("failed");
      expect(container.querySelector('[role="alert"]')!.textContent).toBe(
        "search failed",
      );
      expect(container.textContent).not.toContain(
        t("agentChat.rightSurface.files.noResults"),
      );
    },
  );
});
