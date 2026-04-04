import { beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import {
  addAsrCredential,
  cancelRecording,
  closeVoiceWindow,
  deleteAsrCredential,
  deleteVoiceInstruction,
  getAsrCredentials,
  getRecordingStatus,
  getVoiceInputConfig,
  getVoiceInstructions,
  listAudioDevices,
  openInputWithText,
  openVoiceWindow,
  outputVoiceText,
  polishVoiceText,
  saveVoiceInputConfig,
  saveVoiceInstruction,
  setDefaultAsrCredential,
  startRecording,
  stopRecording,
  testAsrCredential,
  transcribeAudio,
  updateAsrCredential,
} from "./asrProvider";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

describe("asrProvider API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("应代理设备与凭证命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([
        { id: "default", name: "系统默认", is_default: true },
      ])
      .mockResolvedValueOnce([{ id: "cred-1", provider: "openai" }])
      .mockResolvedValueOnce({ id: "cred-2", provider: "openai" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ success: true, message: "ok" });

    await expect(listAudioDevices()).resolves.toEqual([
      expect.objectContaining({ id: "default" }),
    ]);
    await expect(getAsrCredentials()).resolves.toEqual([
      expect.objectContaining({ id: "cred-1" }),
    ]);
    await expect(
      addAsrCredential({
        provider: "openai",
        is_default: true,
        disabled: false,
        language: "zh-CN",
      }),
    ).resolves.toEqual(expect.objectContaining({ id: "cred-2" }));
    await expect(
      updateAsrCredential({
        id: "cred-2",
        provider: "openai",
        is_default: true,
        disabled: false,
        language: "zh-CN",
      }),
    ).resolves.toBeUndefined();
    await expect(deleteAsrCredential("cred-2")).resolves.toBeUndefined();
    await expect(setDefaultAsrCredential("cred-2")).resolves.toBeUndefined();
    await expect(testAsrCredential("cred-2")).resolves.toEqual(
      expect.objectContaining({ success: true }),
    );
  });

  it("应代理语音输入配置与指令命令", async () => {
    const config = {
      enabled: true,
      shortcut: "CommandOrControl+Shift+V",
      processor: {
        polish_enabled: true,
        default_instruction_id: "default",
      },
      output: {
        mode: "type" as const,
        type_delay_ms: 10,
      },
      instructions: [],
      sound_enabled: true,
      translate_instruction_id: "default",
    };

    vi.mocked(safeInvoke)
      .mockResolvedValueOnce(config)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce([
        { id: "inst-1", name: "默认", prompt: "优化", is_preset: true },
      ])
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined);

    await expect(getVoiceInputConfig()).resolves.toEqual(
      expect.objectContaining({ enabled: true }),
    );
    await expect(saveVoiceInputConfig(config)).resolves.toBeUndefined();
    await expect(getVoiceInstructions()).resolves.toEqual([
      expect.objectContaining({ id: "inst-1" }),
    ]);
    await expect(
      saveVoiceInstruction({
        id: "inst-2",
        name: "润色",
        prompt: "请优化",
        is_preset: false,
      }),
    ).resolves.toBeUndefined();
    await expect(deleteVoiceInstruction("inst-2")).resolves.toBeUndefined();
  });

  it("应代理转写、润色、窗口与录音命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce({ text: "你好", provider: "openai" })
      .mockResolvedValueOnce({ text: "你好，世界", instruction_name: "润色" })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({
        audio_data: [1, 2],
        sample_rate: 16000,
        duration: 1,
      })
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce({ is_recording: false, volume: 0, duration: 0 })
      .mockResolvedValueOnce(undefined);

    await expect(
      transcribeAudio(new Uint8Array([1, 2, 3]), 16000, "cred-1"),
    ).resolves.toEqual(expect.objectContaining({ text: "你好" }));
    await expect(polishVoiceText("你好")).resolves.toEqual(
      expect.objectContaining({ instruction_name: "润色" }),
    );
    await expect(
      openVoiceWindow({
        target: "companion-pet",
      }),
    ).resolves.toBeUndefined();
    await expect(closeVoiceWindow()).resolves.toBeUndefined();
    await expect(outputVoiceText("hello", "type")).resolves.toBeUndefined();
    await expect(startRecording("default")).resolves.toBeUndefined();
    await expect(stopRecording()).resolves.toEqual(
      expect.objectContaining({ sample_rate: 16000 }),
    );
    await expect(cancelRecording()).resolves.toBeUndefined();
    await expect(getRecordingStatus()).resolves.toEqual(
      expect.objectContaining({ is_recording: false }),
    );
    await expect(openInputWithText("prefilled")).resolves.toBeUndefined();

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "transcribe_audio", {
      audioData: [1, 2, 3],
      sampleRate: 16000,
      credentialId: "cred-1",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "open_voice_window", {
      target: "companion-pet",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(6, "start_recording", {
      deviceId: "default",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(10, "open_input_with_text", {
      text: "prefilled",
    });
  });
});
