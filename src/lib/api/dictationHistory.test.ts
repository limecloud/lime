import { beforeEach, expect, it, vi } from "vitest";
import { AppServerClient as RequestClient } from "@limecloud/app-server-client/browser";
import {
  appendDictationHistoryAudio,
  deleteDictationHistory,
  finishDictationHistory,
  listDictationHistory,
  readDictationHistoryAudio,
  setDictationHistoryTranscript,
  startDictationHistory,
} from "./dictationHistory";

const exchange = vi.hoisted(() => vi.fn());
vi.mock("./appServerTransport", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./appServerTransport")>()),
  handleAppServerJsonLines: exchange,
}));
const entry = {
  id: "recording-1",
  createdAtMs: 1700000000000,
  text: null,
  sizeBytes: 3,
  status: "saved",
  mimeType: "audio/webm",
};
beforeEach(() => {
  exchange.mockReset();
  exchange.mockImplementation(async ({ lines }: { lines: string[] }) => {
    const request = JSON.parse(lines[0]);
    const result =
      request.method === "dictationHistory/list"
        ? { recordings: [entry] }
        : request.method === "dictationHistory/readAudio"
          ? { audioBase64: btoa("abc"), mimeType: entry.mimeType }
          : request.method === "dictationHistory/delete"
            ? {}
            : { recording: entry };
    return { lines: [JSON.stringify({ id: request.id, result })] };
  });
});

it("uses seven current typed JSON-RPC methods and reconstructs original audio", async () => {
  expect(await listDictationHistory()).toEqual([entry]);
  expect(await startDictationHistory("audio/webm")).toEqual(entry);
  await appendDictationHistoryAudio(entry.id, 0, btoa("abc"));
  await finishDictationHistory(entry.id, "saved");
  const audio = await readDictationHistoryAudio(entry.id);
  expect(audio.type).toBe("audio/webm");
  expect(audio.size).toBe(3);
  await setDictationHistoryTranscript(entry.id, "transcript");
  await deleteDictationHistory(entry.id);
  const requests = exchange.mock.calls.map(([request]) =>
    JSON.parse(request.lines[0]),
  );
  expect(requests.map((request) => [request.method, request.params])).toEqual([
    ["dictationHistory/list", {}],
    ["dictationHistory/start", { mimeType: "audio/webm" }],
    [
      "dictationHistory/appendAudio",
      { id: entry.id, offset: 0, audioBase64: btoa("abc") },
    ],
    ["dictationHistory/finish", { id: entry.id, status: "saved" }],
    ["dictationHistory/readAudio", { id: entry.id }],
    ["dictationHistory/setTranscript", { id: entry.id, text: "transcript" }],
    ["dictationHistory/delete", { id: entry.id }],
  ]);
});

it("package request builders share the same methods and never substitute data on transport failure", async () => {
  const client = new RequestClient();
  expect(client.startDictationHistory({ mimeType: "audio/mp4" })).toMatchObject(
    { method: "dictationHistory/start", params: { mimeType: "audio/mp4" } },
  );
  expect(client.listDictationHistory().method).toBe("dictationHistory/list");
  expect(
    client.appendDictationHistoryAudio({
      id: entry.id,
      offset: 3,
      audioBase64: "",
    }).method,
  ).toBe("dictationHistory/appendAudio");
  exchange.mockRejectedValueOnce(new Error("bridge unavailable"));
  await expect(listDictationHistory()).rejects.toThrow("bridge unavailable");
});
