import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  METHOD_CONNECT_CALLBACK_SEND,
  METHOD_CONNECT_DEEP_LINK_RESOLVE,
  METHOD_CONNECT_OPEN_DEEP_LINK_RESOLVE,
  METHOD_CONNECT_RELAY_API_KEY_SAVE,
} from "../../../packages/app-server-client/src/protocol";
import {
  resolveConnectDeepLink,
  resolveOpenDeepLink,
  saveConnectRelayApiKey,
  sendConnectCallback,
} from "./connect";

const appServerRequestMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: vi.fn(function () {
    return { request: appServerRequestMock };
  }),
}));

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("connect API", () => {
  beforeEach(() => {
    appServerRequestMock.mockReset();
    vi.mocked(safeInvoke).mockReset();
  });

  it("resolveConnectDeepLink 应通过 App Server current method 解析并投影旧 Hook 字段", async () => {
    appServerRequestMock.mockResolvedValueOnce({
      result: {
        payload: {
          relay: "relay-one",
          key: "sk-relay-key",
          name: "Relay Key",
          refCode: "ref-001",
        },
        relayInfo: {
          id: "relay-one",
          name: "Relay One",
        },
        isVerified: true,
      },
    });

    await expect(
      resolveConnectDeepLink("lime://connect?relay=relay-one&key=sk-relay-key"),
    ).resolves.toEqual({
      payload: {
        relay: "relay-one",
        key: "sk-relay-key",
        name: "Relay Key",
        ref_code: "ref-001",
      },
      relay_info: {
        id: "relay-one",
        name: "Relay One",
        description: "",
        branding: {
          logo: "",
          color: "",
        },
        links: {
          homepage: "",
        },
        api: {
          base_url: "",
          protocol: "",
          auth_header: "",
          auth_prefix: "",
        },
        contact: {},
        features: {
          models: [],
          streaming: false,
          function_calling: false,
          vision: false,
        },
      },
      is_verified: true,
    });

    expect(appServerRequestMock).toHaveBeenCalledWith(
      METHOD_CONNECT_DEEP_LINK_RESOLVE,
      {
        url: "lime://connect?relay=relay-one&key=sk-relay-key",
      },
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("resolveOpenDeepLink 应通过 App Server current method 解析官网 open deep link", async () => {
    appServerRequestMock.mockResolvedValueOnce({
      result: {
        payload: {
          kind: "skill",
          slug: "viral-content-breakdown",
          source: "website",
          version: "1",
          action: "install",
        },
      },
    });

    await expect(
      resolveOpenDeepLink(
        "lime://open?kind=skill&slug=viral-content-breakdown&action=install",
      ),
    ).resolves.toEqual({
      payload: {
        kind: "skill",
        slug: "viral-content-breakdown",
        source: "website",
        version: "1",
        action: "install",
      },
    });

    expect(appServerRequestMock).toHaveBeenCalledWith(
      METHOD_CONNECT_OPEN_DEEP_LINK_RESOLVE,
      {
        url: "lime://open?kind=skill&slug=viral-content-breakdown&action=install",
      },
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("saveConnectRelayApiKey 应通过 App Server 保存 Relay API Key", async () => {
    appServerRequestMock.mockResolvedValueOnce({
      result: {
        providerId: "provider-1",
        keyId: "key-1",
        providerName: "Relay Key",
        isNewProvider: true,
      },
    });

    await expect(
      saveConnectRelayApiKey({
        relayId: "relay-one",
        apiKey: "sk-relay-key",
        name: "Relay Key",
      }),
    ).resolves.toEqual({
      provider_id: "provider-1",
      key_id: "key-1",
      provider_name: "Relay Key",
      is_new_provider: true,
    });

    expect(appServerRequestMock).toHaveBeenCalledWith(
      METHOD_CONNECT_RELAY_API_KEY_SAVE,
      {
        relayId: "relay-one",
        apiKey: "sk-relay-key",
        name: "Relay Key",
      },
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("sendConnectCallback 应通过 App Server 发送回调并返回 delivered 状态", async () => {
    appServerRequestMock.mockResolvedValueOnce({
      result: {
        delivered: true,
      },
    });

    await expect(
      sendConnectCallback({
        relayId: "relay-one",
        apiKey: "sk-relay-key",
        status: "success",
        refCode: "ref-001",
      }),
    ).resolves.toBe(true);

    expect(appServerRequestMock).toHaveBeenCalledWith(
      METHOD_CONNECT_CALLBACK_SEND,
      {
        relayId: "relay-one",
        apiKey: "sk-relay-key",
        status: "success",
        refCode: "ref-001",
      },
    );
    expect(safeInvoke).not.toHaveBeenCalled();
  });

  it("Connect App Server current result 缺少关键字段时应 fail closed", async () => {
    appServerRequestMock
      .mockResolvedValueOnce({
        result: {
          payload: {
            relay: "relay-one",
          },
          isVerified: true,
        },
      })
      .mockResolvedValueOnce({
        result: {
          payload: {
            kind: "skill",
          },
        },
      })
      .mockResolvedValueOnce({
        result: {
          providerId: "provider-1",
          keyId: "key-1",
          providerName: "Relay Key",
        },
      })
      .mockResolvedValueOnce({
        result: {
          delivered: "yes",
        },
      });

    await expect(
      resolveConnectDeepLink("lime://connect?relay=relay-one"),
    ).rejects.toThrow("connectDeepLink/resolve did not return payload");
    await expect(resolveOpenDeepLink("lime://open?kind=skill")).rejects.toThrow(
      "connectOpenDeepLink/resolve did not return payload",
    );
    await expect(
      saveConnectRelayApiKey({
        relayId: "relay-one",
        apiKey: "sk-relay-key",
      }),
    ).rejects.toThrow("connectRelayApiKey/save did not return saved API key");
    await expect(
      sendConnectCallback({
        relayId: "relay-one",
        apiKey: "sk-relay-key",
        status: "success",
      }),
    ).rejects.toThrow(
      "connectCallback/send did not return delivered status",
    );

    expect(safeInvoke).not.toHaveBeenCalled();
  });
});
