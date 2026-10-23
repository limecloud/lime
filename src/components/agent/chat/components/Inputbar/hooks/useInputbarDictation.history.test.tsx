import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import {
  api,
  historyApi,
  recorders,
  mount,
  settle,
  startReady,
  beginFinish,
  deferred,
} from "./inputbarDictationLifecycle.testFixtures";

describe("dictation history lifecycle", () => {
  it("marks recorder stop failures interrupted without sending incomplete audio to ASR", async () => {
    const harness = mount();
    await startReady(harness);
    vi.spyOn(recorders[0], "stop").mockImplementationOnce(() => {
      throw new Error("recorder failed");
    });
    await act(async () => {
      await beginFinish(harness);
    });
    await settle();
    expect(historyApi.finish).toHaveBeenCalledExactlyOnceWith(
      "recording-test",
      "interrupted",
    );
    expect(api.transcribe).not.toHaveBeenCalled();
    expect(harness.read().dictationState).toBe("idle");
  });

  it("saves final audio on unmount while preserving the draft owner", async () => {
    const harness = mount();
    await startReady(harness);
    const recorder = recorders[0];
    const originalStop = recorder.stop.bind(recorder);
    vi.spyOn(recorder, "stop").mockImplementation(() => {
      recorder.requestData();
      originalStop();
    });
    harness.unmount();
    await settle();
    expect(historyApi.append).toHaveBeenCalledWith(
      "recording-test",
      0,
      btoa("recorded-audio"),
    );
    expect(historyApi.finish).toHaveBeenCalledExactlyOnceWith(
      "recording-test",
      "interrupted",
    );
    expect(api.transcribe).not.toHaveBeenCalled();
  });

  it("keeps previews within one recording and saves the final transcript after terminal audio", async () => {
    const harness = mount();
    await startReady(harness);
    act(() => recorders[0].requestData());
    await settle();
    act(() => recorders[0].requestData());
    await settle();
    await act(async () => {
      await beginFinish(harness);
    });
    await settle();
    expect(historyApi.start).toHaveBeenCalledTimes(1);
    expect(historyApi.append.mock.calls.map((call) => call[1])).toEqual([
      0, 14, 28,
    ]);
    expect(historyApi.finish).toHaveBeenCalledExactlyOnceWith(
      "recording-test",
      "saved",
    );
    expect(historyApi.transcript).toHaveBeenCalledExactlyOnceWith(
      "recording-test",
      "听写结果",
    );
  });

  it("captures final dataavailable on cancel without applying it to the restored draft", async () => {
    const harness = mount();
    await startReady(harness);
    const recorder = recorders[0];
    const originalStop = recorder.stop.bind(recorder);
    vi.spyOn(recorder, "stop").mockImplementation(() => {
      recorder.requestData();
      originalStop();
    });
    const draft = harness.controller.getSnapshot();
    act(() => harness.read().handleDictationCancel());
    await settle();
    expect(harness.controller.getSnapshot()).toBe(draft);
    expect(historyApi.append).toHaveBeenCalledWith(
      "recording-test",
      0,
      btoa("recorded-audio"),
    );
    expect(historyApi.finish).toHaveBeenCalledWith(
      "recording-test",
      "cancelled",
    );
    expect(historyApi.transcript).not.toHaveBeenCalled();
    expect(api.transcribe).not.toHaveBeenCalled();
  });

  it("keeps failed final transcription recoverable and isolates late ASR after discard", async () => {
    const harness = mount();
    await startReady(harness);
    api.transcribe.mockRejectedValueOnce(new Error("offline"));
    await act(async () => {
      await beginFinish(harness);
    });
    await settle();
    expect(historyApi.finish).toHaveBeenLastCalledWith(
      "recording-test",
      "saved",
    );
    expect(historyApi.transcript).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalled();
    await startReady(harness);
    const response = deferred<{ text: string }>();
    api.transcribe.mockReturnValueOnce(response.promise);
    const finishing = beginFinish(harness);
    await settle();
    act(() => harness.read().discardDictationSession());
    const draft = harness.controller.getSnapshot();
    response.resolve({ text: "late words" });
    await finishing;
    await settle();
    expect(harness.controller.getSnapshot()).toBe(draft);
    expect(historyApi.transcript).not.toHaveBeenCalled();
  });

  it("waits for pending final audio when cancellation follows an inactive recorder state", async () => {
    const harness = mount();
    await startReady(harness);
    const recorder = recorders[0];
    vi.spyOn(recorder, "stop").mockImplementation(() => {
      recorder.state = "inactive";
    });
    const finishing = beginFinish(harness);
    await settle();
    act(() => harness.read().handleDictationCancel());
    await settle();
    expect(historyApi.finish).not.toHaveBeenCalled();
    act(() => {
      recorder.requestData();
      recorder.dispatchEvent(new Event("stop"));
    });
    await act(async () => {
      await finishing;
    });
    await settle();
    expect(historyApi.append.mock.calls.map((call) => call[1])).toEqual([
      0, 14,
    ]);
    expect(historyApi.finish).toHaveBeenCalledExactlyOnceWith(
      "recording-test",
      "cancelled",
    );
    expect(historyApi.transcript).not.toHaveBeenCalled();
  });
});
