import { expect, it } from "vitest";
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
