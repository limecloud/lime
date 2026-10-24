import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { AgentThreadItem } from "@/lib/api/agentProtocol";
import { ThreadSummaryPanel } from "./ThreadSummaryPanel";
import { cleanBackgroundTerminals } from "@/lib/api/backgroundTerminals";
import type { AgentThreadTurn } from "../types";

vi.mock("@/lib/api/backgroundTerminals", () => ({
  cleanBackgroundTerminals: vi.fn(),
}));

const base = {
  thread_id: "thread-1",
  turn_id: "turn-1",
  sequence: 1,
  status: "completed",
  started_at: "2026-10-18T00:00:00Z",
  updated_at: "2026-10-18T00:00:00Z",
} as const;
const items: AgentThreadItem[] = [
  { ...base, id: "plan-old", type: "plan", text: "Superseded plan" },
  { ...base, id: "warning-1", type: "warning", message: "Keep in timeline" },
  { ...base, id: "plan-1", type: "plan", text: "Current canonical plan" },
  {
    ...base,
    id: "file-1",
    type: "file_artifact",
    path: "result.md",
    source: "tool",
    content: "Saved output",
  },
  {
    ...base,
    id: "search-1",
    type: "web_search",
    query: "Reference query",
    results: [{ title: "Reference", url: "https://example.com/reference" }],
  },
];
let root: Root;
let container: HTMLDivElement;
beforeEach(async () => {
  vi.mocked(cleanBackgroundTerminals).mockReset();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  await changeLimeLocale("en-US");
});

describe("Thread Summary canonical items and actions", () => {
  it("opens canonical background output and stops all through the current thread API with retry", async () => {
    const open = vi.fn();
    const refresh = vi.fn();
    let reject!: (error: Error) => void;
    vi.mocked(cleanBackgroundTerminals).mockImplementationOnce(
      () =>
        new Promise((_, fail) => {
          reject = fail;
        }),
    );
    const command: AgentThreadItem = {
      ...base,
      id: "background",
      type: "command_execution",
      status: "in_progress",
      command_status: "inProgress",
      command: "npm run dev",
      cwd: "/work",
    };
    act(() =>
      root.render(
        <ThreadSummaryPanel
          threadId="thread-1"
          turns={[
            {
              id: "turn-1",
              thread_id: "thread-1",
              status: "completed",
            } as AgentThreadTurn,
          ]}
          threadItems={[command]}
          onOpenBackgroundTerminal={open}
          onRefresh={refresh}
        />,
      ),
    );
    const section = container.querySelector(
      '[data-summary-section="background-tasks"]',
    )!;
    act(() =>
      (
        section.querySelector(
          'button[title="npm run dev"]',
        ) as HTMLButtonElement
      ).click(),
    );
    expect(open).toHaveBeenCalledWith(command);
    const stop = section.querySelector(
      'button[aria-label="Stop all background terminals"]',
    ) as HTMLButtonElement;
    act(() => {
      stop.click();
      stop.click();
    });
    expect(cleanBackgroundTerminals).toHaveBeenCalledTimes(1);
    expect(cleanBackgroundTerminals).toHaveBeenCalledWith("thread-1");
    expect(stop.disabled).toBe(true);
    await act(async () => reject(new Error("offline")));
    expect(section.querySelector('[role="alert"]')?.textContent).toBeTruthy();
    expect(refresh).not.toHaveBeenCalled();
    vi.mocked(cleanBackgroundTerminals).mockResolvedValueOnce({
      cleanedCount: 1,
    } as Awaited<ReturnType<typeof cleanBackgroundTerminals>>);
    await act(async () => stop.click());
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(section.querySelector('[role="alert"]')).toBeNull();
    expect(stop.disabled).toBe(false);
    expect(section.textContent).toContain("npm run dev");
  });
  it("opens canonical outputs, the latest plan and child threads while grouping Web search", () => {
    const file = vi.fn(),
      output = vi.fn(),
      child = vi.fn();
    act(() =>
      root.render(
        <ThreadSummaryPanel
          threadItems={items}
          canonicalChildren={[
            {
              name: "Reviewer",
              threadId: "child-1",
              sessionId: "session-child",
              parentThreadId: "thread-1",
              status: "running",
              updatedAtMs: 1,
            },
          ]}
          onFileClick={file}
          onOpenArtifactFromTimeline={output}
          onOpenSubagentSession={child}
        />,
      ),
    );
    expect(
      [...container.querySelectorAll("[data-summary-section]")].map((node) =>
        node.getAttribute("data-summary-section"),
      ),
    ).toEqual(["outputs", "plan", "background-subagents", "tool-sources"]);
    for (const title of ["result.md", "Plan", "Reviewer"]) {
      act(() =>
        (
          container.querySelector(
            `button[title="${title}"]`,
          ) as HTMLButtonElement
        ).click(),
      );
    }
    expect(output).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: "result.md",
        timelineItemId: "file-1",
      }),
    );
    expect(file).toHaveBeenCalledWith("plan.md", "Current canonical plan");
    expect(child).toHaveBeenCalledWith("child-1");
    expect(container.textContent).toContain("Web search");
    expect(container.textContent).not.toContain("Reference");
    expect(container.textContent).not.toContain("Keep in timeline");
    expect(container.textContent).not.toContain("Superseded plan");
  });

  it("hides absent sections and keeps section expansion independent of canonical refresh", () => {
    act(() =>
      root.render(
        <ThreadSummaryPanel
          threadItems={items.filter((item) => item.type === "plan")}
        />,
      ),
    );
    const button = container.querySelector(
      "[aria-expanded]",
    ) as HTMLButtonElement;
    act(() => button.click());
    expect(button.getAttribute("aria-expanded")).toBe("false");
    act(() =>
      root.render(
        <ThreadSummaryPanel
          threadItems={[
            ...items.filter((item) => item.type === "plan"),
            {
              ...base,
              id: "plan-2",
              type: "plan",
              text: "Next canonical revision",
            },
          ]}
        />,
      ),
    );
    expect(container.querySelector("[aria-expanded]")).toBe(button);
    expect(button.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("[data-summary-section]")).toHaveLength(
      1,
    );
  });

  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "renders translated Summary sections in %s",
    async (locale) => {
      await changeLimeLocale(locale);
      act(() =>
        root.render(
          <ThreadSummaryPanel threadItems={items} persistenceError />,
        ),
      );
      expect(container.textContent).not.toContain("agentChat.summary.");
      expect(
        container.querySelector("[role=status]")?.textContent,
      ).toBeTruthy();
    },
  );
});
