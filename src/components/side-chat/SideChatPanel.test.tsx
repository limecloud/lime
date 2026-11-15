import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { SideChatPanel } from "./SideChatPanel";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  workspace: vi.fn(),
}));
vi.mock("@/lib/api/agentRuntime/sessionClient", () => ({
  createAgentRuntimeSession: mocks.create,
}));
vi.mock("@/contexts/AppNavigationContext", () => ({
  useAppNavigationRequest: () => vi.fn(),
}));
vi.mock("@/components/agent/chat/AgentChatWorkspace", () => ({
  AgentChatWorkspace: (props: { initialSessionId?: string }) => {
    mocks.workspace(props);
    return <div>side-chat-workspace</div>;
  },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;

beforeEach(async () => {
  await changeLimeLocale("en-US");
  mocks.create.mockResolvedValue("side-session-1");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

describe("SideChatPanel", () => {
  it("打开时创建 ephemeral 会话并挂载独立聊天", async () => {
    await act(async () => {
      root.render(<SideChatPanel />);
    });
    await act(async () => {
      window.dispatchEvent(new CustomEvent("lime:toggle-side-chat"));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mocks.create).toHaveBeenCalledWith(
      undefined,
      expect.any(String),
      undefined,
      { ephemeral: true },
    );
    expect(mocks.workspace).toHaveBeenCalledWith(
      expect.objectContaining({ initialSessionId: "side-session-1" }),
    );
    expect(document.body.textContent).toContain("side-chat-workspace");
  });
});
