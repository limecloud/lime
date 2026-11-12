import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { ProviderSettings } from ".";

const { providerSection } = vi.hoisted(() => ({ providerSection: vi.fn() }));
vi.mock("@/components/api-key-provider", () => ({
  ApiKeyProviderSection: (props: unknown) => {
    providerSection(props);
    return <div data-testid="api-key-providers" />;
  },
}));

beforeEach(async () => {
  (
    globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
  ).IS_REACT_ACT_ENVIRONMENT = true;
  providerSection.mockClear();
  await changeLimeLocale("zh-CN");
});
afterEach(() => vi.clearAllMocks());

it("服务商设置只消费独立 Provider owner，并传递修复焦点", async () => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const focus = { providerId: "custom-provider", requestKey: 42 };
  try {
    await act(async () =>
      root.render(<ProviderSettings initialFocus={focus} />),
    );
    expect(container.querySelector("h1")?.textContent).toBeTruthy();
    expect(
      container.querySelector('[data-testid="api-key-providers"]'),
    ).not.toBeNull();
    const props = providerSection.mock.calls.at(-1)![0];
    expect(props.initialFocus).toBe(focus);
    expect(props).not.toHaveProperty("onOemLogin");
    expect(props).not.toHaveProperty("exposeOemLoginPrompt");
  } finally {
    act(() => root.unmount());
    container.remove();
  }
});
