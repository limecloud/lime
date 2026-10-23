/** A short local cue; failure must never interrupt dictation. */
export function playDictationSound(
  cue: "start" | "stop",
  AudioContextCtor: typeof AudioContext | null,
): () => void {
  let context: AudioContext | null = null;
  let oscillator: OscillatorNode | null = null;
  let gain: GainNode | null = null;
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    if (oscillator) {
      oscillator.onended = null;
    }
    for (const release of [
      () => oscillator?.stop(),
      () => oscillator?.disconnect(),
      () => gain?.disconnect(),
      () => {
        if (context) void context.close().catch(() => undefined);
      },
    ]) {
      try {
        release();
      } catch {
        /* A detached output device must not interrupt dictation. */
      }
    }
  };
  if (!AudioContextCtor) return dispose;
  try {
    context = new AudioContextCtor();
    const audio = context;
    void audio.resume().then(() => {
      if (disposed) return;
      try {
        oscillator = audio.createOscillator();
        gain = audio.createGain();
        oscillator.connect(gain);
        gain.connect(audio.destination);
        const now = audio.currentTime;
        oscillator.frequency.setValueAtTime(cue === "start" ? 660 : 880, now);
        oscillator.frequency.exponentialRampToValueAtTime(
          cue === "start" ? 880 : 660,
          now + 0.12,
        );
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(0.05, now + 0.015);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
        oscillator.onended = dispose;
        oscillator.start(now);
        oscillator.stop(now + 0.15);
      } catch {
        dispose();
      }
    }, dispose);
  } catch {
    dispose();
  }
  return dispose;
}
