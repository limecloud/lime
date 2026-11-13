import assert from "node:assert/strict";
import { test } from "vitest";
import { AppServerClient, AppServerConnection } from "../dist/index.js";

const release = {
  id: "release-1",
  manifestSha256: "a".repeat(64),
  archiveSha256: "b".repeat(64),
};
const resource = { itemId: "skill-1", kind: "skill" };
const cases = [
  [
    "listPendingMarketInstalls",
    "market/install/pending",
    { kind: "skill" },
    {
      attempts: [
        {
          installAttemptId: "original-attempt-1234",
          resource: { ...resource, release },
        },
      ],
      errors: [],
    },
  ],
  [
    "cancelMarketInstall",
    "market/install/cancel",
    { ...resource, installAttemptId: "original-attempt-1234" },
    {},
  ],
  [
    "reconcileMarketResources",
    "market/reconcile",
    { kind: "skill" },
    {
      resources: [{ ...resource, release, acquisitionStatus: "unavailable" }],
      errors: [],
    },
  ],
  [
    "listMarketResources",
    "market/list",
    { kind: "skill", cursor: "page-2", limit: 10 },
    { resources: [], nextCursor: "page-3" },
  ],
  [
    "readMarketResource",
    "market/read",
    { ...resource, release },
    { resource: { ...resource, release } },
  ],
  [
    "installMarketResource",
    "market/install",
    { ...resource, release, installAttemptId: "attempt-1234567890" },
    { resource: { ...resource, release } },
  ],
  [
    "listInstalledMarketResources",
    "market/installed",
    { kind: "mcp" },
    {
      resources: [],
      errors: [
        { itemId: "broken", kind: "mcp", error: "invalid_market_installation" },
      ],
    },
  ],
  [
    "setMarketResourceEnabled",
    "market/enabled/set",
    { ...resource, enabled: false },
    { resource: { ...resource, installation: { enabled: false, release } } },
  ],
  ["uninstallMarketResource", "market/uninstall", resource, {}],
];

for (const [name, method, params, result] of cases) {
  test(`${method} preserves exact selection and returns the server result`, async () => {
    const client = new AppServerClient({ initialRequestId: 23 });
    assert.deepEqual(client[name](params), { id: 23, method, params });
    const sent = [];
    const connection = new AppServerConnection(
      {
        send(message) {
          sent.push(message);
        },
        async nextMessage() {
          return { id: 24, result };
        },
      },
      client,
    );
    const response = await connection[name](params);
    assert.deepEqual(sent, [{ id: 24, method, params }]);
    assert.deepEqual(response.result, result);
  });
}

test("market install failures remain failures without a second request", async () => {
  const sent = [];
  const connection = new AppServerConnection(
    {
      send(message) {
        sent.push(message);
      },
      async nextMessage() {
        return {
          id: 1,
          error: { code: -32000, message: "market_install_outcome_unknown" },
        };
      },
    },
    new AppServerClient(),
  );
  await assert.rejects(
    connection.installMarketResource({
      ...resource,
      release,
      installAttemptId: "attempt-1234567890",
    }),
    /market_install_outcome_unknown/,
  );
  assert.equal(sent.length, 1);
});
