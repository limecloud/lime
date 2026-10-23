import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { MemorySettings } from ".";

const api = vi.hoisted(() => ({
  getConfig: vi.fn(),
  updateConfig: vi.fn(),
  resetMemory: vi.fn(),
  readInstructions: vi.fn(),
  writeInstructions: vi.fn(),
}));
vi.mock("@/lib/api/appConfig", () => ({
  getConfig: api.getConfig,
  updateConfig: api.updateConfig,
  subscribeAppConfigChanged: () => () => {},
}));
vi.mock("@/lib/api/memoryStore", () => ({ resetMemory: api.resetMemory }));
vi.mock("@/lib/api/instructions", () => ({
  readInstructions: api.readInstructions,
  writeInstructions: api.writeInstructions,
}));
let root: Root;
let container: HTMLDivElement;
let config: { memory: Record<string, unknown>; language: string };
const button = (text: string) =>
  [...document.querySelectorAll("button")].find(
    (node) => node.textContent === text,
  )!;
const click = async (node: HTMLElement) => act(async () => node.click());
const mount = async () => act(async () => root.render(<MemorySettings />));
const switches = () => [
  ...container.querySelectorAll<HTMLButtonElement>('[role="switch"]'),
];
const editor = () => container.querySelector<HTMLTextAreaElement>("textarea")!;
async function edit(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )!.set!.call(editor(), value);
    editor().dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  vi.resetAllMocks();
  config = {
    language: "ja-JP",
    memory: {
      enabled: true,
      auto: { enabled: true },
      profile: { strengths: ["code"] },
    },
  };
  api.getConfig.mockImplementation(async () => config);
  api.updateConfig.mockImplementation(
    async (update) => (config = update(config)),
  );
  api.resetMemory.mockResolvedValue({});
  api.readInstructions.mockResolvedValue({
    path: "/fixture/AGENTS.md",
    contents: "original",
    revision: "v1",
    hasOverride: false,
  });
  api.writeInstructions.mockImplementation(async (contents: string) => ({
    path: "/fixture/AGENTS.md",
    contents,
    revision: "v2",
    hasOverride: false,
  }));
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
it("projects two switches and instructions without the old dashboard", async () => {
  await mount();
  expect(switches()).toHaveLength(2);
  expect(container.querySelector('[role="tablist"]')).toBeNull();
  expect(container.textContent).toContain("Custom instructions");
  expect([...container.querySelectorAll("a")].map((link) => link.href)).toEqual(
    [
      "https://developers.openai.com/codex/memories",
      "https://developers.openai.com/codex/guides/agents-md",
    ],
  );
  expect(api.readInstructions).not.toHaveBeenCalled();
});
it("saves use and generation together, preserving unrelated preferences", async () => {
  await mount();
  await click(switches()[0]);
  expect(config.memory).toEqual({
    enabled: false,
    auto: { enabled: false },
    profile: { strengths: ["code"] },
  });
  expect(config.language).toBe("ja-JP");
  expect(switches()[1].disabled).toBe(false);
  await click(switches()[1]);
  expect(config.memory.disable_on_external_context).toBe(true);
  expect(config.memory.enabled).toBe(false);
  expect(config.memory.auto).toEqual({ enabled: false });
  await click(switches()[0]);
  expect(config.memory.auto).toEqual({ enabled: true });
});
it("keeps effective settings on failed saves and permits retry", async () => {
  api.updateConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  await click(switches()[0]);
  expect(switches()[0].getAttribute("aria-checked")).toBe("true");
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await click(switches()[0]);
  expect(switches()[0].getAttribute("aria-checked")).toBe("false");
});
it("load failures disable edits and can be retried", async () => {
  api.getConfig.mockRejectedValueOnce(new Error("offline"));
  await mount();
  expect(switches()[0].disabled).toBe(true);
  await click(button("Try again"));
  expect(switches()[0].disabled).toBe(false);
});
it("requires confirmation to delete and keeps the dialog on failure", async () => {
  await mount();
  await click(button("Delete"));
  expect(api.resetMemory).not.toHaveBeenCalled();
  await click(button("Cancel"));
  expect(api.resetMemory).not.toHaveBeenCalled();
  await click(button("Delete"));
  api.resetMemory.mockRejectedValueOnce(new Error("busy"));
  await click(button("Delete all memories"));
  expect(
    document.querySelector('[role="alertdialog"] [role="alert"]'),
  ).not.toBeNull();
  await click(button("Delete all memories"));
  expect(document.querySelector('[role="alertdialog"]')).toBeNull();
  expect(container.textContent).toContain("Memories deleted.");
});
it("edits actual instructions with a revision and supports primary-S", async () => {
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("new instructions");
  await act(async () =>
    editor().dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", metaKey: true, bubbles: true }),
    ),
  );
  expect(api.writeInstructions).toHaveBeenCalledWith("new instructions", "v1");
  expect(container.textContent).toContain("Saved");
  await click(button("Back"));
  expect(document.activeElement).toBe(
    container.querySelector('[aria-label="Edit instructions"]'),
  );
});
it("protects dirty back navigation and preserves text on keep editing", async () => {
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("dirty");
  await click(button("Back"));
  expect(document.querySelector('[role="alertdialog"]')).not.toBeNull();
  await click(button("Keep editing"));
  expect(editor().value).toBe("dirty");
  await click(button("Back"));
  await click(button("Discard changes"));
  expect(container.querySelector("textarea")).toBeNull();
  expect(api.writeInstructions).not.toHaveBeenCalled();
});
it("conflicts preserve edits and reload only after discard confirmation", async () => {
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("dirty");
  api.writeInstructions.mockRejectedValueOnce(new Error("conflict"));
  await click(button("Save"));
  expect(editor().value).toBe("dirty");
  api.readInstructions.mockResolvedValue({
    path: "/fixture/AGENTS.md",
    contents: "external",
    revision: "v3",
    hasOverride: true,
  });
  await click(button("Reload"));
  await click(button("Keep editing"));
  expect(editor().value).toBe("dirty");
  await click(button("Reload"));
  await click(button("Discard changes"));
  expect(editor().value).toBe("external");
  expect(container.textContent).toContain("AGENTS.override.md");
});
it("retains edits made during saving and rejects a duplicate save", async () => {
  let resolve!: (value: unknown) => void;
  api.writeInstructions.mockReturnValueOnce(
    new Promise((done) => {
      resolve = done;
    }),
  );
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("submitted");
  await click(button("Save"));
  await edit("newer");
  await act(async () =>
    editor().dispatchEvent(
      new KeyboardEvent("keydown", { key: "s", ctrlKey: true, bubbles: true }),
    ),
  );
  expect(api.writeInstructions).toHaveBeenCalledTimes(1);
  await act(async () =>
    resolve({
      path: "/fixture/AGENTS.md",
      contents: "submitted",
      revision: "v2",
      hasOverride: false,
    }),
  );
  expect(editor().value).toBe("newer");
  expect(button("Save").disabled).toBe(false);
});
it("limits instruction bytes rather than characters", async () => {
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  await edit("界".repeat(11000));
  expect(button("Save").disabled).toBe(true);
  expect(api.writeInstructions).not.toHaveBeenCalled();
});
it("instruction loading can be retried without losing the page", async () => {
  api.readInstructions.mockRejectedValueOnce(new Error("permission"));
  await mount();
  await click(container.querySelector('[aria-label="Edit instructions"]')!);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  await click(button("Reload"));
  expect(editor().value).toBe("original");
});
it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"])(
  "%s renders translated personalization controls",
  async (locale) => {
    await changeLimeLocale(locale);
    await mount();
    expect(container.textContent).not.toContain("settings.personalization.");
    expect(switches()).toHaveLength(2);
  },
);
