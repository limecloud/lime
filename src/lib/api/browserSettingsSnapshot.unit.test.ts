import { beforeEach, expect, it, vi } from "vitest";
import { invalidateAppConfigCache } from "./appConfig";
import { getBrowserSettingsSnapshot } from "./browserSettings";

const { request } = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("./appServer", () => ({
  AppServerClient: class {
    request = request;
  },
}));
beforeEach(() => {
  invalidateAppConfigCache();
  window.localStorage.clear();
  request.mockReset();
});

it("reads effective permissions, the actual user layer and managed origins from the same config response", async () => {
  const source = {
    name: { type: "mdm", domain: "fixture", key: "config" },
    version: "managed-v1",
  };
  const user = { browser: { allowedOrigins: ["user.example.com"] } };
  const response = {
    config: {
      ...user,
      default_provider: "openai",
      browser_use: { origins: { "managed.example.com": { access: "deny" } } },
    },
    origins: { "browser_use.origins.managed.example.com.access": source },
    layers: [
      {
        name: { type: "user", file: "/fixture/config.yaml" },
        version: "user-v1",
        config: user,
      },
      {
        ...source,
        config: {
          browser_use: {
            origins: { "managed.example.com": { access: "deny" } },
          },
        },
      },
    ],
  };
  request.mockResolvedValue({ result: response });
  const snapshot = await getBrowserSettingsSnapshot();
  expect(request).toHaveBeenCalledExactlyOnceWith("config/read", {
    includeLayers: true,
  });
  expect(
    snapshot.settings.agent_permissions.sites.map((site) => site.pattern),
  ).toEqual(["managed.example.com", "user.example.com"]);
  expect(
    snapshot.permissionContext.userPermissions.sites.map(
      (site) => site.pattern,
    ),
  ).toEqual(["user.example.com"]);
  expect(snapshot.permissionContext.origins).toEqual(response.origins);
  snapshot.permissionContext.origins[
    "browser_use.origins.managed.example.com.access"
  ].version = "changed";
  expect(
    response.origins["browser_use.origins.managed.example.com.access"].version,
  ).toBe("managed-v1");
});

it("rejects malformed user-layer data instead of synthesizing user permissions", async () => {
  request.mockResolvedValue({
    result: {
      config: { default_provider: "openai" },
      origins: {},
      layers: [
        {
          name: { type: "user", file: "/fixture/config.yaml" },
          version: "v1",
          config: [],
        },
      ],
    },
  });
  await expect(getBrowserSettingsSnapshot()).rejects.toThrow(
    "invalid browser user layer",
  );
});
