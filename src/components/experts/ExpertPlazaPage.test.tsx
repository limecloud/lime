import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExpertPlazaPage } from "./ExpertPlazaPage";
import { changeLimeLocale } from "@/i18n/createI18n";

const mocks = vi.hoisted(() => ({
  account: null as {
    account: {
      generation: string;
      baseUrl: string;
      applicationId: string;
      environment: string;
    };
  } | null,
  listeners: new Set<() => void>(),
  version: 0,
  list: vi.fn(),
  read: vi.fn(),
}));
vi.mock("@/lib/cloudAccount", () => ({
  getCloudAccount: () => mocks.account,
  subscribeCloudAccount: (fn: () => void) => {
    mocks.listeners.add(fn);
    return () => mocks.listeners.delete(fn);
  },
  cloudAccountIdentity: (a: unknown) => (a ? JSON.stringify(a) : null),
  cloudAccountIdentityVersion: () => mocks.version,
}));
vi.mock("@/lib/api/productCatalog", () => ({
  listProductContent: mocks.list,
  readProductContent: mocks.read,
  productContentText: (c: {
    document: { translations: Record<string, unknown> };
  }) => c.document.translations["zh-CN"],
}));
const release = {
  id: "a".repeat(64),
  kind: "experts",
  key: "research",
  revision: 3,
  contentHash: "b".repeat(64),
  publishedAt: "2026-11-12T00:00:00Z",
  document: {
    translations: { "zh-CN": { title: "资料整理", summary: "核对来源" } },
    category: "research",
    tags: [],
  },
};
let container: HTMLDivElement, root: Root;
const navigate = vi.fn();
function setAccount(generation: string | null) {
  mocks.account = generation
    ? {
        account: {
          generation,
          baseUrl: "https://core.test",
          applicationId: "lime",
          environment: "sandbox",
        },
      }
    : null;
  mocks.version++;
  for (const listener of mocks.listeners) listener();
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 5; i++) await Promise.resolve();
  });
}
async function render() {
  act(() =>
    root.render(
      <ExpertPlazaPage onNavigate={navigate} currentProjectId="project-one" />,
    ),
  );
  await settle();
}
async function click(selector: string) {
  const button = container.querySelector<HTMLButtonElement>(selector);
  expect(button).not.toBeNull();
  await act(async () => {
    button!.click();
  });
  await settle();
}
describe("expert published content UI", () => {
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    await changeLimeLocale("zh-CN");
    localStorage.clear();
    mocks.account = null;
    mocks.listeners.clear();
    mocks.list.mockReset().mockResolvedValue([release]);
    mocks.read
      .mockReset()
      .mockResolvedValue({
        ...release,
        document: {
          ...release.document,
          instructions: "先核实原始来源，再列出证据。",
        },
      });
    navigate.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });
  it("uses built-in experts while signed out and creates a new project thread", async () => {
    await render();
    await click('[data-testid="expert-start-marketing-strategist"]');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        projectId: "project-one",
        autoRunInitialPromptOnMount: true,
        expertAgentLaunch: expect.objectContaining({
          catalogId: "local-seeded",
          launchMode: "new_thread",
        }),
      }),
    );
  });
  it("loads the selected published instructions into the existing conversation entry", async () => {
    setAccount("first");
    await render();
    await click('[data-testid="expert-start-research"]');
    expect(mocks.read).toHaveBeenCalledWith("experts", "research", {
      id: release.id,
      revision: 3,
      contentHash: release.contentHash,
    });
    expect(navigate).toHaveBeenCalledWith(
      "agent",
      expect.objectContaining({
        initialUserPrompt:
          expect.stringContaining("先核实原始来源，再列出证据。"),
        projectId: "project-one",
        initialSessionName: "资料整理",
      }),
    );
    expect(localStorage.getItem("lime:expert-catalog-cache:v1")).toBeNull();
  });
  it("shows directory failures and retries through the real catalog owner", async () => {
    setAccount("first");
    mocks.list.mockRejectedValueOnce(new Error("unavailable"));
    await render();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "专家目录加载失败",
    );
    const retry = [...container.querySelectorAll("button")].find(
      (b) => b.textContent === "重试",
    )!;
    await act(async () => retry.click());
    await settle();
    expect(
      container.querySelector('[data-testid="expert-start-research"]'),
    ).not.toBeNull();
    expect(mocks.list).toHaveBeenCalledTimes(2);
  });
  it("does not start a changed or invalid release", async () => {
    setAccount("first");
    mocks.read.mockRejectedValueOnce(
      new Error("product_catalog_release_changed"),
    );
    await render();
    await click('[data-testid="expert-start-research"]');
    expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "专家启动失败",
    );
  });
  it("discards a pending instruction read after logout", async () => {
    setAccount("first");
    let finish!: (v: unknown) => void;
    mocks.read.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    await render();
    act(() =>
      container
        .querySelector<HTMLButtonElement>(
          '[data-testid="expert-start-research"]',
        )!
        .click(),
    );
    await act(async () => {
      setAccount(null);
    });
    await settle();
    finish({
      ...release,
      document: { ...release.document, instructions: "private old content" },
    });
    await settle();
    expect(navigate).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("private old content");
  });
});
