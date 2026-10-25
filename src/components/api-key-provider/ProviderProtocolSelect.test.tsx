import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ProviderProtocolSelect } from "./ProviderProtocolSelect";
import { createProvider, translate } from "./ProviderSetting.uiTestFixtures";

vi.mock("react-i18next", () => ({ useTranslation: () => ({ t: translate }) }));

it("协议更新仅写 type，失败保持原协议并允许重试", async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  const onUpdate = vi
    .fn()
    .mockRejectedValueOnce(new Error("offline"))
    .mockResolvedValue(undefined);
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  try {
    act(() =>
      root.render(
        <ProviderProtocolSelect
          provider={createProvider()}
          onUpdate={onUpdate}
        />,
      ),
    );
    const select = container.querySelector("select")!;
    const change = async () =>
      act(async () => {
        select.value = "openai-response";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
    await change();
    expect(onUpdate).toHaveBeenLastCalledWith("deepseek", {
      type: "openai-response",
    });
    expect(select.value).toBe("openai");
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    await change();
    expect(onUpdate).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[role="alert"]')).toBeNull();
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
