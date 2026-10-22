import { act, useEffect, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DirectoryListing } from "@/lib/api/fileBrowser";
import { useFileTreeState } from "../right-surface/useFileTreeState";
import { FileSourceBreadcrumb } from "./FileSourceBreadcrumb";
import { WorkspaceFileTree } from "../right-surface/WorkspaceFileTree";

const boundary = vi.hoisted(() => ({ list: vi.fn(), select: vi.fn() }));
vi.mock("@/lib/api/fileBrowser", () => ({ listDirectory: boundary.list }));
vi.mock("@/lib/api/fuzzyFileSearch", () => ({ searchProjectFiles: vi.fn() }));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
const translate = (key: string) => key;
const preview = async (path: string) => ({
  path,
  content: "",
  size: 0,
  isBinary: false,
});
function listing(path: string): DirectoryListing {
  const names =
    path === "/work"
      ? ["src/", ".hidden", "output_image.jpg"]
      : ["nested/", "one.ts", "two.ts"];
  return {
    path,
    parentPath: null,
    error: null,
    entries: names.map((name) => ({
      name: name.replace(/\/$/, ""),
      path: `${path}/${name.replace(/\/$/, "")}`,
      isDir: name.endsWith("/"),
      size: 0,
      modifiedAt: 0,
    })),
  };
}
let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  boundary.list.mockImplementation(async (path: string) => listing(path));
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  document.getSelection()?.removeAllRanges();
  vi.resetAllMocks();
});
async function render(path = "/work/src/one.ts") {
  function Probe() {
    const [selected, setSelected] = useState(path);
    const tree = useFileTreeState({
      loadFilePreview: preview,
      translate: translate,
    });
    const { loadDirectory } = tree;
    useEffect(() => {
      void loadDirectory("/work");
    }, [loadDirectory]);
    const select = (file: string) => {
      boundary.select(file);
      setSelected(file);
    };
    return (
      <>
        <FileSourceBreadcrumb
          path={selected}
          workspaceRoot="/work"
          tree={tree}
          onSelectFile={select}
        />
        <WorkspaceFileTree
          root="/work"
          state={tree}
          selectedPath={selected}
          onSelectFile={select}
        />
      </>
    );
  }
  await act(async () => root.render(<Probe />));
}
async function click(label: string, scope: HTMLElement = host) {
  const button = Array.from(
    scope.querySelectorAll<HTMLButtonElement>("button"),
  ).find((node) => node.textContent === label)!;
  expect(button, label).toBeDefined();
  await act(async () => button.click());
}
const menu = () =>
  document.querySelector<HTMLElement>("[data-file-breadcrumb-directory]")!;

describe("文件路径目录导航", () => {
  it("目录段展开active路径并显示隐藏文件，与主树共享读取但不共享展开状态", async () => {
    await render();
    await click("src", host.querySelector("nav")!);
    expect(menu().textContent).toContain("two.ts");
    expect(menu().textContent).toContain(".hidden");
    expect(menu().textContent).toContain("output_image.jpg");
    expect(
      host.querySelector('[data-testid="workspace-file-tree"]')!.textContent,
    ).not.toContain("two.ts");
    await click("two.ts", menu());
    expect(menu()).toBeNull();
    expect(boundary.select).toHaveBeenCalledExactlyOnceWith("/work/src/two.ts");
    expect(host.querySelector("nav")!.textContent).toBe("worksrctwo.ts");
  });
  it("末段显示siblings，文件夹仅在显式展开后读取", async () => {
    await render();
    boundary.list.mockClear();
    await click("one.ts", host.querySelector("nav")!);
    expect(boundary.list).toHaveBeenCalledExactlyOnceWith("/work/src");
    expect(menu().textContent).toContain("two.ts");
    expect(
      menu()
        .querySelector('[title="/work/src/nested"]')!
        .getAttribute("aria-expanded"),
    ).toBe("false");
    await click("nested", menu());
    expect(boundary.list).toHaveBeenLastCalledWith("/work/src/nested");
  });
  it("失败显示alert，重开重试可恢复", async () => {
    await render();
    boundary.list.mockRejectedValueOnce(new Error("permission denied"));
    await click("one.ts", host.querySelector("nav")!);
    expect(menu().querySelector('[role="alert"]')!.textContent).toBe(
      "agentChat.fileEditor.breadcrumb.directoryError",
    );
    await click("one.ts", host.querySelector("nav")!);
    await click("one.ts", host.querySelector("nav")!);
    expect(menu().querySelector('[role="alert"]')).toBeNull();
    expect(menu().textContent).toContain("two.ts");
  });
  it("主树与菜单并发读取同目录时只发一次请求", async () => {
    let finish!: (value: DirectoryListing) => void;
    boundary.list.mockImplementationOnce(
      () =>
        new Promise<DirectoryListing>((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    await click("work", host.querySelector("nav")!);
    expect(boundary.list).toHaveBeenCalledExactlyOnceWith("/work");
    expect(menu().querySelector('[role="status"]')).not.toBeNull();
    await act(async () => finish(listing("/work")));
    expect(menu().textContent).toContain(".hidden");
    expect(
      host.querySelector('[data-testid="workspace-file-tree"]')!.textContent,
    ).toContain(".hidden");
  });
  it("超出工作区仍显示路径，但不提供伪目录操作；整选复制保留开头/", async () => {
    await render("/outside/src/one.ts");
    const nav = host.querySelector("nav")!;
    expect(nav.querySelector("button")).toBeNull();
    const list = nav.querySelector("ol")!;
    const range = document.createRange();
    range.selectNodeContents(list);
    document.getSelection()!.addRange(range);
    const setData = vi.fn();
    const event = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "clipboardData", { value: { setData } });
    act(() => list.dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(setData).toHaveBeenCalledWith("text/plain", "/outside/src/one.ts");
  });
});
