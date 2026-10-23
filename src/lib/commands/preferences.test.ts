import { afterEach, expect, it, vi } from "vitest";
import { observeCommandBindings } from "./preferences";
import { getRegisteredCommands, registerCommand } from "./registry";

const { getConfig, subscribe } = vi.hoisted(() => ({
  getConfig: vi.fn(),
  subscribe: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig,
  subscribeAppConfigChanged: subscribe,
  updateConfig: vi.fn(),
}));
let stop: (() => void) | undefined;
let release: (() => void) | undefined;
afterEach(() => {
  stop?.();
  release?.();
  stop = undefined;
  release = undefined;
  vi.resetAllMocks();
});
function mount() {
  let changed!: () => void;
  const unsubscribe = vi.fn();
  subscribe.mockImplementation((listener) => {
    changed = listener;
    return unsubscribe;
  });
  release = registerCommand({
    id: "search",
    titleKey: "search",
    section: "app",
    bindings: ["Control+F"],
    handler: vi.fn(),
  });
  stop = observeCommandBindings();
  return { changed: () => changed(), unsubscribe };
}
const config = (binding: string) => ({
  desktop: { "keyboard-shortcuts": { search: [binding] } },
});

it("较早配置读取迟到时不能覆盖更新的canonical投影", async () => {
  let first!: (value: unknown) => void;
  getConfig
    .mockReturnValueOnce(
      new Promise((resolve) => {
        first = resolve;
      }),
    )
    .mockResolvedValueOnce(config("Control+J"));
  const { changed } = mount();
  changed();
  await Promise.resolve();
  first(config("Control+K"));
  await Promise.resolve();
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+J"]);
});
it("读取失败保留有效键位，后续通知可重新加载", async () => {
  getConfig
    .mockResolvedValueOnce(config("Control+J"))
    .mockRejectedValueOnce(Error("unavailable"))
    .mockResolvedValueOnce(config("Control+K"));
  const { changed } = mount();
  await Promise.resolve();
  changed();
  await Promise.resolve();
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+J"]);
  changed();
  await Promise.resolve();
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+K"]);
});
it("卸载取消订阅，迟到读取不恢复已丢弃投影", async () => {
  let resolve!: (value: unknown) => void;
  getConfig.mockReturnValue(
    new Promise((done) => {
      resolve = done;
    }),
  );
  const { unsubscribe } = mount();
  stop!();
  resolve(config("Control+J"));
  await Promise.resolve();
  expect(unsubscribe).toHaveBeenCalledOnce();
  expect(getRegisteredCommands()[0].bindings).toEqual(["Control+F"]);
});
