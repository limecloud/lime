import { Blob as NodeBlob } from "node:buffer";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DictationHistoryWriter } from "./dictationHistoryWriter";

const api = vi.hoisted(() => ({
  start: vi.fn(),
  append: vi.fn(),
  finish: vi.fn(),
  transcript: vi.fn(),
}));
vi.mock("./api/dictationHistory", () => ({
  startDictationHistory: api.start,
  appendDictationHistoryAudio: api.append,
  finishDictationHistory: api.finish,
  setDictationHistoryTranscript: api.transcript,
}));
function blob(text: string): Blob {
  return new NodeBlob([text]) as unknown as Blob;
}

beforeEach(() => {
  vi.resetAllMocks();
  api.start.mockResolvedValue({ id: "recording-1" });
  api.append.mockResolvedValue({});
  api.finish.mockResolvedValue({});
  api.transcript.mockResolvedValue({});
});

describe("recording history writer", () => {
  it("serializes pending start, audio offsets, terminal state and transcript", async () => {
    let release!: (value: { id: string }) => void;
    api.start.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    const writer = new DictationHistoryWriter("audio/webm", vi.fn());
    writer.append(blob("abc"));
    writer.append(blob("de"));
    const completion = writer.finish("cancelled");
    writer.append(blob("late"));
    expect(api.append).not.toHaveBeenCalled();
    release({ id: "old-recording" });
    expect(await completion).toBe("old-recording");
    expect(api.append.mock.calls).toEqual([
      ["old-recording", 0, btoa("abc")],
      ["old-recording", 3, btoa("de")],
    ]);
    expect(api.finish).toHaveBeenCalledExactlyOnceWith(
      "old-recording",
      "cancelled",
    );
    await writer.finish("saved");
    expect(api.finish).toHaveBeenCalledTimes(1);
    await writer.setTranscript("final");
    expect(api.transcript).toHaveBeenCalledWith("old-recording", "final");
    expect(api.transcript.mock.invocationCallOrder[0]).toBeGreaterThan(
      api.finish.mock.invocationCallOrder[0],
    );
  });

  it("splits large audio chunks within the public limit without reordering", async () => {
    const writer = new DictationHistoryWriter("audio/webm", vi.fn());
    writer.append(
      new NodeBlob([new Uint8Array(1024 * 1024 + 3)]) as unknown as Blob,
    );
    await writer.finish("saved");
    expect(
      api.append.mock.calls.map((call) => [call[1], atob(call[2]).length]),
    ).toEqual([
      [0, 512 * 1024],
      [512 * 1024, 512 * 1024],
      [1024 * 1024, 3],
    ]);
  });

  it("reports failed persistence once, keeps existing audio recoverable and settles", async () => {
    const error = vi.fn();
    api.append.mockRejectedValue(new Error("disk full"));
    const writer = new DictationHistoryWriter("audio/webm", error);
    writer.append(blob("abc"));
    writer.append(blob("def"));
    expect(await writer.finish("saved")).toBe("recording-1");
    expect(api.append).toHaveBeenCalledTimes(1);
    expect(api.finish).toHaveBeenCalledWith("recording-1", "interrupted");
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("does not create substitute history after start or transcript failure", async () => {
    const error = vi.fn();
    api.start.mockRejectedValueOnce(new Error("unavailable"));
    const writer = new DictationHistoryWriter("audio/webm", error);
    writer.append(blob("audio"));
    await writer.setTranscript("text");
    expect(await writer.finish("saved")).toBeNull();
    expect(api.finish).not.toHaveBeenCalled();
    expect(api.transcript).not.toHaveBeenCalled();
    const next = new DictationHistoryWriter("audio/webm", error);
    api.transcript.mockRejectedValueOnce(new Error("deleted"));
    await next.setTranscript("late text");
    expect(api.start).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(2);
  });
});
