/// <reference lib="dom" />
import type { ContactAutofillData } from "./contactAutofillStore";
import { BROWSER_CONTACT_AUTOFILL_CHANNEL } from "./browserContactAutofillModel";
import { isSecureAutofillUrl } from "./browserAutofillModel";

interface AutofillIpc {
  invoke(channel: string): Promise<unknown>;
}

export type ContactFieldKind = "email" | "phone" | "address";

function attributeText(input: HTMLInputElement): string {
  return [
    input.getAttribute("autocomplete") ?? "",
    input.name,
    input.id,
    input.placeholder ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

export function contactFieldKind(
  input: HTMLInputElement,
): ContactFieldKind | null {
  if (input.type === "password" || input.type === "hidden") return null;
  if (input.type === "email") return "email";
  if (input.type === "tel") return "phone";
  const text = attributeText(input);
  if (/e-?mail/.test(text)) return "email";
  if (/phone|mobile|tel\b|telephone/.test(text)) return "phone";
  // 用户名/登录/搜索框不能当联系人姓名填充。
  if (/user.?name|login|account|search|query/.test(text)) return null;
  if (/address|street/.test(text)) return "address";
  return null;
}

function isData(value: unknown): value is ContactAutofillData {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["emails", "phones", "addresses"].every(
    (key) =>
      Array.isArray(record[key]) &&
      record[key].every((item) => typeof item === "string"),
  );
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function valueFor(kind: ContactFieldKind, data: ContactAutofillData): string {
  switch (kind) {
    case "email":
      return data.emails[0] ?? "";
    case "phone":
      return data.phones[0] ?? "";
    case "address":
      return data.addresses[0] ?? "";
  }
}

export function installBrowserContactAutofill(ipc: AutofillIpc): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (!isSecureAutofillUrl(location.href)) return () => undefined;
  let data: Promise<ContactAutofillData | null> | null = null;
  const load = (): Promise<ContactAutofillData | null> => {
    data ??= ipc
      .invoke(BROWSER_CONTACT_AUTOFILL_CHANNEL)
      .then((result) => (isData(result) ? result : null))
      .catch(() => null);
    return data;
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.value) return;
    const kind = contactFieldKind(target);
    if (!kind) return;
    void load().then((value) => {
      if (!value || target.value) return;
      const text = valueFor(kind, value);
      if (text) setInputValue(target, text);
    });
  };

  document.addEventListener("focusin", onFocusIn, true);
  return () => document.removeEventListener("focusin", onFocusIn, true);
}
