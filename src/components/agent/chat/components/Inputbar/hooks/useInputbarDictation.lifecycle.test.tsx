import { act } from "react";
import { describe, expect, it, vi } from "vitest";
import { ComposerController } from "@/components/input-kit/ComposerController";
import {
  api,
  FakeAudioContext,
  deferred,
  stream,
  recorders,
  processors,
  permission,
  mount,
  settle,
  start,
  startReady,
  beginFinish,
  sample,
} from "./inputbarDictationLifecycle.testFixtures";

describe("dictation lifecycle", () => {
  it("discard 未完成的音频 decode 立即关闭上下文，不向 ASR 派发旧数据", async () => {
    const decoded = await new FakeAudioContext().decodeAudioData();
    const response = deferred<AudioBuffer>();
    const harness = mount();
    await startReady(harness);
    const decode = vi
      .spyOn(FakeAudioContext.prototype, "decodeAudioData")
      .mockReturnValueOnce(response.promise);
    const close = vi.spyOn(FakeAudioContext.prototype, "close");
    const operation = beginFinish(harness);
    await settle();
    expect(decode).toHaveBeenCalledOnce();
    close.mockClear();
    const original = harness.controller.getSnapshot();
    act(() => expect(harness.read().discardDictationSession()).toBe(true));
    expect(close).toHaveBeenCalledOnce();
    response.resolve(decoded);
    await settle();
    await operation;
    expect(api.transcribe).not.toHaveBeenCalled();
    expect(harness.controller.getSnapshot()).toBe(original);
    expect(close).toHaveBeenCalledOnce();
    await startReady(harness);
  });

  it("已经 composing 时不请求麦克风，也不改变草稿", async () => {
    const harness = mount();
    const original = harness.controller.getSnapshot();
    harness.composition.active = true;
    await start(harness);
    expect(permission).not.toHaveBeenCalled();
    expect(harness.controller.getSnapshot()).toBe(original);
    expect(harness.read().dictationState).toBe("idle");
  });

  it("discard starting 隔离迟到 permission，且不回滚已有草稿", async () => {
    const request = deferred<MediaStream>();
    const stale = stream();
    permission.mockReturnValueOnce(request.promise);
    const harness = mount();
    const operation = start(harness);
    await settle();
    const original = harness.controller.getSnapshot();
    act(() => expect(harness.read().discardDictationSession()).toBe(true));
    expect(harness.controller.getSnapshot()).toBe(original);
    request.resolve(stale.value);
    await settle();
    await operation;
    expect(stale.stop).toHaveBeenCalledOnce();
    expect(recorders).toHaveLength(0);
    expect(harness.focus).not.toHaveBeenCalled();
    expect(harness.read().dictationState).toBe("idle");
    await startReady(harness);
  });

  it("discard live 不恢复旧稿，清 recorder/sampler/timers 并隔离迟到 preview", async () => {
    const microphone = stream();
    permission.mockResolvedValueOnce(microphone.value);
    const harness = mount();
    await startReady(harness);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    const current = harness.controller.getSnapshot();
    expect(current.document.text).toContain("听写结果");
    const late = deferred<{ text: string }>();
    api.transcribe.mockReturnValueOnce(late.promise);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    const calls = harness.setText.mock.calls.length;
    act(() => expect(harness.read().discardDictationSession()).toBe(true));
    late.resolve({ text: "迟到 preview" });
    await settle();
    expect(harness.controller.getSnapshot()).toBe(current);
    expect(harness.setText).toHaveBeenCalledTimes(calls);
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(recorders[0].state).toBe("inactive");
    expect(processors[0].onaudioprocess).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
    expect(harness.read().dictationState).toBe("idle");
  });

  it.each(["transcribe", "polish"] as const)(
    "discard %s 不重写、不 focus，也不恢复已结束的 session",
    async (stage) => {
      const response = deferred<{ text: string }>();
      api[stage].mockReturnValueOnce(response.promise);
      const harness = mount();
      await startReady(harness);
      const operation = beginFinish(harness);
      await settle();
      const original = harness.controller.getSnapshot();
      act(() => expect(harness.read().discardDictationSession()).toBe(true));
      response.resolve({ text: "迟到 final" });
      await settle();
      await operation;
      expect(harness.controller.getSnapshot()).toBe(original);
      expect(harness.focus).not.toHaveBeenCalled();
      expect(harness.read().discardDictationSession()).toBe(false);
      expect(api.toast).not.toHaveBeenCalled();
    },
  );

  it.each(["resolve", "reject"] as const)(
    "同 Controller 切会话后旧 permission %s 不影响新录音",
    async (outcome) => {
      const request = deferred<MediaStream>();
      const stale = stream();
      permission.mockReturnValueOnce(request.promise);
      const harness = mount();
      const operation = start(harness);
      await settle();
      harness.rerender(harness.controller, "session-b");
      await startReady(harness);
      if (outcome === "resolve") request.resolve(stale.value);
      else request.reject(new Error("old denied"));
      await settle();
      await operation;
      expect(harness.read().dictationState).toBe("listening");
      expect(recorders).toHaveLength(1);
      expect(api.toast).not.toHaveBeenCalled();
      if (outcome === "resolve") expect(stale.stop).toHaveBeenCalledOnce();
    },
  );

  it.each(["transcribe", "polish"] as const)(
    "同 Controller 切会话隔离 %s 与旧 toggle/cancel/discard",
    async (stage) => {
      const response = deferred<{ text: string }>();
      api[stage].mockReturnValueOnce(response.promise);
      const harness = mount();
      await startReady(harness);
      const old = harness.read();
      const operation = beginFinish(harness);
      await settle();
      harness.rerender(harness.controller, "session-b");
      act(() => harness.controller.setText("新会话草稿😀"));
      const newer = harness.controller.getSnapshot();
      await old.handleDictationToggle();
      expect(permission).toHaveBeenCalledOnce();
      await startReady(harness);
      act(() => {
        old.handleDictationCancel();
        expect(old.discardDictationSession()).toBe(false);
      });
      response.resolve({ text: "旧会话结果" });
      await settle();
      await operation;
      expect(harness.controller.getSnapshot()).toBe(newer);
      expect(harness.focus).not.toHaveBeenCalled();
      expect(harness.read().dictationState).toBe("listening");
      expect(recorders[1].state).toBe("recording");
    },
  );

  it("deferred permission 同步锁只允许一次启动，随后正常录音", async () => {
    const request = deferred<MediaStream>();
    const microphone = stream();
    permission.mockReturnValue(request.promise);
    const harness = mount();
    const first = start(harness);
    await settle();
    const second = start(harness);
    expect(permission).toHaveBeenCalledTimes(1);
    expect(harness.read().dictationState).toBe("starting");
    expect(harness.read().isDictationBusy).toBe(true);
    request.resolve(microphone.value);
    await settle();
    await Promise.all([first, second]);
    expect(recorders).toHaveLength(1);
    expect(harness.read().dictationState).toBe("listening");
  });

  it("旧 permission reject 不重置换 owner 后的新录音，也不发旧 toast", async () => {
    const oldRequest = deferred<MediaStream>();
    const newer = stream();
    permission
      .mockReturnValueOnce(oldRequest.promise)
      .mockResolvedValueOnce(newer.value);
    const harness = mount();
    const oldStart = start(harness);
    await settle();
    harness.rerender(new ComposerController({ text: "新工作区" }));
    await startReady(harness);
    const denied = new Error("old denied");
    denied.name = "NotAllowedError";
    oldRequest.reject(denied);
    await settle();
    await oldStart;
    expect(newer.stop).not.toHaveBeenCalled();
    expect(harness.read().dictationState).toBe("listening");
    expect(api.toast).not.toHaveBeenCalled();
  });

  it("旧 permission success 只停止迟到 stream，不启动 recorder", async () => {
    const oldRequest = deferred<MediaStream>();
    const obsolete = stream();
    permission.mockReturnValueOnce(oldRequest.promise);
    const harness = mount();
    const operation = start(harness);
    await settle();
    harness.rerender(new ComposerController({ text: "新草稿" }));
    oldRequest.resolve(obsolete.value);
    await settle();
    await operation;
    expect(obsolete.stop).toHaveBeenCalledOnce();
    expect(recorders).toHaveLength(0);
    expect(harness.read().dictationState).toBe("idle");
  });

  it("同 revision 的不同 Controller 不接收旧 session final", async () => {
    const oldOwner = new ComposerController({ text: "旧草稿" });
    const newOwner = new ComposerController({ text: "新草稿" });
    expect(oldOwner.getSnapshot().revision).toBe(
      newOwner.getSnapshot().revision,
    );
    const harness = mount(oldOwner);
    await startReady(harness);
    const oldSnapshot = oldOwner.getSnapshot();
    const newSnapshot = newOwner.getSnapshot();
    const finishOld = harness.read().handleDictationToggle;
    harness.rerender(newOwner);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(500);
      await finishOld();
    });
    expect(oldOwner.getSnapshot()).toBe(oldSnapshot);
    expect(newOwner.getSnapshot()).toBe(newSnapshot);
    expect(api.transcribe).not.toHaveBeenCalled();
  });

  it.each(["transcribe", "polish"] as const)(
    "%s pending 切 owner 拒绝迟到结果与旧 focus",
    async (stage) => {
      const response = deferred<{ text: string }>();
      api[stage].mockReturnValueOnce(response.promise);
      const harness = mount();
      await startReady(harness);
      const operation = beginFinish(harness);
      await settle();
      const oldSnapshot = harness.controller.getSnapshot();
      const next = new ComposerController({
        text: "新😀",
        attachments: [{ data: "new", mediaType: "image/png" }],
      });
      const newSnapshot = next.getSnapshot();
      harness.rerender(next);
      response.resolve({ text: "迟到结果" });
      await settle();
      await operation;
      expect(harness.controller.getSnapshot()).toBe(oldSnapshot);
      expect(next.getSnapshot()).toBe(newSnapshot);
      expect(harness.focus).not.toHaveBeenCalled();
      expect(harness.read().dictationState).toBe("idle");
    },
  );

  it("cancel live 回滚仅属于 session 的插入，保留 atom 与资源，再次录音成功", async () => {
    const microphone = stream();
    permission.mockResolvedValueOnce(microphone.value);
    const controller = new ComposerController({
      editorDocument: {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "mention",
                attrs: {
                  id: "skill",
                  kind: "skill",
                  name: "review",
                  path: "/skills/review",
                  label: "/review",
                },
              },
              { type: "text", text: " 原文" },
            ],
          },
        ],
      },
      attachments: [{ data: "image", mediaType: "image/png" }],
      pathReferences: [
        { id: "path", name: "file", path: "/tmp/file", isDir: false },
      ],
    });
    const original = controller.captureDraft();
    const harness = mount(controller);
    await startReady(harness);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    expect(controller.getDocument().text).toContain("听写结果");
    act(() => harness.read().handleDictationCancel());
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(recorders[0].state).toBe("inactive");
    expect(controller.captureDraft()).toEqual(original);
    expect(harness.read().dictationState).toBe("idle");
    await startReady(harness);
    expect(permission).toHaveBeenCalledTimes(2);
  });

  it("cancel 保留 live 后的用户新稿、附件和路径，迟到 preview 不覆盖", async () => {
    const late = deferred<{ text: string }>();
    const harness = mount();
    await startReady(harness);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    expect(harness.controller.getDocument().text).toContain("听写结果");
    api.transcribe.mockReturnValueOnce(late.promise);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    act(() => {
      harness.controller.setText("用户新稿😀");
      harness.controller.setAttachments([
        { data: "new", mediaType: "image/png" },
      ]);
      harness.controller.setPathReferences([
        { id: "new", name: "new", path: "/tmp/new", isDir: false },
      ]);
    });
    const newer = harness.controller.getSnapshot();
    act(() => harness.read().handleDictationCancel());
    late.resolve({ text: "旧 preview" });
    await settle();
    expect(harness.controller.getSnapshot()).toBe(newer);
    expect(harness.read().liveTranscript).toBe("");
    expect(harness.read().dictationState).toBe("idle");
  });

  it.each(["starting", "transcribe", "polish"] as const)(
    "%s 中 cancel 保新稿并允许重试",
    async (stage) => {
      const response = deferred<MediaStream | { text: string }>();
      const stale = stream();
      const harness = mount();
      let operation: Promise<void>;
      if (stage === "starting") {
        permission.mockReturnValueOnce(response.promise);
        operation = start(harness);
        await settle();
      } else {
        await startReady(harness);
        api[stage].mockReturnValueOnce(response.promise);
        operation = beginFinish(harness);
        await settle();
      }
      act(() => harness.controller.setText("后来编辑😀"));
      const newer = harness.controller.getSnapshot();
      act(() => harness.read().handleDictationCancel());
      response.resolve(
        stage === "starting" ? stale.value : { text: "取消后的旧结果" },
      );
      await settle();
      await operation;
      expect(harness.controller.getSnapshot()).toBe(newer);
      expect(harness.read().dictationState).toBe("idle");
      expect(api.toast).not.toHaveBeenCalled();
      if (stage === "starting") expect(stale.stop).toHaveBeenCalledOnce();
      await startReady(harness);
    },
  );

  it("当前 permission 失败后复位，重试可以录音", async () => {
    permission.mockRejectedValueOnce(new Error("current denied"));
    const harness = mount();
    const operation = start(harness);
    await settle();
    await operation;
    expect(api.toast).toHaveBeenCalledOnce();
    expect(harness.read().dictationState).toBe("idle");
    await startReady(harness);
  });

  it("unmount 后迟到 permission 拒绝不发 toast，也不启动 recorder", async () => {
    const request = deferred<MediaStream>();
    permission.mockReturnValueOnce(request.promise);
    const harness = mount();
    const operation = start(harness);
    await settle();
    harness.unmount();
    request.reject(new Error("after unmount"));
    await settle();
    await operation;
    expect(api.toast).not.toHaveBeenCalled();
    expect(recorders).toHaveLength(0);
  });

  it("同步重复结束只请求一次 final ASR，完成后恢复 idle", async () => {
    const response = deferred<{ text: string }>();
    const harness = mount();
    await startReady(harness);
    api.transcribe.mockReturnValueOnce(response.promise);
    const first = beginFinish(harness);
    const second = start(harness);
    await settle();
    expect(api.transcribe).toHaveBeenCalledTimes(1);
    response.resolve({ text: "final😀" });
    await settle();
    await Promise.all([first, second]);
    expect(harness.controller.getDocument().text).toBe("原草稿 final😀");
    expect(harness.read().dictationState).toBe("idle");
    expect(recorders[0].state).toBe("inactive");
  });

  it("current ASR 失败清理录音，并可重试", async () => {
    api.transcribe.mockRejectedValueOnce(new Error("ASR failed"));
    const microphone = stream();
    permission.mockResolvedValueOnce(microphone.value);
    const harness = mount();
    await startReady(harness);
    const original = harness.controller.getSnapshot();
    const operation = beginFinish(harness);
    await settle();
    await operation;
    expect(harness.controller.getSnapshot()).toBe(original);
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(api.toast).toHaveBeenCalledOnce();
    expect(harness.read().dictationState).toBe("idle");
    await startReady(harness);
  });

  it("润色失败沿 current raw transcript 完成，不丢周围草稿", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    api.polish.mockRejectedValueOnce(new Error("polish failed"));
    const harness = mount();
    await startReady(harness);
    const operation = beginFinish(harness);
    await settle();
    await operation;
    expect(harness.controller.getDocument().text).toBe("原草稿 听写结果");
    expect(harness.read().dictationState).toBe("idle");
    expect(api.toast).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
  });

  it("live result 发现 composing 时整 session 失效，不缓存或自动重启", async () => {
    const response = deferred<{ text: string }>();
    const microphone = stream();
    permission.mockResolvedValueOnce(microphone.value);
    api.transcribe.mockReturnValueOnce(response.promise);
    const harness = mount();
    await startReady(harness);
    const original = harness.controller.getSnapshot();
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    harness.composition.active = true;
    response.resolve({ text: "不能写入的组合期结果" });
    await settle();
    expect(harness.controller.getSnapshot()).toBe(original);
    expect(harness.read().dictationState).toBe("idle");
    expect(harness.read().liveTranscript).toBe("");
    expect(microphone.stop).toHaveBeenCalledOnce();
    expect(processors[0].onaudioprocess).toBeNull();
    expect(recorders[0].state).toBe("inactive");
    expect(vi.getTimerCount()).toBe(0);
    harness.composition.active = false;
    act(() => vi.advanceTimersByTime(4000));
    await settle();
    expect(api.transcribe).toHaveBeenCalledOnce();
    expect(harness.controller.getSnapshot()).toBe(original);
    await startReady(harness);
  });

  it.each(["transcribe", "polish"] as const)(
    "final %s 发现 composing 时无回滚结束，组合结束也不插入",
    async (stage) => {
      const response = deferred<{ text: string }>();
      api[stage].mockReturnValueOnce(response.promise);
      const harness = mount();
      await startReady(harness);
      const original = harness.controller.getSnapshot();
      const operation = beginFinish(harness);
      await settle();
      harness.composition.active = true;
      response.resolve({ text: "组合期 final" });
      await settle();
      await operation;
      expect(harness.controller.getSnapshot()).toBe(original);
      expect(harness.read().dictationState).toBe("idle");
      expect(harness.read().liveTranscript).toBe("");
      expect(harness.focus).not.toHaveBeenCalled();
      expect(harness.setText).not.toHaveBeenCalled();
      harness.composition.active = false;
      act(() => vi.advanceTimersByTime(4000));
      await settle();
      expect(harness.controller.getSnapshot()).toBe(original);
      await startReady(harness);
    },
  );

  it("composing 已提交新 revision 时也结束 live session，保留新稿与附件", async () => {
    const response = deferred<{ text: string }>();
    api.transcribe.mockReturnValueOnce(response.promise);
    const harness = mount();
    await startReady(harness);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    harness.composition.active = true;
    act(() => {
      harness.controller.setText("中文组合新稿😀");
      harness.controller.setAttachments([
        { data: "new", mediaType: "image/png" },
      ]);
    });
    const newer = harness.controller.getSnapshot();
    response.resolve({ text: "旧 live" });
    await settle();
    expect(harness.controller.getSnapshot()).toBe(newer);
    expect(harness.read().dictationState).toBe("idle");
    expect(recorders[0].state).toBe("inactive");
    harness.composition.active = false;
    await startReady(harness);
    expect(harness.controller.getSnapshot()).toBe(newer);
  });

  it("composing fallback discard 保留已插入草稿，随后 cancel 不恢复更早文档", async () => {
    const harness = mount();
    await startReady(harness);
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    const provisional = harness.controller.getSnapshot();
    expect(provisional.document.text).toContain("听写结果");
    harness.composition.active = true;
    act(() => {
      sample();
      vi.advanceTimersByTime(2000);
    });
    await settle();
    expect(harness.read().dictationState).toBe("idle");
    act(() => harness.read().handleDictationCancel());
    expect(harness.controller.getSnapshot()).toBe(provisional);
    expect(harness.focus).not.toHaveBeenCalled();
    expect(harness.read().discardDictationSession()).toBe(false);
  });

  it("每次录音读取最新麦克风，指定设备必须 exact 匹配", async () => {
    const harness = mount();
    api.config.mockResolvedValueOnce({ selected_device_id: "usb-mic" });
    await startReady(harness);
    expect(permission).toHaveBeenLastCalledWith({
      audio: {
        deviceId: { exact: "usb-mic" },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    act(() => harness.read().handleDictationCancel());
    api.config.mockResolvedValueOnce({});
    await startReady(harness);
    expect(permission).toHaveBeenLastCalledWith({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
      },
    });
    expect(api.config).toHaveBeenCalledTimes(2);
  });

  it("配置读取失败不申请权限，失败后可重试", async () => {
    api.config.mockRejectedValueOnce(new Error("config unavailable"));
    const harness = mount();
    await act(async () => {
      await start(harness);
    });
    await settle();
    expect(permission).not.toHaveBeenCalled();
    expect(api.toast).toHaveBeenCalledOnce();
    expect(harness.read().dictationState).toBe("idle");
    await startReady(harness);
  });

  it.each(["cancel", "discard", "session", "owner", "unmount"] as const)(
    "配置迟到且 %s 后不申请权限，不启动旧录音",
    async (reason) => {
      const request = deferred<{ selected_device_id: string }>();
      api.config.mockReturnValueOnce(request.promise);
      const harness = mount();
      const operation = start(harness);
      expect(api.config).toHaveBeenCalledOnce();
      expect(permission).not.toHaveBeenCalled();
      if (reason === "cancel")
        act(() => harness.read().handleDictationCancel());
      if (reason === "discard")
        act(() => {
          harness.read().discardDictationSession();
        });
      if (reason === "session")
        harness.rerender(harness.controller, "session-b");
      if (reason === "owner")
        harness.rerender(new ComposerController({ text: "新稿" }));
      if (reason === "unmount") harness.unmount();
      request.resolve({ selected_device_id: "stale-mic" });
      await settle();
      await operation;
      expect(permission).not.toHaveBeenCalled();
      expect(recorders).toHaveLength(0);
      expect(api.toast).not.toHaveBeenCalled();
      if (reason !== "unmount") await startReady(harness);
    },
  );

  it("配置 pending 的同步重复点击只读取一次配置", async () => {
    const request = deferred<Record<string, never>>();
    api.config.mockReturnValueOnce(request.promise);
    const harness = mount();
    const first = start(harness);
    const second = start(harness);
    expect(api.config).toHaveBeenCalledOnce();
    request.resolve({});
    await settle();
    await Promise.all([first, second]);
    expect(permission).toHaveBeenCalledOnce();
    expect(recorders).toHaveLength(1);
  });
});
