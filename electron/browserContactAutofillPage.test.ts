import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contactFieldKind,
  installBrowserContactAutofill,
} from "./browserContactAutofillPage";

const profile = {
  fullName: "Alice",
  email: "alice@example.com",
  phone: "123456",
  address: "1 Main St",
};

function input(attributes: Record<string, string>): HTMLInputElement {
  const element = document.createElement("input");
  for (const [key, value] of Object.entries(attributes)) {
    if (key === "type") element.type = value;
    else element.setAttribute(key, value);
  }
  document.body.append(element);
  return element;
}

async function focus(element: HTMLInputElement) {
  element.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
  await Promise.resolve();
  await Promise.resolve();
}

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.innerHTML = "";
});

describe("contactFieldKind", () => {
  it("按类型与属性识别字段", () => {
    expect(contactFieldKind(input({ type: "email" }))).toBe("email");
    expect(contactFieldKind(input({ type: "tel" }))).toBe("phone");
    expect(contactFieldKind(input({ autocomplete: "name" }))).toBe("name");
    expect(contactFieldKind(input({ name: "street-address" }))).toBe("address");
    expect(contactFieldKind(input({ name: "random" }))).toBeNull();
    expect(contactFieldKind(input({ name: "username" }))).toBeNull();
    expect(contactFieldKind(input({ name: "user_name" }))).toBeNull();
    expect(contactFieldKind(input({ name: "search" }))).toBeNull();
    expect(contactFieldKind(input({ name: "fullName" }))).toBe("name");
    expect(contactFieldKind(input({ name: "first-name" }))).toBeNull();
    expect(contactFieldKind(input({ autocomplete: "given-name" }))).toBeNull();
    expect(contactFieldKind(input({ name: "zip" }))).toBeNull();
    expect(contactFieldKind(input({ name: "postal-code" }))).toBeNull();
    expect(contactFieldKind(input({ autocomplete: "street-address" }))).toBe(
      "address",
    );
  });
});

describe("installBrowserContactAutofill", () => {
  it("按字段填充且不覆盖已有值", async () => {
    const invoke = vi.fn().mockResolvedValue(profile);
    cleanups.push(installBrowserContactAutofill({ invoke }));
    const email = input({ type: "email" });
    const phone = input({ type: "tel" });
    const name = input({ autocomplete: "name", value: "existing" });
    await focus(email);
    await focus(phone);
    await focus(name);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(email.value).toBe("alice@example.com");
    expect(phone.value).toBe("123456");
    expect(name.value).toBe("existing");
  });

  it("无资料时不填充", async () => {
    const invoke = vi.fn().mockResolvedValue(null);
    cleanups.push(installBrowserContactAutofill({ invoke }));
    const email = input({ type: "email" });
    await focus(email);
    expect(email.value).toBe("");
  });
});
