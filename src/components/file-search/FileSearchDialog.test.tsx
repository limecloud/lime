import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { FileSearchHost } from "./FileSearchDialog";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  search: vi.fn(),
  clipboard: vi.fn(),
}));

vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  getAgentRuntimeSession: mocks.getSession,
}));
vi.mock("@/lib/api/fuzzyFileSearch", () => ({
  searchProjectFiles: mocks.search,
}));
vi.mock("@/lib/conversationTabs", () => ({
  getConversationTabsSnapshot: () => ({ activeSessionId: "session-1" }),
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  mocks.getSession.mockResolvedValue({ working_dir: "/workspace" });
  mocks.search.mockResolvedValue([
    {
      file_name: "index.ts",
      path: "src/index.ts",
      root: "/workspace",
      score: 1,
      match_type: "fuzzy",
    },
  ]);
  Object.assign(navigator, { clipboard: { writeText: mocks.clipboard } });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

async function open() {
  await act(async () => {
    root.render(<FileSearchHost />);
    await Promise.resolve();
  });
  await act(async () => {
    window.dispatchEvent(new CustomEvent("lime:open-file-search"));
    await Promise.resolve();
    await Promise.resolve();
  });
}

function input() {
  return document.querySelector<HTMLInputElement>(
    'input[aria-label="Search files"]',
  )!;
}

describe("FileSearchHost", () => {
  it("按当前会话工作目录搜索并复制绝对路径", async () => {
    vi.useFakeTimers();
    try {
      await open();
      const field = input();
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      await act(async () => {
        setter?.call(field, "index");
        field.dispatchEvent(new Event("input", { bubbles: true }));
        vi.advanceTimersByTime(150);
        await Promise.resolve();
        await Promise.resolve();
      });
      expect(mocks.search).toHaveBeenCalledWith(
        expect.objectContaining({ query: "index", rootPath: "/workspace" }),
      );
      const row = Array.from(document.querySelectorAll("button")).find(
        (button) => button.textContent?.includes("index.ts"),
      );
      expect(row).toBeTruthy();
      await act(async () => {
        row?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        await Promise.resolve();
      });
      expect(mocks.clipboard).toHaveBeenCalledWith("/workspace/src/index.ts");
    } finally {
      vi.useRealTimers();
    }
  });
});
