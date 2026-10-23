import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import type { VoiceInputConfig } from "@/lib/api/asrProvider";
import { MicrophoneSettings } from "./MicrophoneSettings";
import { useMicrophoneDevices } from "./useMicrophoneDevices";
import { useVoiceSettings } from "./useVoiceSettings";
import {
  createVoiceInputConfig,
  createDeferred,
} from "./voiceSettingsTestFixtures";

const api = vi.hoisted(() => ({
  config: vi.fn(),
  voice: vi.fn(),
  save: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({ getConfig: api.config }));
vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: api.voice,
  saveVoiceInputConfig: api.save,
}));
vi.mock("@/hooks/useConfiguredProviders", () => ({
  useConfiguredProviders: () => ({ providers: [], loading: false }),
  findConfiguredProviderBySelection: () => null,
}));
let root: Root;
let container: HTMLDivElement;
let media: EventTarget & {
  enumerateDevices: ReturnType<typeof vi.fn>;
  getUserMedia: ReturnType<typeof vi.fn>;
};
let devices: ReturnType<typeof useMicrophoneDevices>;
let settings: ReturnType<typeof useVoiceSettings>;
function device(id: string, label = "") {
  return { deviceId: id, kind: "audioinput", label } as MediaDeviceInfo;
}
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function mount(
  kind: "devices" | "settings" | "view" = "devices",
  value?: string,
) {
  function Harness() {
    devices = useMicrophoneDevices();
    return null;
  }
  function SettingsHarness() {
    settings = useVoiceSettings();
    return (
      <MicrophoneSettings
        value={settings.voiceConfig?.selected_device_id}
        disabled={settings.saving}
        onChange={settings.handleMicrophoneChange}
      />
    );
  }
  act(() =>
    root.render(
      kind === "settings" ? (
        <SettingsHarness />
      ) : kind === "view" ? (
        <MicrophoneSettings
          value={value}
          disabled={false}
          onChange={() => undefined}
        />
      ) : (
        <Harness />
      ),
    ),
  );
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  await changeLimeLocale("en-US");
  media = Object.assign(new EventTarget(), {
    enumerateDevices: vi
      .fn()
      .mockResolvedValue([device("usb", "USB microphone")]),
    getUserMedia: vi.fn(),
  });
  vi.stubGlobal("navigator", { mediaDevices: media, platform: "MacIntel" });
  api.config.mockResolvedValue({});
  api.voice.mockResolvedValue(createVoiceInputConfig());
  api.save.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetAllMocks();
  await changeLimeLocale("zh-CN");
});

