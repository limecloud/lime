// @vitest-environment node
import { expect, it } from "vitest";
import { assertRendererCloudDesktopAccess } from "./cloudDesktopPrivateActions";

it.each([
  "sealModelConnection",
  "prepareRuntimeDistribution",
  "readRuntimeDistribution",
  "signRuntimeDistribution",
  "cleanupRuntimeDistribution",
])(
  "rejects private %s in requests, notifications, batches and later lines",
  (action) => {
    const request = { id: 1, method: "cloud/desktop", params: { action } };
    const notification = { method: request.method, params: request.params };
    const ordinary = { id: 2, method: "thread/list", params: {} };
    for (const lines of [
      [JSON.stringify(request)],
      [JSON.stringify(notification)],
      [JSON.stringify([ordinary, request])],
      [JSON.stringify(ordinary), JSON.stringify(notification)],
      [JSON.stringify([[request]])],
    ])
      expect(() => assertRendererCloudDesktopAccess(lines)).toThrow(
        /^CLOUD_RUNTIME_MAIN_ONLY$/u,
      );
  },
);

it("leaves public management, server responses and unrelated parameters to the protocol decoder", () => {
  expect(() =>
    assertRendererCloudDesktopAccess([
      JSON.stringify({
        id: 1,
        method: "cloud/desktop",
        params: { action: "inspect" },
      }),
      JSON.stringify({ id: 2, result: { action: "signRuntimeDistribution" } }),
      JSON.stringify({
        id: 3,
        method: "thread/start",
        params: { action: "signRuntimeDistribution" },
      }),
    ]),
  ).not.toThrow();
});
