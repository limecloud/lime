// @vitest-environment node
import { expect, it, vi } from "vitest";
import type {
  CloudDesktopParams,
  CloudDesktopResource,
} from "@limecloud/app-server-client";
import { openCloudGuestUploadTunnel } from "./cloudGuestUploadTunnel";

const resource: CloudDesktopResource = {
  provider: "ecs",
  profile: "test",
  regionId: "cn-test",
  resourceId: "i-test",
};
const listening = {
  state: "listening",
  channel: "installation",
  persistent: false,
  endpoint: "https://127.0.0.1:34567",
};
it("opens only the fixed installation channel and returns an ephemeral endpoint with explicit cleanup", async () => {
  const request = vi.fn(async (_params: CloudDesktopParams) => ({
    data: listening,
  }));
  const tunnel = await openCloudGuestUploadTunnel(
    request,
    resource,
    new AbortController().signal,
  );
  expect(tunnel.endpoint).toBe("https://127.0.0.1:34567/");
  expect(request).toHaveBeenCalledExactlyOnceWith({
    action: "openEcsTunnel",
    resource,
    channel: "installation",
  });
  await tunnel.close();
  expect(request).toHaveBeenLastCalledWith({
    action: "closeEcsTunnel",
    resource,
    channel: "installation",
  });
});

it.each([
  "http://127.0.0.1:34567/",
  "https://8.8.8.8:34567/",
  "https://localhost:34567/",
  "https://127.0.0.1/",
  "https://127.0.0.1:0/",
  "https://127.0.0.1:34567/other",
  "https://user:secret@127.0.0.1:34567/",
  "https://127.0.0.1:34567/?secret=1",
  "https://127.0.0.1:34567/#secret",
])(
  "closes and rejects an untrusted installation endpoint %s",
  async (endpoint) => {
    const request = vi.fn(async (_params: CloudDesktopParams) => ({
      data: { ...listening, endpoint },
    }));
    await expect(
      openCloudGuestUploadTunnel(
        request,
        resource,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^CLOUD_INSTALL_TUNNEL_FAILED$/u);
    expect(request).toHaveBeenLastCalledWith({
      action: "closeEcsTunnel",
      resource,
      channel: "installation",
    });
  },
);

it.each([{ channel: "appServer" }, { state: "closed" }, { persistent: true }])(
  "refuses mismatched tunnel metadata %j",
  async (change) => {
    const request = vi.fn(async (_params: CloudDesktopParams) => ({
      data: { ...listening, ...change },
    }));
    await expect(
      openCloudGuestUploadTunnel(
        request,
        resource,
        new AbortController().signal,
      ),
    ).rejects.toThrow(/^CLOUD_INSTALL_TUNNEL_FAILED$/u);
    expect(request).toHaveBeenCalledTimes(2);
  },
);

it("does not start a session for an aborted or unsupported request", async () => {
  const request = vi.fn(async (_params: CloudDesktopParams) => ({
    data: listening,
  }));
  const controller = new AbortController();
  controller.abort();
  await expect(
    openCloudGuestUploadTunnel(request, resource, controller.signal),
  ).rejects.toThrow("TUNNEL_FAILED");
  await expect(
    openCloudGuestUploadTunnel(
      request,
      { ...resource, provider: "wuying" },
      new AbortController().signal,
    ),
  ).rejects.toThrow("TUNNEL_FAILED");
  expect(request).not.toHaveBeenCalled();
});

it("reports supplier security-group denial without exposing its response or retrying open", async () => {
  const request = vi.fn(async (_params: CloudDesktopParams) => ({
    data: listening,
  }));
  request.mockRejectedValueOnce(
    new Error(
      "ErrorCode=InvalidOperation.SecurityGroupRuleDenied secret-provider-url",
    ),
  );
  await expect(
    openCloudGuestUploadTunnel(request, resource, new AbortController().signal),
  ).rejects.toThrow(/^CLOUD_INSTALL_SECURITY_GROUP_DENIED$/u);
  expect(request).toHaveBeenCalledTimes(2);
});

it("cancels a pending session and never exposes a late endpoint or provider secret", async () => {
  let resolve!: (value: { data: typeof listening }) => void;
  const pending = new Promise<{ data: typeof listening }>((done) => {
    resolve = done;
  });
  const request = vi.fn(async (params: CloudDesktopParams) =>
    params.action === "openEcsTunnel" ? pending : { data: listening },
  );
  const controller = new AbortController();
  const opening = openCloudGuestUploadTunnel(
    request,
    resource,
    controller.signal,
  );
  controller.abort();
  resolve({ data: listening });
  await expect(opening).rejects.toThrow(/^CLOUD_INSTALL_TUNNEL_FAILED$/u);
  expect(
    request.mock.calls.filter(([params]) => params.action === "closeEcsTunnel")
      .length,
  ).toBeGreaterThan(0);
  request.mockRejectedValueOnce(new Error("secret-provider-session-url"));
  await expect(
    openCloudGuestUploadTunnel(request, resource, new AbortController().signal),
  ).rejects.toThrow(/^CLOUD_INSTALL_TUNNEL_FAILED$/u);
});

it("does not expose an already resolved endpoint when opening synchronously aborts", async () => {
  const controller = new AbortController();
  const request = vi.fn(async (params: CloudDesktopParams) => {
    if (params.action === "openEcsTunnel") controller.abort();
    return { data: listening };
  });
  await expect(
    openCloudGuestUploadTunnel(request, resource, controller.signal),
  ).rejects.toThrow(/^CLOUD_INSTALL_TUNNEL_FAILED$/u);
  expect(
    request.mock.calls.some(([params]) => params.action === "closeEcsTunnel"),
  ).toBe(true);
});
