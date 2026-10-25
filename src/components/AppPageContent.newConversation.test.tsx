import { Suspense, act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentPageParams } from "@/types/page";
import { AppPageContent } from "./AppPageContent";

const page = vi.hoisted(() => ({
  props: null as Record<string, unknown> | null,
}));
// Other page presentation is outside this committed Agent route contract.
vi.mock("./scheduled-tasks/ScheduledTasksPage", () => ({
  ScheduledTasksPage: () => null,
}));
vi.mock("./channels/ImConfigPage", () => ({ ImConfigPage: () => null }));
vi.mock("./settings-v2", () => ({ SettingsPage: () => null }));
vi.mock("@/features/plugin/ui/PluginWorkspaceTabs", () => ({
  PluginWorkspaceTabs: () => null,
}));
vi.mock("./agent/chat", () => ({
  LocalConversationPage: (props: Record<string, unknown>) => {
    page.props = props;
    return <div data-testid="agent-consumer" />;
  },
}));
const mounted: Array<() => void> = [];
afterEach(() => {
  act(() => {
    mounted.splice(0).forEach((close) => close());
  });
  vi.unstubAllGlobals();
});

describe("AppPageContent committed New intent boundary", () => {
  it("requested preview cannot forward fresh or reset time before the actual route commits", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const element = document.createElement("div");
    document.body.appendChild(element);
    const root = createRoot(element);
    mounted.push(() => {
      root.unmount();
      element.remove();
    });
    const startNewConversation = vi.fn();
    const before: AgentPageParams = {
      agentEntry: "conversation",
      initialSessionId: "old-session",
      newChatAt: 10,
    };
    const requested: AgentPageParams = {
      agentEntry: "new-task",
      newChatAt: 11,
      newConversationRequest: { id: 11, workspaceId: null, freshDraft: true },
    };
    const render = async (committed: AgentPageParams) => {
      await act(async () =>
        root.render(
          <Suspense fallback={null}>
            <AppPageContent
              navigationGuard={{
                register: () => () => {},
                pendingNavigation: false,
                saving: false,
                clearPendingNavigation: vi.fn(),
                discardPendingNavigation: vi.fn(),
              }}
              currentPage="agent"
              pageParams={committed}
              requestedPage="agent"
              requestedPageParams={requested}
              onNavigate={vi.fn()}
              onSettingsBack={vi.fn()}
              onAgentHasMessagesChange={vi.fn()}
              onStartNewConversation={startNewConversation}
            />
          </Suspense>,
        ),
      );
    };
    await render(before);
    expect(page.props?.newConversationRequest).toBeUndefined();
    expect(page.props?.newChatAt).toBeUndefined();
    await render({
      ...requested,
      newConversationRequest: { ...requested.newConversationRequest!, id: 12 },
    });
    expect(page.props?.newConversationRequest).toBeUndefined();
    expect(page.props?.newChatAt).toBeUndefined();
    await render(requested);
    expect(page.props?.newConversationRequest).toEqual(
      requested.newConversationRequest,
    );
    expect(page.props?.newChatAt).toBe(11);
    expect(page.props?.projectId).toBeUndefined();
    expect(page.props?.onStartNewConversation).toBe(startNewConversation);
  });
});
