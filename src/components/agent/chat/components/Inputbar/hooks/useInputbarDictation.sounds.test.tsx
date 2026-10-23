import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import { playDictationSound } from "./inputbarDictationSounds";
import {
  api,
  deferred,
  stream,
  recorders,
  permission,
  mount,
  start,
  startReady,
  beginFinish,
  settle,
} from "./inputbarDictationLifecycle.testFixtures";

vi.mock("./inputbarDictationSounds", () => ({ playDictationSound: vi.fn() }));
let cancelled: Array<ReturnType<typeof vi.fn>>;
beforeEach(() => {
  cancelled = [];
  api.config.mockResolvedValue({ sound_enabled: true });
  vi.mocked(playDictationSound).mockImplementation((cue) => {
    expect(recorders.at(-1)?.state).toBe(
      cue === "start" ? "recording" : "inactive",
    );
    const cancel = vi.fn();
    cancelled.push(cancel);
    return cancel;
  });
});

describe("current dictation sound preference", () => {
  it("starts once after recording starts and stops once after microphone release", async () => {
    const harness = mount();
    await startReady(harness);
    expect(playDictationSound).toHaveBeenCalledTimes(1);
    expect(vi.mocked(playDictationSound).mock.calls[0][0]).toBe("start");
    await beginFinish(harness);
    await settle();
    expect(
      vi.mocked(playDictationSound).mock.calls.map(([cue]) => cue),
    ).toEqual(["start", "stop"]);
    expect(cancelled[0]).toHaveBeenCalledOnce();
    await vi.waitFor(async () => {
      await settle();
      expect(harness.read().dictationState).toBe("idle");
    });
    expect(api.transcribe).toHaveBeenCalledOnce();
  });
  it("disabled preference skips both cues and keeps transcription working", async () => {
    api.config.mockResolvedValue({ sound_enabled: false });
    const harness = mount();
    await startReady(harness);
    await beginFinish(harness);
    await settle();
    expect(playDictationSound).not.toHaveBeenCalled();
    expect(api.transcribe).toHaveBeenCalledOnce();
  });
  it("reads a fresh preference for the next recording", async () => {
    const harness = mount();
    await startReady(harness);
    await beginFinish(harness);
    await settle();
    api.config.mockResolvedValue({ sound_enabled: false });
    await startReady(harness);
    await beginFinish(harness);
    await settle();
    expect(api.config).toHaveBeenCalledTimes(2);
    expect(
      vi.mocked(playDictationSound).mock.calls.map(([cue]) => cue),
    ).toEqual(["start", "stop"]);
  });
  it("permission failure never plays a cue", async () => {
    permission.mockRejectedValueOnce(new Error("denied"));
    const harness = mount();
    await start(harness);
    await settle();
    expect(playDictationSound).not.toHaveBeenCalled();
    expect(harness.read().dictationState).toBe("idle");
  });
  it("cancelled startup stops late permission without playing", async () => {
    const request = deferred<MediaStream>(),
      microphone = stream();
    permission.mockReturnValueOnce(request.promise);
    const harness = mount(),
      operation = start(harness);
    await settle();
    act(() => harness.read().handleDictationCancel());
    request.resolve(microphone.value);
    await operation;
    await settle();
    expect(playDictationSound).not.toHaveBeenCalled();
    expect(microphone.stop).toHaveBeenCalledOnce();
  });
  it("explicit cancellation stops once; repeated cancellation stays silent", async () => {
    const harness = mount();
    await startReady(harness);
    act(() => {
      harness.read().handleDictationCancel();
      harness.read().handleDictationCancel();
    });
    expect(
      vi.mocked(playDictationSound).mock.calls.map(([cue]) => cue),
    ).toEqual(["start", "stop"]);
    expect(api.transcribe).not.toHaveBeenCalled();
  });
  it.each(["switch", "unmount", "discard"] as const)(
    "%s cancels pending/active output and never emits a stale stop cue",
    async (action) => {
      const harness = mount();
      await startReady(harness);
      if (action === "switch")
        harness.rerender(new ComposerController({ text: "new owner" }));
      else if (action === "unmount") harness.unmount();
      else act(() => harness.read().discardDictationSession());
      expect(cancelled[0]).toHaveBeenCalledOnce();
      expect(playDictationSound).toHaveBeenCalledTimes(1);
    },
  );
});
