import { webcrypto } from "node:crypto";
import { Provider, createStore } from "jotai";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashFileBytes } from "@/lib/artifact/fileRevision";
import { configureBooleanGateway } from "@/hooks/usePersistedBooleanAtom.testFixtures";
import {
  WorkbookController,
  workbookControllersAtom,
} from "@/components/artifact/workbook/WorkbookController";
import { importWorkbook } from "@/components/artifact/workbook/workbookDocument";
import { useWorkbookController } from "@/components/artifact/workbook/useWorkbookController";
import {
  PresentationController,
  presentationControllersAtom,
} from "@/components/artifact/presentation/PresentationController";
import { usePresentationController } from "@/components/artifact/presentation/usePresentationController";
import { importPresentationDocument } from "@/components/artifact/presentation/presentationDocument";
import {
  presentationElements,
  presentationElementText,
} from "@/components/artifact/presentation/presentationElements";
import { original } from "@/components/artifact/presentation/presentationSlidesPackage.testFixtures";
import { WorkspaceFileThreadSidePanelTab } from "./WorkspaceFileThreadSidePanelTab";
import { FileTabLifecycleProvider } from "./text-file-editor/FileTabLifecycle";
import { useFileTabCloseGuard } from "./text-file-editor/useFileTabCloseGuard";
import type { ThreadSidePanelTab } from "./right-surface/threadSidePanelTabs";

