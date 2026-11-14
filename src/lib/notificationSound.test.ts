import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CUSTOM_NOTIFICATION_SOUND_MAX_BYTES,
  CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY,
  clearCustomNotificationSound,
  importCustomNotificationSound,
  playCustomNotificationSound,
  readCustomNotificationSound,
  resolveNotificationSound,
} from "./notificationSound";

const mocks = vi.hoisted(() => ({
  pickFiles: vi.fn(),
  readFile: vi.fn(),
}));

vi.mock("@/lib/api/filePicker", () => ({
  pickFilesFromDialog: mocks.pickFiles,
}));

vi.mock("@/lib/api/appServer", () => ({
  AppServerClient: class {
    readFile = mocks.readFile;
  },
}));

function saveStoredSound(overrides: Record<string, unknown> = {}) {
  window.localStorage.setItem(
    CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY,
    JSON.stringify({
      name: "chime.wav",
      mime: "audio/wav",
      dataBase64: btoa("abc"),
      bytes: 3,
      ...overrides,
    }),
  );
}

describe("notificationSound", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.clearAllMocks();
  });

  it("读写并校验自定义提示音，拒绝非法记录", () => {
    saveStoredSound();
    expect(readCustomNotificationSound()).toMatchObject({
      name: "chime.wav",
      bytes: 3,
    });
    window.localStorage.setItem(
      CUSTOM_NOTIFICATION_SOUND_STORAGE_KEY,
      JSON.stringify({ name: "", dataBase64: "", bytes: 0 }),
    );
    expect(readCustomNotificationSound()).toBeNull();
    saveStoredSound({ bytes: CUSTOM_NOTIFICATION_SOUND_MAX_BYTES + 1 });
    expect(readCustomNotificationSound()).toBeNull();
    clearCustomNotificationSound();
    expect(readCustomNotificationSound()).toBeNull();
  });

  it("导入音频文件并保存到本地存储", async () => {
    mocks.pickFiles.mockResolvedValue([
      { label: "chime.wav", path: "/tmp/chime.wav", fsPath: "/tmp/chime.wav" },
    ]);
    mocks.readFile.mockResolvedValue({ result: { dataBase64: btoa("abcd") } });
    await expect(importCustomNotificationSound()).resolves.toMatchObject({
      name: "chime.wav",
      mime: "audio/wav",
      bytes: 4,
    });
    expect(readCustomNotificationSound()?.dataBase64).toBe(btoa("abcd"));
  });

  it("取消选择返回 null，超大文件或不支持的扩展名报错", async () => {
    mocks.pickFiles.mockResolvedValueOnce([]);
    await expect(importCustomNotificationSound()).resolves.toBeNull();

    mocks.pickFiles.mockResolvedValueOnce([
      { label: "chime.exe", path: "/tmp/chime.exe", fsPath: "/tmp/chime.exe" },
    ]);
    await expect(importCustomNotificationSound()).rejects.toThrow(
      "unsupported_audio_extension",
    );

    mocks.pickFiles.mockResolvedValueOnce([
      { label: "big.wav", path: "/tmp/big.wav", fsPath: "/tmp/big.wav" },
    ]);
    mocks.readFile.mockResolvedValueOnce({
      result: {
        dataBase64: "A".repeat(
          Math.ceil(((CUSTOM_NOTIFICATION_SOUND_MAX_BYTES + 3) * 4) / 3),
        ),
      },
    });
    await expect(importCustomNotificationSound()).rejects.toThrow(
      "audio_too_large",
    );
  });

  it("自定义音效缺失时回退默认提示音", () => {
    expect(resolveNotificationSound("custom")).toEqual({
      playCustom: false,
      playClassic: false,
      request: {},
    });
    saveStoredSound();
    expect(resolveNotificationSound("custom")).toEqual({
      playCustom: true,
      playClassic: false,
      request: { silent: true },
    });
    expect(resolveNotificationSound("Ping")).toEqual({
      playCustom: false,
      playClassic: false,
      request: { sound: "Ping" },
    });
    expect(resolveNotificationSound("classic")).toEqual({
      playCustom: false,
      playClassic: true,
      request: { silent: true },
    });
  });

  it("播放已保存的自定义提示音", () => {
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    const created: string[] = [];
    class AudioMock {
      constructor(src: string) {
        created.push(src);
      }
      play = play;
      pause = pause;
    }
    vi.stubGlobal("Audio", AudioMock);
    saveStoredSound();

    expect(playCustomNotificationSound()).toBe(true);
    expect(created[0]).toContain("data:audio/wav;base64,");
    expect(play).toHaveBeenCalledOnce();

    clearCustomNotificationSound();
    expect(playCustomNotificationSound()).toBe(false);
    vi.unstubAllGlobals();
  });
});
