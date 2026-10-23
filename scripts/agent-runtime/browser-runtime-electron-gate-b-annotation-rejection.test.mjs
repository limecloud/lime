import { describe, expect, it } from "vitest";
import { expectedBrowserAnnotationRejectionErrors } from "./browser-runtime-electron-gate-b-annotation-rejection.mjs";

const expected = () => [
  "[AgentDebug] AgentStream.submitFailed {elapsedMs: 43, error: Object, eventName: agent_stream_a1-b2, sessionId: c3-d4, submitInvokeMs: 42}",
  "[AgentChat] 发送失败: Error: model_input_capability_gap:missing_input_modalities:image\n    at submit (file:///dist/app.js:1:2)",
  "[AgentChat] 发送消息失败: Error: model_input_capability_gap:missing_input_modalities:image\n    at submit (file:///dist/app.js:1:2)",
];

describe("annotation expected rejection diagnostics", () => {
  it("retains the exact capability rejection diagnostics", () => {
    const errors = expected();
    expect(expectedBrowserAnnotationRejectionErrors(errors)).toBe(errors);
  });

  it.each([
    [],
    expected().slice(1),
    [...expected(), "Uncaught TypeError"],
    expected().toReversed(),
    expected().map((error) =>
      error.replace("missing_input_modalities:image", "provider_unavailable"),
    ),
    expected().map((error) =>
      error.replace("AgentStream.submitFailed", "unrelated.failure"),
    ),
  ])("rejects missing or unrelated errors: %j", (...errors) => {
    expect(() => expectedBrowserAnnotationRejectionErrors(errors)).toThrow(
      "unexpected console errors",
    );
  });
});
