import {
  clearInvokeErrorBuffer,
  clearInvokeTraceBuffer,
  getInvokeErrorBuffer,
  getInvokeTraceBuffer,
} from "@/lib/dev-bridge/safeInvoke";

export interface TraceRecordingSnapshot {
  startedAt: string;
  endedAt: string;
  invokeTrace: ReturnType<typeof getInvokeTraceBuffer>;
  invokeErrors: ReturnType<typeof getInvokeErrorBuffer>;
}

let startedAt: number | null = null;

export function isTraceRecording(): boolean {
  return startedAt !== null;
}

export function startTraceRecording(): void {
  clearInvokeTraceBuffer();
  clearInvokeErrorBuffer();
  startedAt = Date.now();
}

export function stopTraceRecording(): TraceRecordingSnapshot | null {
  if (startedAt === null) return null;
  const startedAtMs = startedAt;
  startedAt = null;
  return {
    startedAt: new Date(startedAtMs).toISOString(),
    endedAt: new Date().toISOString(),
    invokeTrace: getInvokeTraceBuffer(500),
    invokeErrors: getInvokeErrorBuffer(200),
  };
}

export function downloadTraceRecording(snapshot: TraceRecordingSnapshot): void {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `lime-trace-${snapshot.startedAt.replace(/[:.]/g, "-")}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
