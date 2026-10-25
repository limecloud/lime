import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/agent/chat/hooks/agentChatStorage", () => ({
  loadPersisted: (key: string, fallback: unknown) => {
    const value = localStorage.getItem(key);
    return value === null ? fallback : JSON.parse(value);
  },
  savePersisted: (key: string, value: unknown) =>
    localStorage.setItem(key, JSON.stringify(value)),
}));

const owner = {
  sessionId: "presentation-session",
  threadId: "presentation-thread",
};

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("browser presentation recovery", () => {
  it("restores the selected native tab after the renderer module is recreated", async () => {
    const first = await import("./browserPresentation");
    first.rememberBrowserPresentation(owner, "native-tab");
    vi.resetModules();
    const returned = await import("./browserPresentation");
    expect(returned.readBrowserPresentation(owner)).toBe("native-tab");
    expect(
      returned.readBrowserPresentation({ ...owner, threadId: "other" }),
    ).toBeNull();
    expect(
      returned.readBrowserPresentation({ ...owner, sessionId: "other" }),
    ).toBeNull();
  });

  it("preserves explicit collapse after a reload", async () => {
    const first = await import("./browserPresentation");
    first.rememberBrowserPresentation(owner, "native-tab");
    first.rememberBrowserPresentation(owner, null);
    vi.resetModules();
    const returned = await import("./browserPresentation");
    expect(returned.readBrowserPresentation(owner)).toBeNull();
  });

  it("does not persist a tab without a canonical owner", async () => {
    const presentation = await import("./browserPresentation");
    presentation.rememberBrowserPresentation(
      { ...owner, threadId: null },
      "native-tab",
    );
    expect(localStorage.length).toBe(0);
  });

  it("retains navigation after cold start while accepting only web URLs", async () => {
    const first = await import("./browserPresentation");
    first.rememberBrowserPresentation(
      owner,
      "expired-tab",
      "https://news.baidu.com/",
    );
    vi.resetModules();
    const returned = await import("./browserPresentation");
    expect(returned.readBrowserPresentationUrl(owner)).toBe(
      "https://news.baidu.com/",
    );
    expect(returned.hasBrowserPresentation(owner)).toBe(true);
    first.rememberBrowserPresentation(owner, "tab", "file:///tmp/private");
    expect(returned.readBrowserPresentationUrl(owner)).toBeNull();
    first.rememberBrowserPresentation(owner, null);
    expect(returned.readBrowserPresentationUrl(owner)).toBeNull();
    expect(returned.hasBrowserPresentation(owner)).toBe(true);
  });
});
