import {
  readDictationHistoryAudio,
  setDictationHistoryTranscript,
} from "./api/dictationHistory";
import {
  polishVoiceInputText,
  transcribeVoiceInputAudio,
} from "./api/asrProvider";
import {
  encodeAudioBufferToMonoPcm16WavBase64,
  getAudioContextConstructor,
} from "./dictationAudio";

export async function recoverDictationHistory(id: string): Promise<void> {
  const blob = await readDictationHistoryAudio(id);
  const AudioContextCtor = getAudioContextConstructor();
  if (!AudioContextCtor) throw new Error("Audio decoding is unavailable");
  const context = new AudioContextCtor();
  let audioBase64: string;
  try {
    const buffer = await context.decodeAudioData(await blob.arrayBuffer());
    audioBase64 = encodeAudioBufferToMonoPcm16WavBase64(buffer);
  } finally {
    await context.close();
  }
  const result = await transcribeVoiceInputAudio({
    audioBase64,
    mimeType: "audio/wav",
  });
  const raw = result.text.trim();
  if (!raw) throw new Error("No speech was recognized");
  let text = raw;
  try {
    const polished = await polishVoiceInputText({ text: raw });
    text = polished.text.trim() || raw;
  } catch {
    // A cleanup failure must not discard a successful transcription.
  }
  await setDictationHistoryTranscript(id, text);
}

export function selectedDictationHistoryId(): string | null {
  return new URLSearchParams(window.location.search).get("recording");
}

export function selectDictationHistory(id: string | null): void {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("recording", id);
  else url.searchParams.delete("recording");
  window.history.replaceState(window.history.state, "", url);
}
