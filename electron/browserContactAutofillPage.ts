/// <reference lib="dom" />
import type { ContactAutofillProfile } from "./contactAutofillStore";
import { BROWSER_CONTACT_AUTOFILL_CHANNEL } from "./browserContactAutofillModel";
import { isSecureAutofillUrl } from "./browserAutofillModel";

interface AutofillIpc {
  invoke(channel: string): Promise<unknown>;
}

export type ContactFieldKind = "name" | "email" | "phone" | "address";

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
  // 只有全名资料；first/last/given/family 等分段姓名字段不填，避免填错。
  if (/first|last|given|family|middle/.test(text)) return null;
  if (/full.?name|name/.test(text)) return "name";
  return null;
}

function isProfile(value: unknown): value is ContactAutofillProfile {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["fullName", "email", "phone", "address"].every(
    (key) => typeof record[key] === "string",
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

function valueFor(
  kind: ContactFieldKind,
  profile: ContactAutofillProfile,
): string {
  switch (kind) {
    case "name":
      return profile.fullName;
    case "email":
      return profile.email;
    case "phone":
      return profile.phone;
    case "address":
      return profile.address;
  }
}

export function installBrowserContactAutofill(ipc: AutofillIpc): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (!isSecureAutofillUrl(location.href)) return () => undefined;
  let profile: Promise<ContactAutofillProfile | null> | null = null;
  const load = (): Promise<ContactAutofillProfile | null> => {
    profile ??= ipc
      .invoke(BROWSER_CONTACT_AUTOFILL_CHANNEL)
      .then((result) => (isProfile(result) ? result : null))
      .catch(() => null);
    return profile;
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
