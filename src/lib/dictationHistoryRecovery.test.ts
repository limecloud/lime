import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  recoverDictationHistory,
  selectDictationHistory,
  selectedDictationHistoryId,
} from "./dictationHistoryRecovery";
const api = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  transcribe: vi.fn(),
  polish: vi.fn(),
  close: vi.fn(),
}));
vi.mock("./api/dictationHistory", () => ({
  readDictationHistoryAudio: api.read,
  setDictationHistoryTranscript: api.save,
}));
vi.mock("./api/asrProvider", () => ({
  transcribeVoiceInputAudio: api.transcribe,
  polishVoiceInputText: api.polish,
}));
beforeEach(() => {
  vi.resetAllMocks();
  api.read.mockResolvedValue({ arrayBuffer: async () => new ArrayBuffer(4) });
  api.save.mockResolvedValue({});
  api.close.mockResolvedValue(undefined);
  api.transcribe.mockResolvedValue({ text: " raw words " });
  api.polish.mockResolvedValue({ text: "Final words" });
  vi.stubGlobal(
    "AudioContext",
    class {
      decodeAudioData = vi.fn().mockResolvedValue({
        numberOfChannels: 1,
        length: 2,
        sampleRate: 16000,
        getChannelData: () => new Float32Array([0.5, -0.5]),
      });
      close = api.close;
    },
  );
});
afterEach(() => {
  vi.unstubAllGlobals();
  selectDictationHistory(null);
});
describe("dictation recovery", () => {
  it("decodes original audio, reuses WAV transcription and saves to the same identity", async () => {
    await recoverDictationHistory("old-recording");
    expect(api.read).toHaveBeenCalledWith("old-recording");
    expect(api.transcribe.mock.calls[0][0].mimeType).toBe("audio/wav");
    expect(atob(api.transcribe.mock.calls[0][0].audioBase64).slice(0, 4)).toBe(
      "RIFF",
    );
    expect(api.close).toHaveBeenCalledOnce();
    expect(api.close.mock.invocationCallOrder[0]).toBeLessThan(
      api.transcribe.mock.invocationCallOrder[0],
    );
    expect(api.polish).toHaveBeenCalledWith({ text: "raw words" });
    expect(api.save).toHaveBeenCalledWith("old-recording", "Final words");
  });
  it("retains raw text if cleanup fails and does not manufacture text when ASR fails", async () => {
    api.polish.mockRejectedValueOnce(new Error("unavailable"));
    await recoverDictationHistory("raw");
    expect(api.save).toHaveBeenLastCalledWith("raw", "raw words");
    api.transcribe.mockRejectedValueOnce(new Error("ASR unavailable"));
    await expect(recoverDictationHistory("failed")).rejects.toThrow();
    expect(api.save).toHaveBeenCalledTimes(1);
    api.transcribe.mockResolvedValueOnce({ text: "  " });
    await expect(recoverDictationHistory("empty")).rejects.toThrow();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.close).toHaveBeenCalledTimes(3);
  });
  it("preserves other query fields and supports selected recording reload and show all", () => {
    window.history.replaceState(
      { native: true },
      "",
      "?nativeStartup=1&keep=value",
    );
    selectDictationHistory("failed-recording");
    expect(selectedDictationHistoryId()).toBe("failed-recording");
    expect(window.history.state).toEqual({ native: true });
    selectDictationHistory(null);
    expect(selectedDictationHistoryId()).toBeNull();
    expect(window.location.search).toBe("?nativeStartup=1&keep=value");
  });
});