describe("microphone devices", () => {
  it("被动枚举只包含实际音频输入，不请求权限", async () => {
    media.enumerateDevices.mockResolvedValue([
      device("default"),
      device(""),
      device("usb"),
      { ...device("speaker"), kind: "audiooutput" },
    ]);
    mount();
    await settle();
    expect(devices.devices.map((d) => d.deviceId)).toEqual(["usb"]);
    expect(media.getUserMedia).not.toHaveBeenCalled();
    expect(devices.loading).toBe(false);
  });
  it("显式刷新释放全部音轨后更新设备名称", async () => {
    const stopA = vi.fn();
    const stopB = vi.fn();
    media.getUserMedia.mockResolvedValue({
      getTracks: () => [{ stop: stopA }, { stop: stopB }],
    });
    mount();
    await settle();
    media.enumerateDevices.mockImplementation(async () => {
      expect(stopA).toHaveBeenCalledOnce();
      expect(stopB).toHaveBeenCalledOnce();
      return [device("usb", "Named microphone")];
    });
    await act(async () => devices.refresh());
    expect(devices.devices[0].label).toBe("Named microphone");
    expect(media.getUserMedia).toHaveBeenCalledWith({ audio: true });
  });
  it("刷新权限迟到且已卸载时仍释放音轨，不再枚举", async () => {
    const pending = createDeferred<MediaStream>();
    const stop = vi.fn();
    media.getUserMedia.mockReturnValue(pending.promise);
    mount();
    await settle();
    let operation!: Promise<void>;
    act(() => {
      operation = devices.refresh();
    });
    act(() => root.render(null));
    pending.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await operation;
    expect(stop).toHaveBeenCalledOnce();
    expect(media.enumerateDevices).toHaveBeenCalledOnce();
  });
  it("权限失败可重试，默认设备列表保持上次成功值", async () => {
    media.getUserMedia
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue({ getTracks: () => [] });
    mount();
    await settle();
    await act(async () => devices.refresh());
    expect(devices.error).toBe("permission");
    expect(devices.loading).toBe(false);
    expect(devices.devices[0].deviceId).toBe("usb");
    await act(async () => devices.refresh());
    expect(devices.error).toBeNull();
    expect(devices.loading).toBe(false);
  });
  it("权限拒绝后页面刷新按钮恢复可用，用户可直接重试", async () => {
    media.getUserMedia
      .mockRejectedValueOnce(new Error("denied"))
      .mockResolvedValue({ getTracks: () => [] });
    mount("view");
    await settle();
    const refresh = container.querySelector(
      'button[aria-label="Allow microphone access and refresh devices"]',
    ) as HTMLButtonElement;
    await act(async () => {
      refresh.click();
    });
    await settle();
    expect(refresh.disabled).toBe(false);
    expect(container.querySelector('[role="alert"]')?.textContent).toContain(
      "Check system permissions",
    );
    await act(async () => {
      refresh.click();
    });
    await settle();
    expect(media.getUserMedia).toHaveBeenCalledTimes(2);
    expect(refresh.disabled).toBe(false);
  });
  it("设备事件的迟到旧枚举不覆盖新列表，卸载移除监听", async () => {
    const pending = createDeferred<MediaDeviceInfo[]>();
    media.enumerateDevices.mockReturnValueOnce(pending.promise);
    const remove = vi.spyOn(media, "removeEventListener");
    mount();
    act(() => {
      media.dispatchEvent(new Event("devicechange"));
    });
    await settle();
    pending.resolve([device("stale")]);
    await settle();
    expect(devices.devices.map((d) => d.deviceId)).toEqual(["usb"]);
    act(() => root.render(null));
    expect(remove).toHaveBeenCalledWith("devicechange", expect.any(Function));
  });
  it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
    "五语 %s 提供无标签设备及失联选择的可访问文案",
    async (locale) => {
      await changeLimeLocale(locale);
      media.enumerateDevices.mockResolvedValue([device("usb")]);
      mount("view", "removed");
      await settle();
      const trigger = container.querySelector(
        "button[aria-haspopup=menu]",
      ) as HTMLButtonElement;
      expect(trigger).not.toBeNull();
      expect(trigger.textContent).not.toContain("settings.voice.");
      expect(trigger.textContent?.trim().length).toBeGreaterThan(0);
      expect(container.textContent).not.toContain("settings.voice.");
      expect(media.getUserMedia).not.toHaveBeenCalled();
    },
  );
});

