import { expect, it, vi } from "vitest";
import { invokeArgsPreview } from "./invokeDiagnostics";

it("keeps account import credentials out of JSONL diagnostic persistence", () => {
  const secret = 'short-"credential';
  const request = {
    jsonrpc: "2.0",
    id: 7,
    method: "account/login/start",
    params: {
      type: "cloudAuthTokens",
      accessToken: secret,
      unknownSecret: secret,
    },
  };
  const preview = invokeArgsPreview("app_server_handle_json_lines", {
    request: { lines: [JSON.stringify(request)] },
  });
  expect(preview).toEqual({
    request: {
      lines: [
        JSON.stringify({
          jsonrpc: "2.0",
          id: 7,
          method: "account/login/start",
          params: { type: "cloudAuthTokens" },
        }),
      ],
    },
  });
  expect(JSON.stringify(preview)).not.toContain("credential");
  expect(
    invokeArgsPreview("app_server_handle_json_lines", {
      request: { lines: ['{"accessToken":"broken-secret"'] },
    }),
  ).toEqual({ request: { lines: ["[invalid JSON-RPC]"] } });
});
it.each([
  "dictationHistory/appendAudio",
  "dictationHistory/setTranscript",
  "voiceTranscription/transcribeAudio",
  "voiceTranscription/polishText",
])(
  "%s diagnostics keep identity without retaining audio or transcript",
  (method) => {
    const preview = invokeArgsPreview("app_server_handle_json_lines", {
      request: {
        lines: [
          JSON.stringify({
            id: 41,
            method,
            params: {
              id: "recording",
              audioBase64: "private-audio",
              audio_base64: "private-audio",
              text: "private-transcript",
            },
          }),
        ],
      },
    });
    expect(JSON.stringify(preview)).not.toContain("private-audio");
    expect(JSON.stringify(preview)).not.toContain("private-transcript");
    expect(
      JSON.parse((preview?.request as { lines: string[] }).lines[0]),
    ).toEqual({ id: 41, method });
  },
);

it.each([
  ["composer-drafts-v1", "put"],
  ["composer-drafts-v1", "promote"],
  ["composer-drafts-v1", "consume"],
  ["composer-drafts-v1", "clear"],
  ["app-shell-summary-panel-pinned", "set"],
  ["app-shell-file-tree-open", "set"],
  ["local-env-selections-by-workspace", "set"],
  ["local-env-selections-by-workspace", "delete"],
  ["local-env-recent-actions-by-key", "record"],
])("records only the fixed %s/%s diagnostic identity", (key, op) => {
  const args = {
    key,
    query: { kind: "recent-actions", environmentKey: "/private/workspace" },
    mutation: {
      op,
      environmentKey: "/private/workspace",
      actionName: "private-action",
      configPath: "/private/environment.toml",
      text: "private-content",
    },
  };
  expect(invokeArgsPreview("persisted_atom_read", args)).toEqual({ key });
  expect(invokeArgsPreview("persisted_atom_update", args)).toEqual({ key, op });
});

it.each([
  ["private-atom", "put", "unknown"],
  ["local-env-recent-actions-by-key", "put", "local-env-recent-actions-by-key"],
  [
    "local-env-selections-by-workspace",
    "record",
    "local-env-selections-by-workspace",
  ],
  ["composer-drafts-v1", "private-op", "composer-drafts-v1"],
])(
  "does not log unknown or unrelated operations for %s/%s",
  (key, op, expectedKey) => {
    expect(
      invokeArgsPreview("persisted_atom_update", { key, mutation: { op } }),
    ).toEqual({
      key: expectedKey,
      op: "unknown",
    });
  },
);

it("does not evaluate persisted atom diagnostic accessors", () => {
  const getter = vi.fn(() => "private-value");
  const args = Object.defineProperty({}, "key", { get: getter });
  Object.defineProperty(args, "mutation", { get: getter });
  expect(invokeArgsPreview("persisted_atom_update", args)).toEqual({
    key: "unknown",
    op: "unknown",
  });
  expect(getter).not.toHaveBeenCalled();
});
