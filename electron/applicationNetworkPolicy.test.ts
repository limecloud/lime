import { describe, expect, it, vi } from "vitest";
import {
  ApplicationNetworkPolicy,
  readApplicationNetworkRequirements,
} from "./applicationNetworkPolicy";

const managed = (domains: Record<string, string> = {}, enabled = true) => ({
  application: { network: { enabled, domains }, storage: null },
});
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

describe("managed application network policy", () => {
  it("denies before authority is ready and on disconnection; explicit absence allows normal network", async () => {
    const policy = new ApplicationNetworkPolicy();
    const reset = vi.fn(async () => {});
    expect(policy.allows("https://example.com/")).toBe(false);
    await policy.update(null, reset);
    expect(policy.allows("https://example.com/")).toBe(true);
    await policy.update(undefined, reset);
    expect(policy.allows("https://example.com/")).toBe(false);
    expect(reset).toHaveBeenCalledTimes(2);
  });

  it("uses exact normalized destinations for HTTP and WebSocket, regardless of user or Agent", async () => {
    const policy = new ApplicationNetworkPolicy();
    await policy.update(
      managed({
        "EXAMPLE.com.": "allow",
        "blocked.example": "deny",
        "127.0.0.1": "allow",
      }),
      async () => {},
    );
    for (const url of [
      "https://example.com/path",
      "http://example.com.:8080/",
      "wss://example.com/socket",
      "ws://127.0.0.1:7890/",
    ])
      expect(policy.allows(url), url).toBe(true);
    for (const url of [
      "https://sub.example.com/",
      "https://example.com.evil/",
      "https://blocked.example/",
      "wss://unlisted.example/",
      "https://[::1]/",
      "file:///tmp/example",
      "data:text/html,x",
      "invalid",
    ])
      expect(policy.allows(url), url).toBe(false);
  });

  it("disabled policies retain validated rules but allow all network destinations", async () => {
    const policy = new ApplicationNetworkPolicy();
    await policy.update(
      managed({ "blocked.example": "deny" }, false),
      async () => {},
    );
    expect(policy.allows("https://blocked.example/")).toBe(true);
    expect(policy.allows("wss://unlisted.example/")).toBe(true);
    expect(policy.allows("invalid")).toBe(false);
  });

  it.each([
    undefined,
    [],
    { application: [] },
    { application: { network: true } },
    { application: { network: { enabled: "false", domains: {} } } },
    { application: { network: { enabled: true } } },
    { application: { storage: {} } },
    { application: { networks: {} } },
    ...[
      "*.example.com",
      "https://example.com",
      "example.com:443",
      "example..com",
      "例子.com",
      "-x.com",
      "x-.com",
      "a".repeat(64) + ".com",
    ].map((key) => managed({ [key]: "allow" })),
    managed({ "EXAMPLE.com": "allow", "example.com.": "deny" }),
    managed({ "example.com": "prompt" }),
  ])(
    "rejects malformed policy instead of treating it as absence: %j",
    (input) => {
      expect(() => readApplicationNetworkRequirements(input)).toThrow(
        "Invalid managed application network requirements",
      );
    },
  );

  it("does not let an input object mutation widen policy", async () => {
    const input = managed({ "example.com": "allow" });
    const policy = new ApplicationNetworkPolicy();
    await policy.update(input, async () => {});
    input.application.network.domains["evil.example"] = "allow";
    input.application.network.enabled = false;
    expect(policy.allows("https://evil.example/")).toBe(false);
  });

  it("denies throughout a policy change and waits for connection revocation", async () => {
    const policy = new ApplicationNetworkPolicy();
    await policy.update(managed({ "old.example": "allow" }), async () => {});
    const closing = deferred();
    const pending = policy.update(
      managed({ "new.example": "allow" }),
      () => closing.promise,
    );
    expect(policy.allows("https://old.example/")).toBe(false);
    expect(policy.allows("https://new.example/")).toBe(false);
    closing.resolve();
    await pending;
    expect(policy.allows("https://new.example/")).toBe(true);
    expect(policy.allows("https://old.example/")).toBe(false);
  });

  it("an old reset cannot re-enable a policy after disconnect or a newer update", async () => {
    const policy = new ApplicationNetworkPolicy();
    const closing = deferred();
    const old = policy.update(
      managed({ "old.example": "allow" }),
      () => closing.promise,
    );
    const current = policy.update(undefined, async () => {});
    closing.resolve();
    await Promise.all([old, current]);
    expect(policy.allows("https://old.example/")).toBe(false);
  });

  it("failed connection revocation and malformed updates remain closed until an explicit repair", async () => {
    const policy = new ApplicationNetworkPolicy();
    await policy.update(null, async () => {});
    await expect(
      policy.update(managed({ "example.com": "allow" }), async () => {
        throw new Error("native reset failed");
      }),
    ).rejects.toThrow("native reset failed");
    expect(policy.allows("https://example.com/")).toBe(false);
    await expect(
      policy.update(managed({ "*": "allow" }), async () => {}),
    ).rejects.toThrow("Invalid managed");
    expect(policy.allows("https://example.com/")).toBe(false);
    await policy.update(managed({ "example.com": "allow" }), async () => {});
    expect(policy.allows("https://example.com/")).toBe(true);
  });

  it("unchanged policies do not interrupt active connections", async () => {
    const policy = new ApplicationNetworkPolicy();
    const reset = vi.fn(async () => {});
    await policy.update(
      managed({ "b.example": "deny", "a.example": "allow" }),
      reset,
    );
    await policy.update(
      managed({ "a.example": "allow", "b.example": "deny" }),
      reset,
    );
    expect(reset).toHaveBeenCalledOnce();
  });
});
