import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ImportSettings } from ".";

const api = vi.hoisted(() => ({
  importCodexSkills: vi.fn(),
  readCodexSettings: vi.fn(),
  updateConfig: vi.fn(),
  ensureProjectWorkspace: vi.fn(),
  recordImport: vi.fn(),
  useImportHistory: vi.fn(),
  setImportAutoSyncEnabled: vi.fn(),
  useImportAutoSyncEnabled: vi.fn(),
  listCodexChats: vi.fn(),
  readCodexChat: vi.fn(),
  importCodexChat: vi.fn(),
}));

vi.mock("@/lib/api/externalAgentImport", () => ({
  importCodexSkills: api.importCodexSkills,
}));
vi.mock("@/lib/api/codexSettingsImport", () => ({
  readCodexSettings: api.readCodexSettings,
}));
vi.mock("@/lib/api/appConfig", () => ({
  updateConfig: api.updateConfig,
}));
vi.mock("@/lib/api/project", () => ({
  ensureProjectWorkspace: api.ensureProjectWorkspace,
}));
vi.mock("@/lib/importHistory", () => ({
  recordImport: api.recordImport,
  useImportHistory: api.useImportHistory,
}));
vi.mock("@/lib/importAutoSync", () => ({
  setImportAutoSyncEnabled: api.setImportAutoSyncEnabled,
  useImportAutoSyncEnabled: api.useImportAutoSyncEnabled,
}));
vi.mock("@/lib/api/codexChatImport", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@/lib/api/codexChatImport")>();
  return {
    ...original,
    listCodexChats: api.listCodexChats,
    readCodexChat: api.readCodexChat,
    importCodexChat: api.importCodexChat,
  };
});

let root: Root;
let container: HTMLDivElement;

function button(text: string): HTMLButtonElement {
  const found = [...container.querySelectorAll("button")].find(
    (item) => item.textContent?.trim() === text,
  );
  expect(found, text).toBeDefined();
  return found as HTMLButtonElement;
}

beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.clearAllMocks();
  api.useImportHistory.mockReturnValue([]);
  api.useImportAutoSyncEnabled.mockReturnValue(false);
  api.listCodexChats.mockResolvedValue({
    conversations: [],
    scannedFileCount: 0,
    totalFileCount: 0,
  });
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<ImportSettings />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});

describe("ImportSettings", () => {
  it("renders the page header and descriptive row copy", () => {
    const text = container.textContent ?? "";
    expect(text).toContain("将 Codex 的设置、技能和项目导入 Lime");
    expect(text).toContain("导入 Codex 设置");
    expect(text).toContain("导入审批策略、沙盒模式与项目列表；已有值不覆盖");
    expect(text).toContain("导入 Codex 项目");
    expect(text).toContain("将 Codex 配置中的本地项目加入 Lime");
    expect(button("导入设置")).toBeInstanceOf(HTMLButtonElement);
    expect(button("导入项目")).toBeInstanceOf(HTMLButtonElement);
  });

  it("shows the no-configuration message when Codex settings are missing", async () => {
    api.readCodexSettings.mockResolvedValue(null);
    await act(async () => button("导入设置").click());
    await act(async () => Promise.resolve());
    const text = container.textContent ?? "";
    expect(text).toContain("未找到 Codex 配置");
    expect(text).not.toContain("已导入设置，项目");
    expect(api.updateConfig).not.toHaveBeenCalled();
  });

  it("shows the no-project message when Codex projects are missing", async () => {
    api.readCodexSettings.mockResolvedValue({
      approvalPolicy: null,
      sandboxMode: null,
      projects: [],
    });
    await act(async () => button("导入项目").click());
    await act(async () => Promise.resolve());
    const text = container.textContent ?? "";
    expect(text).toContain("未找到 Codex 项目");
    expect(text).not.toContain("已导入 0 个项目");
    expect(api.ensureProjectWorkspace).not.toHaveBeenCalled();
  });
});
