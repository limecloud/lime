import { describe, expect, it } from "vitest";
import { resolveAppServerRequestTimeoutMs } from "../../../electron/appServerRequestTimeout";
import { resolveBridgeRequestTimeoutMs } from "./http-client";

const args = (action: string, extra: unknown[] = []) => ({
  request: {
    lines: [
      JSON.stringify({ id: 1, method: "cloud/desktop", params: { action } }),
      ...extra,
    ],
  },
});
describe("Cloud archive request budgets", () => {
  it("keeps IPC and Host alive for first-use tool preparation and bounded transfers", () => {
    for (const [action, serverBudget] of [
      ["prepareEcsPurchase", 240_000 + 45_000],
      ["readEcsPurchasePreparation", 7 * 45_000],
      ["listOssBuckets", 45_000 + 180_000 + 90_000],
      ["transferOssArchive", 45_000 + 180_000 + 3_600_000],
      ["transferArchive", 3_600_000],
      ["createEcsImage", 2 * 45_000],
      ["listEcsImages", 2 * 45_000],
      ["readOperation", 3 * 45_000],
    ] as const) {
      const host = resolveAppServerRequestTimeoutMs(
        "cloud/desktop",
        undefined,
        { action },
      );
      const bridge = resolveBridgeRequestTimeoutMs(
        "app_server_handle_json_lines",
        args(action),
      );
      expect(host, action).toBeGreaterThan(serverBudget);
      expect(bridge, action).toBe(host);
      expect(
        resolveAppServerRequestTimeoutMs("cloud/desktop", 60_000, { action }),
      ).toBe(host);
    }
  });
  it("does not extend unrelated management, malformed messages or notifications", () => {
    const baseline = resolveBridgeRequestTimeoutMs(
      "app_server_handle_json_lines",
      args("readAlibabaConnection"),
    );
    for (const lines of [
      ["invalid"],
      [
        JSON.stringify({
          method: "cloud/desktop",
          params: { action: "transferOssArchive" },
        }),
      ],
      [
        JSON.stringify({
          id: 1,
          method: "other",
          params: { action: "transferOssArchive" },
        }),
      ],
    ])
      expect(
        resolveBridgeRequestTimeoutMs("app_server_handle_json_lines", {
          request: { lines },
        }),
      ).toBe(baseline);
    expect(
      resolveAppServerRequestTimeoutMs("cloud/desktop", undefined, {
        action: "readAlibabaConnection",
      }),
    ).toBe(30_000);
  });
  it("retains explicitly unbounded command execution in a mixed batch", () => {
    const command = JSON.stringify({
      id: 2,
      method: "command/exec",
      params: { disableTimeout: true },
    });
    expect(
      resolveBridgeRequestTimeoutMs(
        "app_server_handle_json_lines",
        args("transferOssArchive", [command]),
      ),
    ).toBe(0);
  });
});