describe("voice preference persistence", () => {
  it("同步互斥防止快速选择覆盖写入，保存失败保留已确认值并允许重试", async () => {
    const save = createDeferred<void>();
    api.save.mockReturnValueOnce(save.promise);
    mount("settings");
    await settle();
    act(() => {
      settings.handleMicrophoneChange("usb");
      settings.handleSoundsEnabledChange(false);
    });
    await settle();
    expect(api.save).toHaveBeenCalledTimes(1);
    expect(settings.saving).toBe(true);
    expect(settings.voiceConfig?.selected_device_id).toBeUndefined();
    expect(
      (
        container.querySelector(
          "button[aria-haspopup=menu]",
        ) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    save.reject(new Error("write failed"));
    await settle();
    expect(settings.saving).toBe(false);
    expect(settings.voiceConfig?.selected_device_id).toBeUndefined();
    expect(settings.message?.type).toBe("error");
    act(() => settings.handleMicrophoneChange("usb"));
    await settle();
    expect(settings.voiceConfig?.selected_device_id).toBe("usb");
    expect(api.save).toHaveBeenCalledTimes(2);
  });
  it("保存读取最新配置，保留其他 owner 更新的指令；默认清除设备 override", async () => {
    mount("settings");
    await settle();
    const latest = createVoiceInputConfig({
      selected_device_id: "usb",
      instructions: [
        { id: "new", name: "new", prompt: "{{text}}", is_preset: false },
      ],
    });
    api.voice.mockResolvedValueOnce(latest);
    act(() => settings.handleMicrophoneChange(""));
    await settle();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        selected_device_id: undefined,
        instructions: latest.instructions,
      }),
    );
  });
  it("词典保存期间阻止其他配置写入，结束后恢复", async () => {
    const pending = createDeferred<void>();
    api.save.mockReturnValueOnce(pending.promise);
    mount("settings");
    await settle();
    let operation!: Promise<boolean>;
    act(() => {
      operation = settings.handleDictionarySave(["Lime"]);
      settings.handleMicrophoneChange("usb");
    });
    await settle();
    expect(api.save).toHaveBeenCalledOnce();
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ dictation_dictionary: ["Lime"] }),
    );
    expect(settings.saving).toBe(true);
    pending.resolve();
    await act(async () => expect(await operation).toBe(true));
    await settle();
    api.voice.mockResolvedValue(
      createVoiceInputConfig({ dictation_dictionary: ["Lime"] }),
    );
    act(() => {
      settings.handleMicrophoneChange("usb");
    });
    await settle();
    expect(api.save).toHaveBeenCalledTimes(2);
    expect(api.save).toHaveBeenLastCalledWith(
      expect.objectContaining({
        dictation_dictionary: ["Lime"],
        selected_device_id: "usb",
      }),
    );
  });
  it.each(
    [true, false].flatMap((cleanupEnabled) =>
      ["sounds", "microphone", "dictionary", "provider", "model"].map(
        (field) => ({ field, cleanupEnabled }),
      ),
    ),
  )(
    "$field 只改对应字段，保留 cleanup=$cleanupEnabled 和指令配置",
    async ({ field, cleanupEnabled }) => {
      const initial = createVoiceInputConfig({
        processor: {
          polish_enabled: cleanupEnabled,
          default_instruction_id: "unavailable-default",
        },
        translate_instruction_id: "unavailable-translation",
      });
      api.voice.mockResolvedValue(initial);
      mount("settings");
      await settle();
      expect(settings.voiceConfig).toEqual(initial);
      expect(api.save).not.toHaveBeenCalled();
      const latest = createVoiceInputConfig({
        ...initial,
        instructions: [
          { id: "other", name: "Other", prompt: "{{text}}", is_preset: false },
        ],
      });
      api.voice.mockResolvedValue(latest);
      let expected: VoiceInputConfig = latest;
      act(() => {
        if (field === "sounds") {
          settings.handleSoundsEnabledChange(false);
          expected = { ...latest, sound_enabled: false };
        } else if (field === "microphone") {
          settings.handleMicrophoneChange("usb");
          expected = { ...latest, selected_device_id: "usb" };
        } else if (field === "dictionary") {
          void settings.handleDictionarySave(["Lime"]);
          expected = { ...latest, dictation_dictionary: ["Lime"] };
        } else if (field === "provider") {
          settings.handlePolishProviderChange("custom-provider");
          expected = {
            ...latest,
            processor: {
              ...latest.processor,
              polish_provider: "custom-provider",
              polish_model: undefined,
            },
          };
        } else {
          settings.handlePolishModelChange("custom-model");
          expected = {
            ...latest,
            processor: { ...latest.processor, polish_model: "custom-model" },
          };
        }
      });
      await settle();
      expect(api.save).toHaveBeenCalledOnce();
      expect(api.save).toHaveBeenCalledWith(expected);
      expect(settings.voiceConfig).toEqual(expected);
    },
  );
  it("配置加载失败保留明确终态，可重试读回", async () => {
    api.voice.mockRejectedValueOnce(new Error("unavailable"));
    mount("settings");
    await settle();
    expect(settings.loadError).toBe(true);
    await act(async () => settings.reload());
    expect(settings.loadError).toBe(false);
    expect(settings.voiceConfig).not.toBeNull();
  });
});
