import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale, getLimeI18n } from "@/i18n/createI18n";
import { CloudModelConnection } from "./CloudModelConnection";

const { providers } = vi.hoisted(() => ({ providers: vi.fn() }));
vi.mock("@/lib/api/apiKeyProvider", () => ({
  apiKeyProviderApi: { getProviders: providers },
}));
const resource = {
  provider: "ecs" as const,
  profile: "fixture",
  regionId: "cn-test",
  resourceId: "i-test",
};
const invoke = vi.fn();
let root: Root, container: HTMLDivElement;
async function settle() {
  await act(async () => {
    for (let n = 0; n < 20; n++) await Promise.resolve();
  });
}
const text = (key: string) =>
  String(getLimeI18n().t(`settings:settings.cloudDesktop.${key}`));
function button(key: string) {
  return [...container.querySelectorAll("button")].find(
    (b) => b.textContent === text(key),
  )!;
}
async function render() {
  act(() =>
    root.render(<CloudModelConnection resource={resource} disabled={false} />),
  );
  await settle();
  const details = container.querySelector("details")!;
  act(() => {
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
  });
  await settle();
}
beforeEach(async () => {
  (
    globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("zh-CN");
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  providers.mockReset().mockResolvedValue([
    {
      id: "p1",
      name: "Selected provider",
      enabled: true,
      api_keys: [
        { id: "k1", alias: "Selected key", enabled: true },
        { id: "disabled", enabled: false },
      ],
    },
    { id: "off", enabled: false, api_keys: [{ id: "off-key", enabled: true }] },
  ]);
  invoke
    .mockReset()
    .mockResolvedValue({ kind: "modelConnection", phase: "idle" });
  window.electronAPI = {
    invoke,
    supportsCommand: () => true,
    listen: () => () => undefined,
    emit: async () => undefined,
  };
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
  delete window.electronAPI;
});

it("does no work while collapsed and requires consent for the automatically selected enabled key", async () => {
  act(() =>
    root.render(<CloudModelConnection resource={resource} disabled={false} />),
  );
  await settle();
  expect(invoke).not.toHaveBeenCalled();
  expect(providers).not.toHaveBeenCalled();
  await render();
  expect(container.querySelectorAll("option")).toHaveLength(1);
  expect(button("modelShareAction").disabled).toBe(true);
  act(() =>
    container
      .querySelector<HTMLInputElement>('input[type="checkbox"]')!
      .click(),
  );
  await settle();
  invoke.mockResolvedValue({
    kind: "modelConnection",
    phase: "complete",
    providerId: "p1",
    keyId: "k1",
    operationId: "original",
  });
  act(() => button("modelShareAction").click());
  await settle();
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "shareModelConnection",
      resource,
      providerId: "p1",
      keyId: "k1",
      confirmation: "share-model:cn-test:i-test:p1:k1",
    },
  });
  expect(container.textContent).toContain(text("modelShareComplete"));
  expect(container.textContent).not.toContain("ciphertext");
});

it("continues only the original uncertain delivery without selecting or sending another connection", async () => {
  invoke.mockResolvedValue({
    kind: "modelConnection",
    phase: "unknown",
    operationId: "original",
    providerId: "p1",
    keyId: "k1",
  });
  await render();
  expect(container.querySelector("select")).toBeNull();
  expect(container.querySelector("input")).toBeNull();
  act(() => button("resumeOperation").click());
  await settle();
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "resumeModelConnection",
      resource,
      operationId: "original",
    },
  });
});

it("can recover an existing delivery even when the local provider list is unavailable", async () => {
  providers.mockRejectedValue(new Error("local configuration unavailable"));
  invoke.mockResolvedValue({
    kind: "modelConnection",
    phase: "unknown",
    operationId: "original",
  });
  await render();
  expect(button("resumeOperation").disabled).toBe(false);
  act(() => button("resumeOperation").click());
  await settle();
  expect(invoke).toHaveBeenLastCalledWith("cloud_desktop_connection", {
    request: {
      action: "resumeModelConnection",
      resource,
      operationId: "original",
    },
  });
});

it("keeps raw errors out of the UI and reloads the durable unknown state after failure", async () => {
  await render();
  act(() => container.querySelector<HTMLInputElement>("input")!.click());
  await settle();
  invoke
    .mockRejectedValueOnce(new Error("private-token https://private.invalid"))
    .mockResolvedValue({
      kind: "modelConnection",
      phase: "unknown",
      operationId: "original",
    });
  act(() => button("modelShareAction").click());
  await settle();
  expect(container.textContent).toContain(text("modelShareFailed"));
  expect(container.textContent).not.toMatch(/private-token|private.invalid/);
  expect(button("resumeOperation").disabled).toBe(false);
});

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "provides selection and consent in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    await render();
    expect(button("modelShareAction")).toBeTruthy();
    expect(container.textContent).toContain(text("modelShareConsent"));
    invoke.mockResolvedValue({
      kind: "modelConnection",
      phase: "unknown",
      operationId: "original",
      providerId: "p1",
      keyId: "k1",
    });
    act(() =>
      container
        .querySelector<HTMLInputElement>('input[type="checkbox"]')!
        .click(),
    );
    await settle();
    act(() => button("modelShareAction").click());
    await settle();
    expect(container.textContent).toContain(`${text("operationId")}: original`);
    expect(container.textContent).toContain(text("modelShareRecovery"));
    expect(container.textContent).not.toContain("settings.cloudDesktop");
  },
);
