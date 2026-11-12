import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { listRecentThreads } from "@/lib/api/agentRuntime/sessionClient";
import { ArchivedSessionsDialog } from "./ArchivedSessionsDialog";

vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  listRecentThreads: vi.fn(),
}));

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.mocked(listRecentThreads).mockResolvedValue({
    sessions: [
      {
        id: "archived-1",
        name: "Archived chat",
        created_at: 1,
        updated_at: Date.now(),
      },
    ],
    nextCursor: null,
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = "";
});

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("ArchivedSessionsDialog", () => {
  it("lists archived sessions and restores one", async () => {
    const onRestore = vi.fn();
    act(() =>
      root.render(
        <ArchivedSessionsDialog
          open
          onOpenChange={vi.fn()}
          onRestore={onRestore}
          onOpenSession={vi.fn()}
        />,
      ),
    );
    await flush();

    const row = document.body.querySelector(
      '[data-testid="archived-session-row"]',
    );
    expect(row).not.toBeNull();
    expect(row?.textContent).toContain("Archived chat");

    await act(async () => {
      document.body
        .querySelector<HTMLButtonElement>(
          '[data-testid="archived-session-restore"]',
        )
        ?.click();
      await Promise.resolve();
    });
    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(
      document.body.querySelector('[data-testid="archived-session-row"]'),
    ).toBeNull();
  });

  it("filters archived chats by title", async () => {
    act(() =>
      root.render(
        <ArchivedSessionsDialog
          open
          onOpenChange={vi.fn()}
          onRestore={vi.fn()}
          onOpenSession={vi.fn()}
        />,
      ),
    );
    await flush();
    const input = document.body.querySelector<HTMLInputElement>(
      '[data-testid="archived-sessions-search"]',
    );
    expect(input).not.toBeNull();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )?.set;
      setter?.call(input, "missing");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
      await Promise.resolve();
    });
    expect(
      document.body.querySelector('[data-testid="archived-session-row"]'),
    ).toBeNull();
    expect(
      document.body.querySelector(
        '[data-testid="archived-sessions-no-match"]',
      ),
    ).not.toBeNull();
  });

  it("shows the empty state when nothing is archived", async () => {
    vi.mocked(listRecentThreads).mockResolvedValue({
      sessions: [],
      nextCursor: null,
    });
    act(() =>
      root.render(
        <ArchivedSessionsDialog
          open
          onOpenChange={vi.fn()}
          onRestore={vi.fn()}
          onOpenSession={vi.fn()}
        />,
      ),
    );
    await flush();
    expect(
      document.body.querySelector('[data-testid="archived-sessions-empty"]'),
    ).not.toBeNull();
  });
});
