import { afterEach, beforeEach } from "vitest";

import { installVitestNetworkGuard } from "./lib/vitest-network-guard";
import { resetConversationTabsForTest } from "../src/lib/conversationTabs";
import { resetConversationHistoryForTest } from "../src/lib/conversationHistory";
import { resetWorkspaceFullViewForTest } from "../src/lib/workspaceFullView";

installVitestNetworkGuard();

beforeEach(() => {
  installVitestNetworkGuard();
  resetConversationTabsForTest();
  resetConversationHistoryForTest();
  resetWorkspaceFullViewForTest();
});

afterEach(() => {
  installVitestNetworkGuard();
});
