import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ComposerController } from "@/components/input-kit";
import { InputbarCore } from "./InputbarCore";
import { buildInputbarCoreCopy } from "./inputbarCoreCopy";
import {
  createContextualSuggestionsFixture,
  stubSuggestionGeometry,
} from "./contextualSuggestions.testFixtures";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  changed: null as (() => void) | null,
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.getConfig,
  subscribeAppConfigChanged: (listener: () => void) => {
    api.changed = listener;
    return () => {
      api.changed = null;
    };
  },
}));
vi.mock("@/lib/api/asrProvider", () => ({
  getVoiceInputConfig: async () => ({}),
}));
let root: Root;
let container: HTMLDivElement;
let controller: ComposerController;
const onSend = vi.fn();
const settle = async () =>
  act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
const press = (
  options: NonNullable<ConstructorParameters<typeof KeyboardEvent>[1]> = {},
) =>
  act(() => {
    container.querySelector('[data-testid="composer-editor"]')!.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "Enter",
        bubbles: true,
        cancelable: true,
        ...options,
      }),
    );
  });
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  stubSuggestionGeometry();
  vi.spyOn(navigator, "platform", "get").mockReturnValue("Win32");
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Windows");
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  controller = new ComposerController({ text: "prompt" });
  api.getConfig.mockResolvedValue({ desktop: {} });
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
async function mount() {
  act(() =>
    root.render(
      <InputbarCore
        uiCopy={buildInputbarCoreCopy((key) => key)}
        text="prompt"
        setText={vi.fn()}
        onSend={onSend}
        onToolClick={vi.fn()}
        controller={controller}
        contextualSuggestions={createContextualSuggestionsFixture()}
      />,
    ),
  );
  await settle();
}

it("真实输入框读取三态偏好，并在配置事件后应用新值", async () => {
  api.getConfig.mockResolvedValue({
    desktop: { composerEnterBehavior: "cmdAlways" },
  });
  await mount();
  press();
  expect(onSend).not.toHaveBeenCalled();
  expect(controller.getDocument().text).toContain("\n");
  press({ ctrlKey: true });
  expect(onSend).toHaveBeenCalledTimes(1);
  api.getConfig.mockResolvedValue({
    desktop: { composerEnterBehavior: "enter" },
  });
  act(() => api.changed?.());
  await settle();
  press();
  expect(onSend).toHaveBeenCalledTimes(2);
});

it.each(["pending", "failed"])(
  "%s 的偏好读取不会以默认 Enter 误发送，显式按钮仍可用",
  async (state) => {
    if (state === "pending")
      api.getConfig.mockReturnValue(new Promise(() => {}));
    else api.getConfig.mockRejectedValue(new Error("config unavailable"));
    await mount();
    press();
    press({ ctrlKey: true });
    expect(onSend).not.toHaveBeenCalled();
    act(() =>
      container
        .querySelector<HTMLButtonElement>('[data-testid="send-btn"]')!
        .click(),
    );
    expect(onSend).toHaveBeenCalledTimes(1);
  },
);

it("缺省偏好按 Enter 发送；IME 保留优先消费权", async () => {
  await mount();
  press({ isComposing: true });
  expect(onSend).not.toHaveBeenCalled();
  press();
  expect(onSend).toHaveBeenCalledTimes(1);
});
