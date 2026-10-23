import type {
  DictationHistoryEntry,
  DictationHistoryFinishStatus,
} from "@limecloud/app-server-client/browser";
import { createAppServerClient } from "./appServer";
export type { DictationHistoryEntry, DictationHistoryFinishStatus };

export async function listDictationHistory(): Promise<DictationHistoryEntry[]> {
  return (await createAppServerClient().listDictationHistory()).result
    .recordings;
}

export async function startDictationHistory(mimeType: string) {
  return (await createAppServerClient().startDictationHistory({ mimeType }))
    .result.recording;
}

export async function appendDictationHistoryAudio(
  id: string,
  offset: number,
  audioBase64: string,
) {
  return (
    await createAppServerClient().appendDictationHistoryAudio({
      id,
      offset,
      audioBase64,
    })
  ).result.recording;
}

export async function finishDictationHistory(
  id: string,
  status: DictationHistoryFinishStatus,
) {
  return (await createAppServerClient().finishDictationHistory({ id, status }))
    .result.recording;
}

export async function readDictationHistoryAudio(id: string): Promise<Blob> {
  const { audioBase64, mimeType } = (
    await createAppServerClient().readDictationHistoryAudio({ id })
  ).result;
  const bytes = Uint8Array.from(atob(audioBase64), (c) => c.charCodeAt(0));
  return new Blob([bytes], { type: mimeType });
}

export async function setDictationHistoryTranscript(id: string, text: string) {
  return (
    await createAppServerClient().setDictationHistoryTranscript({ id, text })
  ).result.recording;
}

export async function deleteDictationHistory(id: string): Promise<void> {
  await createAppServerClient().deleteDictationHistory({ id });
}
