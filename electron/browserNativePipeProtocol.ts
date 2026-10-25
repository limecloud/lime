import { Buffer } from "node:buffer";

export const NATIVE_PIPE_PROTOCOL_VERSION = 1;
export const MAX_NATIVE_PIPE_FRAME_BYTES = 1024 * 1024;

export interface CdpEvent {
  source: { tabId: string; sessionId?: string; targetId?: string };
  method: string;
  params?: Record<string, unknown>;
}

export interface NativePipeConnection {
  pipePath: string;
  token: string;
  protocolVersion: typeof NATIVE_PIPE_PROTOCOL_VERSION;
}

export interface NativePipeMessage {
  jsonrpc: "2.0";
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
}

/** Local transport framing; notification names and CDP payloads match the Desktop contract. */
export function nativePipeFrame(message: NativePipeMessage): Buffer {
  const payload = Buffer.from(JSON.stringify(message), "utf8");
  if (payload.length > MAX_NATIVE_PIPE_FRAME_BYTES)
    throw new Error("Browser native pipe frame exceeds the size limit");
  return Buffer.concat([payload, Buffer.from("\n")]);
}

export class NativePipeFrames {
  #pending = Buffer.alloc(0);

  constructor(readonly maxBytes = MAX_NATIVE_PIPE_FRAME_BYTES) {}

  read(chunk: Buffer): NativePipeMessage[] {
    const messages: NativePipeMessage[] = [];
    let offset = 0;
    while (offset < chunk.length) {
      const end = chunk.indexOf(10, offset);
      const part = chunk.subarray(offset, end < 0 ? chunk.length : end);
      if (this.#pending.length + part.length > this.maxBytes)
        throw new Error("Browser native pipe frame exceeds the size limit");
      this.#pending = Buffer.concat([this.#pending, part]);
      if (end < 0) break;
      const value: unknown = JSON.parse(this.#pending.toString("utf8"));
      this.#pending = Buffer.alloc(0);
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        (value as NativePipeMessage).jsonrpc !== "2.0"
      )
        throw new Error("Invalid Browser native pipe message");
      messages.push(value as NativePipeMessage);
      offset = end + 1;
    }
    return messages;
  }
}
