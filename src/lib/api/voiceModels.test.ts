import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { safeInvoke } from "@/lib/dev-bridge";
import { resolveOemCloudRuntimeContext } from "./oemCloudRuntime";
import {
  deleteVoiceModel,
  downloadVoiceModel,
  getVoiceModelInstallState,
  listVoiceModelCatalog,
  setDefaultVoiceModel,
  testTranscribeVoiceModelFile,
} from "./voiceModels";

vi.mock("@/lib/dev-bridge", () => ({
  safeInvoke: vi.fn(),
}));

vi.mock("./oemCloudRuntime", () => ({
  resolveOemCloudRuntimeContext: vi.fn(),
}));

describe("voiceModels API", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveOemCloudRuntimeContext).mockReturnValue(null);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("应代理本地语音模型管理命令", async () => {
    vi.mocked(safeInvoke)
      .mockResolvedValueOnce([{ id: "sensevoice-small-int8-2024-07-17" }])
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce({ state: { installed: true } })
      .mockResolvedValueOnce({ installed: false })
      .mockResolvedValueOnce({ id: "sensevoice-local", is_default: true })
      .mockResolvedValueOnce({
        text: "这是一段测试转写结果。",
        duration_secs: 3.2,
        sample_rate: 16000,
        language: "auto",
      });

    await expect(listVoiceModelCatalog()).resolves.toEqual([
      expect.objectContaining({ id: "sensevoice-small-int8-2024-07-17" }),
    ]);
    await expect(
      getVoiceModelInstallState("sensevoice-small-int8-2024-07-17"),
    ).resolves.toEqual(expect.objectContaining({ installed: false }));
    await expect(
      downloadVoiceModel("sensevoice-small-int8-2024-07-17"),
    ).resolves.toEqual(expect.objectContaining({ state: { installed: true } }));
    await expect(
      deleteVoiceModel("sensevoice-small-int8-2024-07-17"),
    ).resolves.toEqual(expect.objectContaining({ installed: false }));
    await expect(
      setDefaultVoiceModel("sensevoice-small-int8-2024-07-17"),
    ).resolves.toEqual(expect.objectContaining({ is_default: true }));
    await expect(
      testTranscribeVoiceModelFile(
        "sensevoice-small-int8-2024-07-17",
        "/tmp/interview.wav",
      ),
    ).resolves.toEqual(
      expect.objectContaining({ text: "这是一段测试转写结果。" }),
    );

    expect(safeInvoke).toHaveBeenNthCalledWith(1, "voice_models_list_catalog");
    expect(safeInvoke).toHaveBeenNthCalledWith(
      2,
      "voice_models_get_install_state",
      { modelId: "sensevoice-small-int8-2024-07-17" },
    );
    expect(safeInvoke).toHaveBeenNthCalledWith(3, "voice_models_download", {
      modelId: "sensevoice-small-int8-2024-07-17",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(4, "voice_models_delete", {
      modelId: "sensevoice-small-int8-2024-07-17",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(5, "voice_models_set_default", {
      modelId: "sensevoice-small-int8-2024-07-17",
    });
    expect(safeInvoke).toHaveBeenNthCalledWith(
      6,
      "voice_models_test_transcribe_file",
      {
        modelId: "sensevoice-small-int8-2024-07-17",
        filePath: "/tmp/interview.wav",
      },
    );
  });

  it("应优先使用 limecore 下发的语音模型目录并传给下载命令", async () => {
    vi.mocked(resolveOemCloudRuntimeContext).mockReturnValue({
      baseUrl: "https://cloud.example.com",
      controlPlaneBaseUrl: "https://cloud.example.com/api",
      sceneBaseUrl: "https://cloud.example.com/scene-api",
      gatewayBaseUrl: "https://cloud.example.com/gateway-api",
      tenantId: "tenant-0001",
      sessionToken: null,
      hubProviderName: null,
      loginPath: "/login",
      desktopClientId: "desktop-client",
      desktopOauthRedirectUrl: "lime://oauth/callback",
      desktopOauthNextPath: "/welcome",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        code: 200,
        message: "success",
        data: {
          items: [
            {
              id: "sensevoice-small-int8-2024-07-17",
              name: "SenseVoice Small INT8",
              provider: "FunAudioLLM / sherpa-onnx",
              description: "后端下发的离线语音模型",
              version: "2024-07-17",
              languages: ["zh", "en"],
              runtime: "sherpa-onnx",
              bundled: false,
              sizeBytes: 262144000,
              download: {
                archive: {
                  downloadUrl:
                    "https://models.example.com/voice/sensevoice.tar.bz2",
                  sha256: "abc123",
                },
                vad: {
                  modelId: "silero-vad-onnx",
                  downloadUrl:
                    "https://models.example.com/voice/silero_vad.onnx",
                },
              },
            },
          ],
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.mocked(safeInvoke).mockResolvedValueOnce({
      state: { installed: true },
    });

    await expect(
      downloadVoiceModel("sensevoice-small-int8-2024-07-17"),
    ).resolves.toEqual(expect.objectContaining({ state: { installed: true } }));

    expect(fetchMock).toHaveBeenCalledWith(
      "https://cloud.example.com/api/v1/public/tenants/tenant-0001/client/voice-model-catalog",
      {
        headers: {
          Accept: "application/json",
        },
      },
    );
    expect(safeInvoke).toHaveBeenCalledWith("voice_models_download", {
      modelId: "sensevoice-small-int8-2024-07-17",
      catalogEntry: expect.objectContaining({
        id: "sensevoice-small-int8-2024-07-17",
        download_url: "https://models.example.com/voice/sensevoice.tar.bz2",
        vad_download_url: "https://models.example.com/voice/silero_vad.onnx",
        checksum_sha256: "abc123",
      }),
    });
  });
});
