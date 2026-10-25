import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { DictationDictionary } from "./DictationDictionary";
import { useVoiceSettings } from "./useVoiceSettings";
import {
  createDeferred,
  createVoiceInputConfig,
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

let container: HTMLDivElement;
let root: Root;
const inputs = () => [...container.querySelectorAll("input")];
const buttons = () => [...container.querySelectorAll("button")];
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
}
function edit(input: HTMLInputElement, text: string) {
  act(() => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function blur(input: HTMLInputElement) {
  act(() => {
    input.focus();
    input.blur();
  });
}
function enter(input: HTMLInputElement, isComposing = false) {
  act(() =>
    input.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        isComposing,
      }),
    ),
  );
}
function render(
  value: string[] = [],
  onSave = vi.fn().mockResolvedValue(true),
  disabled = false,
  cleanupEnabled = true,
) {
  act(() =>
    root.render(
      <DictationDictionary
        value={value}
        onSave={onSave}
        disabled={disabled}
        cleanupEnabled={cleanupEnabled}
      />,
    ),
  );
  return onSave;
}
beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  await changeLimeLocale("en-US");
  api.config.mockResolvedValue({});
  api.voice.mockResolvedValue(createVoiceInputConfig());
  api.save.mockResolvedValue(undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("dictation dictionary editing", () => {
  it("keeps one accessible empty row without saving empty entries", async () => {
    const save = render();
    expect(inputs()).toHaveLength(1);
    expect(inputs()[0].getAttribute("aria-label")).toBe("Dictionary entry 1");
    expect(buttons()[1].disabled).toBe(true);
    blur(inputs()[0]);
    await settle();
    expect(save).not.toHaveBeenCalled();
  });
  it("adds after the current row with Enter, preserves IME confirmation and saves canonical spelling on blur", async () => {
    const save = render();
    act(() => inputs()[0].focus());
    edit(inputs()[0], "  OpenAI  ");
    enter(inputs()[0], true);
    expect(inputs()).toHaveLength(1);
    enter(inputs()[0]);
    expect(inputs()).toHaveLength(2);
    expect(document.activeElement).toBe(inputs()[1]);
    expect(save).not.toHaveBeenCalled();
    edit(inputs()[1], " src/App.tsx ");
    blur(inputs()[1]);
    await settle();
    expect(save).toHaveBeenCalledExactlyOnceWith(["OpenAI", "src/App.tsx"]);
    expect(inputs().map((input) => input.value)).toEqual([
      "OpenAI",
      "src/App.tsx",
    ]);
  });
  it("queues a newer blurred edit while a save is pending without overwriting it", async () => {
    const first = createDeferred<boolean>();
    const save = vi
      .fn()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(true);
    render([], save);
    edit(inputs()[0], "OpenAI");
    blur(inputs()[0]);
    edit(inputs()[0], "Lime Desktop");
    blur(inputs()[0]);
    expect(save).toHaveBeenCalledTimes(1);
    expect(inputs()[0].disabled).toBe(false);
    await act(async () => first.resolve(true));
    await settle();
    expect(save.mock.calls.map(([entries]) => entries)).toEqual([
      ["OpenAI"],
      ["Lime Desktop"],
    ]);
    expect(inputs()[0].value).toBe("Lime Desktop");
  });
  it("retains a failed draft and retries the latest edit once", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValue(true);
    render([], save);
    edit(inputs()[0], "Lime::RuntimeCore");
    blur(inputs()[0]);
    await settle();
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(inputs()[0].value).toBe("Lime::RuntimeCore");
    edit(inputs()[0], "RuntimeCore::start");
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[role="alert"] button')!
        .click(),
    );
    await settle();
    expect(save).toHaveBeenLastCalledWith(["RuntimeCore::start"]);
    expect(save).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("removes an entry without stealing focus from the next stable row", async () => {
    const save = render(["OpenAI", "src/App.tsx", "RuntimeCore"]);
    const active = inputs()[1];
    act(() => active.focus());
    act(() => buttons()[1].click());
    await settle();
    expect(save).toHaveBeenCalledWith(["src/App.tsx", "RuntimeCore"]);
    expect(document.activeElement).toBe(active);
    expect(inputs()[0]).toBe(active);
  });
  it("caps the editable list at the 100 entries consumed by cleanup", () => {
    render(Array.from({ length: 100 }, (_, i) => `Entry ${i}`));
    expect(buttons()[0].disabled).toBe(true);
    enter(inputs()[99]);
    expect(inputs()).toHaveLength(100);
    expect(container.textContent).toContain("100");
  });
  it("restores adjacent input focus when deletion is activated from its keyboard button", async () => {
    const save = render(["OpenAI", "src/App.tsx"]);
    const next = inputs()[1];
    act(() => {
      buttons()[1].focus();
      buttons()[1].click();
    });
    await settle();
    expect(save).toHaveBeenCalledExactlyOnceWith(["src/App.tsx"]);
    expect(document.activeElement).toBe(next);
  });
  it("interlocks external writes and explains when cleanup is disabled", () => {
    const save = render(["OpenAI"], undefined, true, false);
    expect(inputs()[0].disabled).toBe(true);
    expect(buttons().every((button) => button.disabled)).toBe(true);
    expect(container.textContent).toContain(
      "The current dictation processing mode does not use the dictionary.",
    );
    expect(save).not.toHaveBeenCalled();
  });
  it("does not continue queued writes after unmount", async () => {
    const first = createDeferred<boolean>();
    const save = vi.fn().mockReturnValue(first.promise);
    render([], save);
    edit(inputs()[0], "first");
    blur(inputs()[0]);
    edit(inputs()[0], "second");
    blur(inputs()[0]);
    act(() => root.render(null));
    await act(async () => first.resolve(true));
    expect(save).toHaveBeenCalledTimes(1);
  });
  it.each([
    ["zh-CN", "添加条目", "词典条目 1"],
    ["zh-TW", "新增條目", "詞典條目 1"],
    ["en-US", "Add entry", "Dictionary entry 1"],
    ["ja-JP", "項目を追加", "辞書項目 1"],
    ["ko-KR", "항목 추가", "사전 항목 1"],
  ])(
    "exposes localized keyboard controls in %s",
    async (locale, add, entry) => {
      await changeLimeLocale(locale);
      render();
      expect(buttons()[0].textContent).toBe(add);
      act(() => buttons()[0].click());
      expect(inputs()).toHaveLength(2);
      expect(inputs()[0].getAttribute("aria-label")).toBe(entry);
      expect(document.activeElement).toBe(inputs()[1]);
      expect(container.textContent).not.toContain("settings.voice.");
    },
  );
});

it("saves through the latest shared config and preserves other voice fields", async () => {
  const initial = createVoiceInputConfig();
  const latest = createVoiceInputConfig({
    selected_device_id: "usb",
    sound_enabled: false,
  });
  api.voice.mockResolvedValueOnce(initial).mockResolvedValue(latest);
  function Harness() {
    const s = useVoiceSettings();
    if (s.loading) return null;
    return (
      <DictationDictionary
        value={s.voiceConfig?.dictation_dictionary ?? []}
        onSave={s.handleDictionarySave}
        disabled={s.saving}
        cleanupEnabled
      />
    );
  }
  act(() => root.render(<Harness />));
  await settle();
  edit(inputs()[0], " OpenAI ");
  blur(inputs()[0]);
  await settle();
  expect(api.save).toHaveBeenCalledExactlyOnceWith({
    ...latest,
    dictation_dictionary: ["OpenAI"],
  });
});
