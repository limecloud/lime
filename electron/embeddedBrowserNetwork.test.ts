import { expect, it, vi } from "vitest";
import {
  resetMocks,
  sessionFromPartitionMock,
} from "./embeddedBrowserHost.testFixtures";
import { ElectronEmbeddedBrowserHost } from "./embeddedBrowserHost";

it("revokes capabilities synchronously only for a real network policy transition, including failed resets", async () => {
  resetMocks();
  const host = new ElectronEmbeddedBrowserHost();
  const revoke = vi.fn();
  host.setNetworkRequirementsChangedHandler(revoke);
  host.getBrowsingDataSession();
  const native = sessionFromPartitionMock.mock.results[0].value;
  const policy = {
    application: {
      network: { enabled: true, domains: { "example.com": "allow" } },
    },
  };
  const initial = host.setApplicationNetworkRequirements(policy);
  expect(revoke).toHaveBeenCalledOnce();
  await initial;
  await host.setApplicationNetworkRequirements(structuredClone(policy));
  expect(revoke).toHaveBeenCalledOnce();
  native.closeAllConnections.mockRejectedValueOnce(new Error("native failure"));
  const changing = host.setApplicationNetworkRequirements(null);
  expect(revoke).toHaveBeenCalledTimes(2);
  await expect(changing).rejects.toThrow("Browser network revocation failed");
  host.dispose();
});

it("installs the managed request owner when the persistent Session is first obtained, before any view", async () => {
  resetMocks();
  const host = new ElectronEmbeddedBrowserHost();
  const session = host.getBrowsingDataSession();
  const native = sessionFromPartitionMock.mock.results[0].value;
  expect(host.getBrowsingDataSession()).toBe(session);
  expect(native.webRequest.onBeforeRequest).toHaveBeenCalledOnce();
  const listener = native.webRequest.onBeforeRequest.mock.calls[0][1];
  const callback = vi.fn();
  listener({ resourceType: "xhr", url: "https://example.com/" }, callback);
  await vi.waitFor(() =>
    expect(callback).toHaveBeenCalledExactlyOnceWith({ cancel: true }),
  );
  const provider = vi.fn(async () => {
    await host.setApplicationNetworkRequirements(null);
  });
  host.setNetworkRequirementsProvider(provider);
  const allowed = vi.fn();
  listener({ resourceType: "xhr", url: "https://example.com/" }, allowed);
  await vi.waitFor(() =>
    expect(allowed).toHaveBeenCalledExactlyOnceWith({ cancel: false }),
  );
  expect(native.closeAllConnections).toHaveBeenCalledOnce();
  host.dispose();
  const worker = vi.fn();
  listener({ resourceType: "xhr", url: "https://example.com/worker" }, worker);
  expect(worker).toHaveBeenCalledExactlyOnceWith({ cancel: true });
});
