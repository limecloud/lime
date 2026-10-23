import { describe, expect, it, vi } from "vitest";
import { playDictationSound } from "./inputbarDictationSounds";

function audioFixture() {
  const parameter = () => ({
    setValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const oscillator = {
    frequency: parameter(),
    onended: null as (() => void) | null,
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
  };
  const gain = { gain: parameter(), connect: vi.fn(), disconnect: vi.fn() };
  const audio = {
    currentTime: 10,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  const constructor = vi.fn(function () {
    return audio;
  }) as unknown as typeof AudioContext;
  return { audio, gain, oscillator, constructor };
}
async function settle() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

describe("dictation audio output", () => {
  it.each(["start", "stop"] as const)(
    "%s connects a short nonzero cue to output and releases it after playback",
    async (cue) => {
      const f = audioFixture();
      const cancel = playDictationSound(cue, f.constructor);
      await settle();
      expect(f.oscillator.connect).toHaveBeenCalledWith(f.gain);
      expect(f.gain.connect).toHaveBeenCalledWith(f.audio.destination);
      const initial = f.oscillator.frequency.setValueAtTime.mock
        .calls[0][0] as number;
      const final = f.oscillator.frequency.exponentialRampToValueAtTime.mock
        .calls[0][0] as number;
      expect(cue === "start" ? final > initial : final < initial).toBe(true);
      expect(
        f.gain.gain.exponentialRampToValueAtTime.mock.calls.some(
          ([volume]) => volume > 0 && volume <= 0.1,
        ),
      ).toBe(true);
      expect(f.oscillator.start).toHaveBeenCalledOnce();
      expect(
        f.oscillator.stop.mock.calls[0][0] - f.audio.currentTime,
      ).toBeGreaterThan(0);
      expect(
        f.oscillator.stop.mock.calls[0][0] - f.audio.currentTime,
      ).toBeLessThan(1);
      f.oscillator.onended?.();
      cancel();
      expect(f.oscillator.disconnect).toHaveBeenCalledOnce();
      expect(f.gain.disconnect).toHaveBeenCalledOnce();
      expect(f.audio.close).toHaveBeenCalledOnce();
    },
  );
  it("cancellation before resume blocks late playback and closes exactly once", async () => {
    const f = audioFixture();
    let resume!: () => void;
    f.audio.resume.mockReturnValue(
      new Promise<void>((resolve) => {
        resume = resolve;
      }),
    );
    const cancel = playDictationSound("start", f.constructor);
    cancel();
    resume();
    await settle();
    cancel();
    expect(f.audio.createOscillator).not.toHaveBeenCalled();
    expect(f.audio.close).toHaveBeenCalledOnce();
  });
  it.each(["resume", "output"] as const)(
    "%s failure closes resources without rejecting dictation",
    async (stage) => {
      const f = audioFixture();
      if (stage === "resume")
        f.audio.resume.mockRejectedValue(new Error("output denied"));
      else
        f.gain.connect.mockImplementation(() => {
          throw new Error("output detached");
        });
      const cancel = playDictationSound("stop", f.constructor);
      await settle();
      expect(f.audio.close).toHaveBeenCalledOnce();
      expect(() => cancel()).not.toThrow();
      expect(f.oscillator.start).not.toHaveBeenCalled();
    },
  );
  it("missing or throwing AudioContext remains a no-op", () => {
    const unsupported = vi.fn(function () {
      throw new Error("unsupported");
    }) as unknown as typeof AudioContext;
    expect(() => playDictationSound("start", null)()).not.toThrow();
    expect(() => playDictationSound("stop", unsupported)()).not.toThrow();
  });
});
