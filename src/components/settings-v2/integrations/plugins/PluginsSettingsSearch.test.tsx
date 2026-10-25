import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { changeLimeLocale } from "@/i18n/createI18n";
import { PluginsSettingsSearch } from "./PluginsSettingsSearch";
import { matchesQuery } from "./plugins-page-selectors";

let root: Root, container: HTMLDivElement;
beforeEach(async () => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  await changeLimeLocale("en-US");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});
const mount = () =>
  act(async () =>
    root.render(
      <StrictMode>
        <PluginsSettingsSearch
          tab="plugins"
          query=""
          onQueryChange={() => {}}
        />
      </StrictMode>,
    ),
  );
const find = (
  target: EventTarget,
  modifiers: { metaKey?: boolean; ctrlKey?: boolean } = { metaKey: true },
) => {
  const event = new KeyboardEvent("keydown", {
    key: "f",
    bubbles: true,
    cancelable: true,
    ...modifiers,
  });
  target.dispatchEvent(event);
  return event;
};

it.each([{ metaKey: true }, { ctrlKey: true }])(
  "focuses the local search using %o and removes the listener on unmount",
  async (modifiers) => {
    await mount();
    const input = container.querySelector("input")!;
    expect(find(document.body, modifiers).defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
    await act(async () => root.render(null));
    expect(find(document.body, modifiers).defaultPrevented).toBe(false);
  },
);

it.each(["input", "textarea", "select", "contenteditable"])(
  "keeps browser find in an editable %s",
  async (tag) => {
    await mount();
    const target = document.createElement(
      tag === "contenteditable" ? "div" : tag,
    );
    if (tag === "contenteditable")
      target.setAttribute("contenteditable", "true");
    target.tabIndex = 0;
    container.appendChild(target);
    target.focus();
    expect(find(target).defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(target);
  },
);

it("does not move focus outside a modal or override another shortcut owner", async () => {
  await mount();
  const dialog = document.createElement("div");
  dialog.setAttribute("role", "alertdialog");
  container.appendChild(dialog);
  const action = document.createElement("button");
  dialog.appendChild(action);
  action.focus();
  expect(find(action).defaultPrevented).toBe(false);
  expect(document.activeElement).toBe(action);
  dialog.remove();
  const prior = new KeyboardEvent("keydown", {
    key: "f",
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  prior.preventDefault();
  document.body.dispatchEvent(prior);
  expect(document.activeElement).not.toBe(container.querySelector("input"));
  expect(find(document.body, {}).defaultPrevented).toBe(false);
});

it.each([
  ["zh-CN", "搜索技能"],
  ["zh-TW", "搜尋技能"],
  ["en-US", "Search skills"],
  ["ja-JP", "スキルを検索"],
  ["ko-KR", "스킬 검색"],
])("uses the current group search name in %s", async (locale, expected) => {
  await changeLimeLocale(locale);
  const changed = vi.fn();
  await act(async () =>
    root.render(
      <PluginsSettingsSearch
        tab="skills"
        query="write"
        onQueryChange={changed}
      />,
    ),
  );
  expect(container.querySelector("label")?.textContent).toBe(expected);
  expect(container.querySelector("input")?.placeholder).toBe(expected);
  expect(container.querySelector("input")?.value).toBe("write");
});

it.each([
  [" REVIEW ", ["Code review", null], true],
  ["marketplace.json", ["/team/.agents/plugins/marketplace.json"], true],
  ["写作", ["中文写作"], true],
  ["", [undefined], true],
  ["alpha beta", ["alpha", "beta"], true],
  ["alpha gamma", ["alpha", "beta"], false],
  ["*", ["alpha"], false],
] as const)(
  "matches the reference substring semantics for %s",
  (query, values, expected) => {
    expect(matchesQuery(query, [...values])).toBe(expected);
  },
);
