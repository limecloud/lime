import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BottomTerminalPanel } from "./BottomTerminalPanel";
import { resetTerminalPanelPreferencesForTest, setTerminalPanelPreferences } from "@/lib/terminalPanelPreferences";

vi.mock("../components/XtermOutputPanel", () => ({
  XtermOutputPanel: ({ output }: { output: string }) => (
    <pre data-testid="terminal-output">{output}</pre>
  ),
}));

let container: HTMLDivElement;
const root = () => createRoot(container);

beforeEach(() => {
  resetTerminalPanelPreferencesForTest();
  container = document.createElement("div");
  document.body.appendChild(container);
});
afterEach(() => {
  container.remove();
});

describe("BottomTerminalPanel", () => {
  it("opens in bottom mode and renders the running command output", async () => {
    setTerminalPanelPreferences({ location: "bottom", showControl: true });
    const instance = root();
    await act(async () => {
      instance.render(
        <BottomTerminalPanel
          threadId="thread-1"
          turns={[{ id: "turn-1", thread_id: "thread-1", status: "completed" } as never]}
          items={[
            {
              id: "item-1",
              type: "command_execution",
              thread_id: "thread-1",
              turn_id: "turn-1",
              status: "in_progress",
              command_status: "inProgress",
              command: "pnpm test",
              aggregated_output: "passed",
            } as never,
          ]}
        />,
      );
    });
    expect(container.querySelector('[data-testid="bottom-terminal-panel"]')).not.toBeNull();
    expect(container.textContent).toContain("passed");
    act(() => instance.unmount());
  });

  it("opens from the workspace terminal action event", async () => {
    const instance = root();
    await act(async () => {
      instance.render(
        <BottomTerminalPanel
          threadId="thread-1"
          turns={[{ id: "turn-1", thread_id: "thread-1", status: "completed" } as never]}
          items={[
            {
              id: "item-1",
              type: "command_execution",
              thread_id: "thread-1",
              turn_id: "turn-1",
              status: "in_progress",
              command_status: "inProgress",
              command: "pnpm test",
              aggregated_output: "passed",
            } as never,
          ]}
        />,
      );
    });
    expect(container.querySelector('[data-testid="bottom-terminal-panel"]')).toBeNull();
    act(() => {
      window.dispatchEvent(
        new CustomEvent("lime:open-bottom-terminal", {
          detail: { threadId: "thread-1", itemId: "item-1" },
        }),
      );
    });
    expect(container.querySelector('[data-testid="bottom-terminal-panel"]')).not.toBeNull();
    act(() => instance.unmount());
  });
});
