export const LIVE_TRANSCRIBE_INTERVAL_MS = 700;
export const LIVE_TRANSCRIBE_MIN_DURATION_SECONDS = 0.6;
export const LIVE_TRANSCRIBE_MAX_DURATION_SECONDS = 1.2;

const PCM16_MAX_ABS = 32768;
const LIVE_TRANSCRIBE_MIN_RMS = 0.006;
const LIVE_TRANSCRIBE_MIN_PEAK = 0.02;

export interface Pcm16LeStats {
  sampleCount: number;
  rms: number;
  peak: number;
}

export function getPcm16LeStats(audioData: ArrayLike<number>): Pcm16LeStats {
  let sumSq = 0;
  let peak = 0;
  let sampleCount = 0;

  for (let index = 0; index + 1 < audioData.length; index += 2) {
    const low = audioData[index] & 0xff;
    const high = audioData[index + 1] & 0xff;
    const unsigned = low | (high << 8);
    const signed = unsigned >= 0x8000 ? unsigned - 0x10000 : unsigned;
    const normalized = Math.abs(signed) / PCM16_MAX_ABS;

    peak = Math.max(peak, normalized);
    sumSq += normalized * normalized;
    sampleCount += 1;
  }

  return {
    sampleCount,
    rms: sampleCount > 0 ? Math.sqrt(sumSq / sampleCount) : 0,
    peak,
  };
}

export function isAudiblePcm16LeSegment(audioData: ArrayLike<number>): boolean {
  const stats = getPcm16LeStats(audioData);
  return (
    stats.sampleCount > 0 &&
    (stats.rms >= LIVE_TRANSCRIBE_MIN_RMS ||
      stats.peak >= LIVE_TRANSCRIBE_MIN_PEAK)
  );
}

function shouldJoinTranscriptWithSpace(left: string, right: string): boolean {
  return /[A-Za-z0-9]$/.test(left) && /^[A-Za-z0-9]/.test(right);
}

export function mergeLiveTranscript(current: string, next: string): string {
  const trimmedCurrent = current.trim();
  const trimmedNext = next.trim();
  if (!trimmedCurrent) {
    return trimmedNext;
  }
  if (!trimmedNext) {
    return trimmedCurrent;
  }

  const maxOverlap = Math.min(32, trimmedCurrent.length, trimmedNext.length);
  for (let length = maxOverlap; length > 0; length -= 1) {
    if (trimmedCurrent.endsWith(trimmedNext.slice(0, length))) {
      return `${trimmedCurrent}${trimmedNext.slice(length)}`;
    }
  }

  const spacer = shouldJoinTranscriptWithSpace(trimmedCurrent, trimmedNext)
    ? " "
    : "";
  return `${trimmedCurrent}${spacer}${trimmedNext}`;
}
