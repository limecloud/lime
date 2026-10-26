import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { effectiveBrowserSettings } from "@/lib/api/browserSettings";
import type { BrowserPermissionContext } from "@/lib/api/browserUsePolicySitePermissions";
import { BrowserAgentPermissions } from "./BrowserAgentPermissions";

let container: HTMLDivElement;
let root: Root;
const save = vi.fn().mockResolvedValue(true);
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  save.mockClear();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  await changeLimeLocale("zh-CN");
});
const select = (action: string, pattern: string) =>
  container.querySelector<HTMLSelectElement>(
    `select[data-browser-permission-action="${action}"][data-browser-permission-pattern="${pattern}"]`,
  )!;
async function change(node: HTMLSelectElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLSelectElement.prototype,
      "value",
    )!.set!.call(node, value);
    node.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "shows saved, inherited and effective permissions with accessible reasons in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    const settings = effectiveBrowserSettings(
      { allowedOrigins: ["https://app.example.com"] },
      {
        origins: {
          "*.example.com": { access: "deny" },
          "https://app.example.com": { access: "allow" },
          "https://public.other.com": {},
        },
      },
    );
    await act(async () =>
      root.render(
        <BrowserAgentPermissions
          settings={settings}
          context={null}
          disabled={false}
          onChange={save}
        />,
      ),
    );
    const explicit = select("browse", "https://app.example.com");
    expect(explicit.getAttribute("aria-label")).toContain(
      "https://app.example.com",
    );
    expect(explicit.getAttribute("aria-label")).not.toContain("·");
    expect(explicit.value).toBe("allow");
    expect(explicit.dataset.browserPermissionEffective).toBe("deny");
    const description = document.getElementById(
      explicit.getAttribute("aria-describedby")!,
    )!;
    expect(description.textContent).toContain("*.example.com");
    expect(description.textContent).not.toContain("settings.");
    const inherited = select("browse", "https://public.other.com");
    expect(inherited.value).toBe("default");
    expect(inherited.dataset.browserPermissionEffective).toBe("ask");
    expect(inherited.selectedOptions[0].text.length).toBeGreaterThan(3);
    expect(inherited.title.length).toBeGreaterThan(5);
    expect(container.textContent).not.toContain("settings.");
    await change(explicit, "default");
    expect(save).toHaveBeenCalledOnce();
    expect(
      save.mock.calls[0][0].sites.find(
        (site: { pattern: string }) =>
          site.pattern === "https://app.example.com",
      ).permissions.browse,
    ).toBe("default");
    expect(save.mock.calls[0][1]).toEqual(settings.agent_permissions);
  },
);

it.each(["zh-CN", "zh-TW", "en-US", "ja-JP", "ko-KR"] as const)(
  "locks real managed cells and rows, with user rows first in %s",
  async (locale) => {
    await changeLimeLocale(locale);
    const user = effectiveBrowserSettings(
      {},
      { origins: { "z-user.example.com": {} } },
    );
    const settings = effectiveBrowserSettings(
      {},
      {
        origins: {
          "a-managed.example.com": { access: "deny" },
          "z-user.example.com": {},
        },
      },
    );
    const context: BrowserPermissionContext = {
      userPermissions: user.agent_permissions,
      origins: {
        "browser_use.origins.a-managed.example.com.access": {
          name: { type: "mdm", domain: "fixture", key: "config" },
          version: "v1",
        },
      },
    };
    await act(async () =>
      root.render(
        <BrowserAgentPermissions
          settings={settings}
          context={context}
          disabled={false}
          onChange={save}
        />,
      ),
    );
    const managed = select("browse", "a-managed.example.com");
    expect(managed.disabled).toBe(true);
    expect(managed.title.length).toBeGreaterThan(5);
    expect(managed.title).not.toContain("settings.");
    const rows = [...container.querySelectorAll("tbody tr")];
    expect(rows[1].querySelector("th")!.textContent).toBe("z-user.example.com");
    expect(rows[2].querySelectorAll("button")).toHaveLength(2);
    expect(
      [...rows[2].querySelectorAll("button")].every(
        (button) => button.disabled,
      ),
    ).toBe(true);
    await change(managed, "allow");
    expect(save).not.toHaveBeenCalled();
    await change(select("browse", "z-user.example.com"), "allow");
    expect(
      save.mock.calls[0][0].sites.find(
        (site: { pattern: string }) => site.pattern === "z-user.example.com",
      ).permissions.browse,
    ).toBe("allow");
    expect(
      save.mock.calls[0][0].sites.find(
        (site: { pattern: string }) => site.pattern === "a-managed.example.com",
      ).permissions.browse,
    ).toBe("deny");
  },
);

it("rejects synthetic changes while a native capability is disabled", async () => {
  await changeLimeLocale("en-US");
  const settings = effectiveBrowserSettings({
    webMcpEnabled: false,
    allowedWebMcpOrigins: ["example.com"],
  });
  await act(async () =>
    root.render(
      <BrowserAgentPermissions
        settings={settings}
        context={null}
        disabled={false}
        onChange={save}
      />,
    ),
  );
  const next = () =>
    container
      .querySelector<HTMLButtonElement>("thead button:last-child")!
      .click();
  await act(async () => next());
  await act(async () => next());
  const node = select("site_tools", "example.com");
  expect(node.value).toBe("allow");
  expect(node.dataset.browserPermissionEffective).toBe("deny");
  expect(node.disabled).toBe(true);
  expect(node.title).toContain("capability");
  await change(node, "deny");
  expect(save).not.toHaveBeenCalled();
});
