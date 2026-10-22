import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { openInQueryClient } from "@/lib/openInTargets";
import { useFileTreeState } from "../right-surface/useFileTreeState";
import { FileSourceBreadcrumb } from "./FileSourceBreadcrumb";
const boundary = vi.hoisted(() => ({
  open: vi.fn(),
  list: vi.fn(),
  get: vi.fn(),
}));
vi.mock("@/lib/api/fileBrowser", () => ({ listDirectory: boundary.list }));
vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability: () => true,
}));
vi.mock("@/lib/api/openIn", () => ({
  openIn: {
    getTargets: boundary.get,
    detectTarget: async (params: { target: string }) => ({
      id: params.target,
      target: params.target,
      kind: "builtin",
      label: params.target === "fileManager" ? "Finder" : "Default application",
      available: true,
      icon: null,
    }),
    loadTargetIcon: async () => null,
    open: boundary.open,
  },
}));
let root: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  openInQueryClient.clear();
  boundary.open.mockResolvedValue(undefined);
  boundary.get.mockResolvedValue({
    targets: [
      {
        id: "systemDefault",
        target: "systemDefault",
        kind: "builtin",
        label: "Default application",
        available: true,
        icon: null,
      },
      {
        id: "fileManager",
        target: "fileManager",
        kind: "builtin",
        label: "Finder",
        available: true,
        icon: null,
      },
    ],
    availableTargets: ["systemDefault", "fileManager"],
    preferredTarget: null,
    mode: "native",
    discovery: "unavailable",
  });
  await changeLimeLocale("en-US");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  openInQueryClient.clear();
});
async function render() {
  function Probe() {
    const tree = useFileTreeState({
      loadFilePreview: async (path) => ({
        path,
        content: "",
        size: 0,
        isBinary: false,
      }),
      translate: (key) => key,
    });
    return (
      <FileSourceBreadcrumb
        path="/work/src/one.ts"
        cwd="/work"
        workspaceRoot="/work"
        tree={tree}
        onSelectFile={vi.fn()}
      />
    );
  }
  await act(async () => root.render(<Probe />));
}
async function openMenu(label: string) {
  const button = Array.from(host.querySelectorAll("nav button")).find(
    (candidate) => candidate.textContent === label,
  )!;
  await act(async () => {
    button.dispatchEvent(
      new MouseEvent("contextmenu", {
        bubbles: true,
        cancelable: true,
        button: 2,
      }),
    );
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return document.querySelector<HTMLElement>(
    '[data-testid="workspace-file-context-menu"]',
  )!;
}
describe("breadcrumb file menu consumer", () => {
  it.each([
    ["src", "/work/src", "workspace"],
    ["one.ts", "/work/src/one.ts", "file"],
  ])(
    "%s wraps only its actual button and preserves path/openMode",
    async (label, path, mode) => {
      await render();
      const menu = await openMenu(label);
      expect(menu.dataset.filePath).toBe(path);
      expect(menu.textContent).toContain("Open in Default application");
      expect(menu.textContent).toContain("Reveal in Finder");
      expect(menu.textContent?.includes("Save as")).toBe(mode === "file");
      expect(boundary.get).toHaveBeenCalledWith(
        expect.objectContaining({ path, cwd: "/work" }),
      );
      await act(async () =>
        menu
          .querySelector<HTMLElement>(
            '[data-testid="workspace-file-menu-open:systemDefault"]',
          )!
          .click(),
      );
      expect(boundary.open).toHaveBeenCalledWith(
        expect.objectContaining({
          path,
          cwd: "/work",
          openMode: mode,
          target: "systemDefault",
        }),
      );
      expect(boundary.open.mock.calls[0][0]).not.toHaveProperty(
        "persistPreferredTargetPath",
      );
      expect(boundary.list).not.toHaveBeenCalled();
      expect(host.querySelector("[data-file-breadcrumb-directory]")).toBeNull();
    },
  );
  it("Reveal uses the same fileManager target for the exact directory button", async () => {
    await render();
    const menu = await openMenu("src");
    await act(async () =>
      menu
        .querySelector<HTMLElement>(
          '[data-testid="workspace-file-menu-reveal-path"]',
        )!
        .click(),
    );
    expect(boundary.open).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/work/src",
        cwd: "/work",
        target: "fileManager",
        openMode: "workspace",
      }),
    );
  });
});
