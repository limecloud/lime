import { webcrypto } from "node:crypto";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkbookController,
  workbookControllersAtom,
} from "@/components/artifact/workbook/WorkbookController";
import { importWorkbook } from "@/components/artifact/workbook/workbookDocument";
import { hashFileBytes } from "@/lib/artifact/fileRevision";
import { resolveFilePreviewTarget } from "./filePreviewTarget";
import { resolveFilePreviewModeState } from "./filePreviewModel";
import { type FilePreviewContext } from "./filePreviewTarget";

import zhCN from "@/i18n/resources/zh-CN/workspace.json";
import zhTW from "@/i18n/resources/zh-TW/workspace.json";
import enUS from "@/i18n/resources/en-US/workspace.json";
import jaJP from "@/i18n/resources/ja-JP/workspace.json";
import koKR from "@/i18n/resources/ko-KR/workspace.json";
import { FilePreviewTabContent } from "./FilePreviewTabContent";

const boundary = vi.hoisted(() => ({
  save: vi.fn(),
  copy: vi.fn(),
  error: vi.fn(),
  copyText: null as Record<string, string> | null,
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => boundary.copyText?.[key] ?? key,
  }),
}));
vi.mock("sonner", () => ({ toast: { error: boundary.error } }));
vi.mock("@/components/artifact", () => ({
  ArtifactRenderer: () => <div data-testid="workbook-content" />,
}));
vi.mock("@/lib/desktop-host/dialog", () => ({ save: boundary.save }));
vi.mock("@/lib/desktop-runtime", () => ({
  hasDesktopHostInvokeCapability: () => true,
}));
vi.mock("@/lib/api/fileBrowser", () => ({
  copyFile: boundary.copy,
  readFilePreview: vi.fn(),
  readFileBytes: vi.fn(),
  writeFileBytes: vi.fn(),
}));
const cleanup: Array<() => void> = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  boundary.copyText = enUS;
  boundary.save.mockResolvedValue("/export/report.csv");
});
afterEach(() => {
  for (const dispose of cleanup.splice(0)) dispose();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function setup() {
  const path = "/work/report.csv";
  let disk = new TextEncoder().encode("name,value\nold,001\n");
  const order: string[] = [];
  const files = {
    read: vi.fn(async () => disk.slice()),
    write: vi.fn(async (_path: string, bytes: Uint8Array) => {
      order.push("save-source");
      disk = bytes.slice();
    }),
  };
  const controller = new WorkbookController(
    path,
    {
      sourceSha256: await hashFileBytes(disk),
      sheets: await importWorkbook(disk, "csv"),
    },
    files,
  );
  controller.setEditing(true);
  expect(controller.openCellEditor("delimited", "A2")).toBe(true);
  controller.updateFormulaInput("active draft");
  const store = createStore();
  store.get(workbookControllersAtom).set(path, controller);
  const target = resolveFilePreviewTarget(
    {
      path,
      title: "report.csv",
      status: "ready",
      content: "name,value\nold,001\n",
    },
    {
      workspaceFile: { readFailed: "failed", binaryUnsupported: "unsupported" },
    },
  );
  const context = {
    title: "report.csv",

    selectionPath: path,
    content: "",

    target,
  } as FilePreviewContext;
  const modeState = resolveFilePreviewModeState(context);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  cleanup.push(() => {
    act(() => root.unmount());
    container.remove();
  });
  await act(async () => {
    root.render(
      <Provider store={store}>
        <FilePreviewTabContent
          tab={{ tabId: "file:report", kind: "files", filePath: path }}
          context={context}
          mode={modeState.defaultMode}
          modeState={modeState}
          translate={(key) => key}
          toolbarActions={<button aria-label="File tree">Tree</button>}
        />
      </Provider>,
    );
  });
  const download = () =>
    container.querySelector<HTMLButtonElement>(
      '[aria-label="' +
        boundary.copyText!["workspace.artifactToolbar.action.download"] +
        '"]',
    )!;
  return {
    container,
    download,
    controller,
    files,
    order,
    disk: () => disk.slice(),
  };
}

describe("Files 预览页头的原生保存副本", () => {
  it.each([
    ["zh-CN", zhCN],
    ["zh-TW", zhTW],
    ["en-US", enUS],
    ["ja-JP", jaJP],
    ["ko-KR", koKR],
  ] as const)(
    "%s 下载先提交活动编辑，再选择位置并复制源文件",
    async (_, copy) => {
      boundary.copyText = copy;
      const view = await setup();
      expect(view.download()).not.toBeNull();
      boundary.save.mockImplementation(async () => {
        view.order.push("choose-destination");
        expect(view.controller.getSnapshot().dirty).toBe(false);
        expect(new TextDecoder().decode(view.disk())).toContain("active draft");
        return "/export/report.csv";
      });
      boundary.copy.mockImplementation(async () => {
        view.order.push("copy-file");
      });
      await act(async () => {
        view.download().click();
        await vi.waitFor(() => expect(boundary.copy).toHaveBeenCalledTimes(1));
      });
      expect(view.order).toEqual([
        "save-source",
        "choose-destination",
        "copy-file",
      ]);
      expect(boundary.copy).toHaveBeenCalledWith(
        "/work/report.csv",
        "/export/report.csv",
      );
      expect(
        view.container.querySelector('[aria-label="File tree"]'),
      ).not.toBeNull();
      expect(view.container.textContent).not.toContain("/work/report.csv");
    },
  );

  it("取消位置选择不复制，源文件保持已提交的编辑", async () => {
    const view = await setup();
    boundary.save.mockResolvedValue(null);
    expect(view.download()).not.toBeNull();
    await act(async () => {
      view.download().click();
      await vi.waitFor(() => expect(boundary.save).toHaveBeenCalledTimes(1));
    });
    expect(boundary.copy).not.toHaveBeenCalled();
    expect(view.controller.getSnapshot().dirty).toBe(false);
    expect(new TextDecoder().decode(view.disk())).toContain("active draft");
  });

  it("原件冲突保留草稿，并阻止位置选择与复制", async () => {
    const view = await setup();
    view.files.read.mockResolvedValue(
      new TextEncoder().encode("external,version\n"),
    );
    expect(view.download()).not.toBeNull();
    await act(async () => {
      view.download().click();
      await vi.waitFor(() => expect(boundary.error).toHaveBeenCalled());
    });
    expect(boundary.save).not.toHaveBeenCalled();
    expect(boundary.copy).not.toHaveBeenCalled();
    expect(view.files.write).not.toHaveBeenCalled();
    expect(view.controller.getSnapshot().dirty).toBe(true);
  });
});