const gateway = vi.hoisted(() => ({
  read: vi.fn(),
  update: vi.fn(),
  listen: vi.fn(),
}));
vi.mock("@/lib/api/persistedAtoms", () => ({
  sendPersistedAtomState: gateway.read,
  updatePersistedAtomState: gateway.update,
  listenPersistedAtomUpdates: gateway.listen,
}));
vi.mock("@/lib/api/fileBrowser", () => ({
  listDirectory: vi.fn(),
  readFileBytes: vi.fn(),
  writeFileBytes: vi.fn(),
  readFilePreview: async (path: string) => ({
    path,
    content: null,
    size: 100,
    isBinary: true,
    error: null,
  }),
}));
vi.mock("react-i18next", () => {
  const t = (key: string) => key;
  return { useTranslation: () => ({ t }) };
});
vi.mock("./FilePreviewPanel", () => ({
  FilePreviewPanel: ({ context }: { context: { selectionPath: string } }) =>
    context.selectionPath.endsWith(".pptx") ? (
      <PresentationPreview path={context.selectionPath} />
    ) : (
      <WorkbookPreview path={context.selectionPath} />
    ),
}));
function WorkbookPreview({ path }: { path: string }) {
  useWorkbookController(path);
  return <div data-testid="office-preview" />;
}
function PresentationPreview({ path }: { path: string }) {
  usePresentationController(path);
  return <div data-testid="office-preview" />;
}
const mounted: Array<{ root: Root; node: HTMLDivElement }> = [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("crypto", webcrypto);
  configureBooleanGateway(gateway, { "app-shell-file-tree-open": false });
});
afterEach(() => {
  for (const { root, node } of mounted.splice(0)) {
    act(() => root.unmount());
    node.remove();
  }
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
async function setup(kind: "workbook" | "presentation" = "workbook") {
  const path = kind === "workbook" ? "/work/data.csv" : "/work/slides.pptx";
  let disk =
    kind === "workbook"
      ? new TextEncoder().encode("name,value\nold,001\n")
      : original();
  const files = {
    read: vi.fn(async () => disk.slice()),
    write: vi.fn(async (_path: string, bytes: Uint8Array) => {
      disk = bytes.slice();
    }),
  };
  const store = createStore();
  let controller: WorkbookController | PresentationController;
  let edit: (value: string) => void;
  let replace: () => void;
  if (kind === "workbook") {
    const document = {
      sourceSha256: await hashFileBytes(disk),
      sheets: await importWorkbook(disk, "csv"),
    };
    const workbook = new WorkbookController(path, document, files);
    workbook.setEditing(true);
    controller = workbook;
    store.get(workbookControllersAtom).set(path, workbook);
    edit = (value) => {
      expect(workbook.openCellEditor("delimited", "A2")).toBe(true);
      workbook.updateFormulaInput(value);
    };
    replace = () => {
      store
        .get(workbookControllersAtom)
        .set(path, new WorkbookController(path, document, files));
    };
  } else {
    const document = await importPresentationDocument(
      disk,
      new AbortController().signal,
    );
    const presentation = new PresentationController(path, document, files);
    presentation.setEditingEnabled(true);
    controller = presentation;
    store.get(presentationControllersAtom).set(path, presentation);
    const element = presentationElements(document, document.slideIds[0]).find(
      (node) => presentationElementText(node) !== undefined,
    )!;
    edit = (value) => {
      expect(presentation.textActivateBlockEnd(element.id)).toBe(true);
      presentation.textHandleInput(value);
    };
    replace = () => {
      store
        .get(presentationControllersAtom)
        .set(path, new PresentationController(path, document, files));
    };
  }
  const file: ThreadSidePanelTab = {
    kind: "files",
    tabId: `file:${path}`,
    filePath: path,
    contentInstance: crypto.randomUUID(),
  };
  const node = document.createElement("div");
  document.body.appendChild(node);
  const root = createRoot(node);
  mounted.push({ root, node });
  const close = vi.fn();
  let lifecycle!: ReturnType<typeof useFileTabCloseGuard>;
  function Probe({ tab }: { tab: ThreadSidePanelTab }) {
    lifecycle = useFileTabCloseGuard([tab], close);
    return (
      <FileTabLifecycleProvider lifecycle={lifecycle}>
        <WorkspaceFileThreadSidePanelTab
          filePath={path}
          tab={tab}
          onSelectFile={() => {}}
        />
        {lifecycle.confirmation}
      </FileTabLifecycleProvider>
    );
  }
  const render = async (tab = file) => {
    await act(async () => {
      root.render(
        <Provider store={store}>
          <Probe tab={tab} />
        </Provider>,
      );
    });
    expect(node.querySelector('[data-testid="office-preview"]')).not.toBeNull();
  };
  await render();
  act(() => edit("UNSAVED_OFFICE_EDIT"));
  return {
    path,
    file,
    node,
    files,
    controller,
    disk: () => disk,
    close,
    render,
    replace,
    get: () => lifecycle,
  };
}
describe("Files Office preview close lifecycle", () => {
  it("已在途写盘期间关闭继续等待同一保存，重复关闭不产生第二次写入", async () => {
    const view = await setup();
    let finish!: () => void;
    const write = view.files.write.getMockImplementation()!;
    view.files.write.mockImplementationOnce(
      (path, bytes) =>
        new Promise<void>((resolve) => {
          finish = () => {
            void write(path, bytes).then(resolve);
          };
        }),
    );
    let saving!: Promise<boolean>;
    act(() => {
      saving = view.controller.flushPublicFile();
    });
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => {
      view.get().requestClose(view.file.tabId);
      view.get().requestClose(view.file.tabId);
    });
    expect(view.close).not.toHaveBeenCalled();
    await act(async () => {
      finish();
      expect(await saving).toBe(true);
    });
    expect(view.close).toHaveBeenCalledTimes(1);
    expect(view.files.write).toHaveBeenCalledTimes(1);
    expect(view.controller.getSnapshot().dirty).toBe(false);
  });
  it.each(["workbook", "presentation"] as const)(
    "%s活跃编辑先写回原文件，完全clean后才关闭",
    async (kind) => {
      const view = await setup(kind);
      await act(async () => {
        view.get().requestClose(view.file.tabId);
        await vi.waitFor(() =>
          expect(view.close).toHaveBeenCalledWith(view.file.tabId),
        );
      });
      expect(view.files.write).toHaveBeenCalledTimes(1);
      expect(view.files.write.mock.calls[0][0]).toBe(view.path);
      expect(view.controller.getSnapshot()).toMatchObject({
        dirty: false,
        saving: false,
      });
      expect(view.close).toHaveBeenCalledWith(view.file.tabId);
      if (kind === "workbook") {
        expect((await importWorkbook(view.disk(), "csv"))[0].cells.A2.raw).toBe(
          "UNSAVED_OFFICE_EDIT",
        );
      } else {
        const document = await importPresentationDocument(
          view.disk(),
          new AbortController().signal,
        );
        expect(
          presentationElements(document, document.slideIds[0]).some((node) =>
            presentationElementText(node)?.includes("UNSAVED_OFFICE_EDIT"),
          ),
        ).toBe(true);
      }
    },
  );
  it.each(["workbook", "presentation"] as const)(
    "%s保存失败保留草稿，只有显式放弃才关闭",
    async (kind) => {
      const view = await setup(kind);
      view.files.read.mockRejectedValue(new Error("disk unavailable"));
      await act(async () => {
        view.get().requestClose(view.file.tabId);
        await vi.waitFor(() =>
          expect(view.controller.getSnapshot()).toMatchObject({
            failure: "saveFailed",
            saving: false,
          }),
        );
      });
      expect(view.close).not.toHaveBeenCalled();
      expect(view.controller.getSnapshot().dirty).toBe(true);
      const cancel = document.querySelector<HTMLButtonElement>(
        '[data-testid="discard-file-changes-cancel"]',
      );
      expect(cancel).not.toBeNull();
      act(() => cancel!.click());
      expect(view.controller.getSnapshot().dirty).toBe(true);
      act(() => view.get().requestClose(view.file.tabId));
      await vi.waitFor(async () => {
        await act(async () => {});
        expect(
          document.querySelector('[data-testid="discard-file-changes-dialog"]'),
        ).not.toBeNull();
      });
      act(() =>
        document
          .querySelector<HTMLButtonElement>(
            '[data-testid="discard-file-changes-confirm"]',
          )!
          .click(),
      );
      expect(view.controller.getSnapshot().dirty).toBe(false);
      expect(view.files.write).not.toHaveBeenCalled();
      expect(view.close).toHaveBeenCalledTimes(1);
    },
  );
  it.each(["tab", "controller"] as const)(
    "保存期间%s被替换，旧结果无权关闭新内容",
    async (change) => {
      const view = await setup();
      let finish!: () => void;
      view.files.read.mockImplementationOnce(
        () =>
          new Promise<Uint8Array>((resolve) => {
            finish = () => resolve(view.disk().slice());
          }),
      );
      act(() => view.get().requestClose(view.file.tabId));
      expect(view.close).not.toHaveBeenCalled();
      if (change === "controller") view.replace();
      await view.render(
        change === "tab"
          ? { ...view.file, contentInstance: crypto.randomUUID() }
          : view.file,
      );
      await act(async () => {
        finish();
        await vi.waitFor(() =>
          expect(view.controller.getSnapshot().saving).toBe(false),
        );
      });
      expect(view.close).not.toHaveBeenCalled();
    },
  );
  it("另存等文件动作委托同一Office保存对象，失败不关闭标签", async () => {
    const view = await setup();
    view.files.read.mockRejectedValue(new Error("conflict"));
    let result: boolean | undefined;
    await act(async () => {
      result = await view.get().saveFile(view.path);
    });
    expect(result).toBe(false);
    expect(view.controller.getSnapshot().dirty).toBe(true);
    expect(view.close).not.toHaveBeenCalled();
    expect(view.get().confirmation).toBeNull();
  });
});
