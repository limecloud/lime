import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  expertAnalyticsStorageKeys,
  recordExpertCatalogEvent,
} from "./expertAnalytics";
describe("expert local events", () => {
  beforeEach(() => localStorage.clear());
  it("keeps local usage without calling Cloud or retaining sensitive metadata", async () => {
    const network = vi.spyOn(globalThis, "fetch");
    await recordExpertCatalogEvent({
      expertId: "research",
      releaseId: "release-1",
      eventName: "expert_chat_started",
      sourceSurface: "expert_plaza",
      metadata: {
        category: "research",
        prompt: "private prompt",
        assistantResponse: "private response",
      },
    });
    const saved = JSON.parse(
      localStorage.getItem(expertAnalyticsStorageKeys.queue)!,
    );
    expect(saved[0].metadata).toEqual({ category: "research" });
    expect(JSON.stringify(saved)).not.toContain("private");
    expect(network).not.toHaveBeenCalled();
    network.mockRestore();
  });
});
