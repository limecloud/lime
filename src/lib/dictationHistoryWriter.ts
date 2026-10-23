import {
  appendDictationHistoryAudio,
  finishDictationHistory,
  setDictationHistoryTranscript,
  startDictationHistory,
  type DictationHistoryFinishStatus,
} from "./api/dictationHistory";
import { bytesToBase64 } from "./dictationAudio";

// Audio I/O follows the existing recording owner; it never owns a draft or recorder.
export class DictationHistoryWriter {
  private pending: Promise<void>;
  private id: string | null = null;
  private offset = 0;
  private failed = false;
  private completion: Promise<string | null> | null = null;

  constructor(
    mimeType: string,
    private readonly onError: () => void,
  ) {
    this.pending = startDictationHistory(mimeType)
      .then((recording) => {
        this.id = recording.id;
      })
      .catch(() => this.reportFailure());
  }

  private reportFailure(): void {
    if (!this.failed) this.onError();
    this.failed = true;
  }

  async getId(): Promise<string | null> {
    await this.pending;
    return this.id;
  }

  append(blob: Blob): void {
    if (this.completion || !blob.size) return;
    this.pending = this.pending
      .then(async () => {
        if (!this.id || this.failed) return;
        const bytes = new Uint8Array(await blob.arrayBuffer());
        for (let index = 0; index < bytes.length; index += 512 * 1024) {
          const chunk = bytes.subarray(index, index + 512 * 1024);
          await appendDictationHistoryAudio(
            this.id,
            this.offset,
            bytesToBase64(chunk),
          );
          this.offset += chunk.length;
        }
      })
      .catch(() => this.reportFailure());
  }

  finish(status: DictationHistoryFinishStatus): Promise<string | null> {
    if (!this.completion) {
      this.completion = this.pending.then(async () => {
        if (!this.id) return null;
        try {
          await finishDictationHistory(
            this.id,
            this.failed ? "interrupted" : status,
          );
          return this.id;
        } catch {
          this.reportFailure();
          return null;
        }
      });
    }
    return this.completion;
  }

  async setTranscript(text: string): Promise<void> {
    const id = await this.finish("saved");
    if (!id) return;
    try {
      await setDictationHistoryTranscript(id, text);
    } catch {
      this.reportFailure();
    }
  }
}
