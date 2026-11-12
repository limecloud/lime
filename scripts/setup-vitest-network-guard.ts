import { afterEach, beforeEach } from "vitest";

import { installVitestNetworkGuard } from "./lib/vitest-network-guard";
import { resetConversationTabsForTest } from "../src/lib/conversationTabs";
import { resetConversationHistoryForTest } from "../src/lib/conversationHistory";

installVitestNetworkGuard();

beforeEach(() => {
  installVitestNetworkGuard();
  resetConversationTabsForTest();
  resetConversationHistoryForTest();
});

afterEach(() => {
  installVitestNetworkGuard();
});
