import {
  captureInvokeTraceCollector,
  validateInvokeTraceCollectorCapture,
} from "../../lib/invoke-trace-collector.mjs";
import { collectTraceRequestMethods } from "../../lib/chat-fixture/rpc.mjs";
import { sanitizeText } from "../../lib/chat-fixture/utils.mjs";

/** 只读取错误名和消息；不记录任意控制台参数或配置。 */
export function observePreviewConsoleError(message, stage, details, pending) {
  const detail = {
    stage,
    location: message.location(),
    text: sanitizeText(message.text()),
  };
  details.push(detail);
  pending.push(
    Promise.all(
      message.args().map((argument) =>
        argument.evaluate((value) => {
          const error = value instanceof Error ? value : value?.error;
          return error
            ? {
                name: error.name ?? null,
                message: error.message ?? String(error),
              }
            : null;
        }),
      ),
    ).then(
      (errors) => {
        detail.argumentErrors = errors.filter(Boolean).map((error) => ({
          name: error.name,
          message: sanitizeText(error.message),
        }));
      },
      (error) => {
        detail.observationError = sanitizeText(String(error));
      },
    ),
  );
}

/** 即使业务断言提前失败，也保留可校验的调用错误，不让清理丢失根因。 */
export async function capturePreviewFailureTrace(page, collector) {
  const capture = await captureInvokeTraceCollector(page, collector);
  const trace = validateInvokeTraceCollectorCapture(capture, collector);
  return {
    complete: trace.complete,
    provenance: trace.provenance,
    errors: trace.ledgerEntries
      .filter((entry) => entry.status === "error")
      .map((entry) => ({
        command: entry.command,
        transport: entry.transport,
        methods: collectTraceRequestMethods([entry]),
        error: sanitizeText(String(entry.error ?? "")),
      })),
  };
}
