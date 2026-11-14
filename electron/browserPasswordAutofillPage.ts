/// <reference lib="dom" />
import {
  BROWSER_PASSWORD_AUTOFILL_CHANNEL,
  isSecureAutofillUrl,
  type BrowserPasswordCredential,
} from "./browserPasswordAutofillModel";

interface AutofillIpc {
  invoke(channel: string): Promise<unknown>;
}

function isCredential(value: unknown): value is BrowserPasswordCredential {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.username === "string" &&
    record.username.length > 0 &&
    typeof record.password === "string" &&
    record.password.length > 0
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

function findUsernameInput(
  container: HTMLElement | Document,
): HTMLInputElement | null {
  const candidates = [
    'input[autocomplete="username"]',
    'input[type="email"]',
    'input[name*="user" i]',
    'input[id*="user" i]',
    'input[type="text"]',
    "input:not([type])",
  ];
  for (const selector of candidates) {
    const input = container.querySelector<HTMLInputElement>(selector);
    if (input) return input;
  }
  return null;
}

export function installBrowserPasswordAutofill(ipc: AutofillIpc): () => void {
  if (typeof document === "undefined") return () => undefined;
  if (!isSecureAutofillUrl(location.href)) return () => undefined;

  let credentials: Promise<BrowserPasswordCredential[]> | null = null;
  const filledContainers = new WeakSet<object>();

  const load = (): Promise<BrowserPasswordCredential[]> => {
    credentials ??= ipc
      .invoke(BROWSER_PASSWORD_AUTOFILL_CHANNEL)
      .then((result) =>
        Array.isArray(result) ? result.filter(isCredential) : [],
      )
      .catch(() => []);
    return credentials;
  };

  const onFocusIn = (event: FocusEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement) || target.type !== "password") {
      return;
    }
    if (target.value) return;
    // 许多现代登录页没有 <form>，退回到最近的容器。
    const container: HTMLElement | Document =
      target.form ??
      target.closest<HTMLElement>("div,section,main") ??
      document;
    if (filledContainers.has(container)) return;
    filledContainers.add(container);
    void load().then((list) => {
      const [credential] = list;
      if (
        !credential ||
        container.querySelector('input[type="password"]') !== target
      ) {
        return;
      }
      const usernameInput = findUsernameInput(container);
      if (usernameInput && !usernameInput.value) {
        setInputValue(usernameInput, credential.username);
      }
      if (!target.value) setInputValue(target, credential.password);
    });
  };

  document.addEventListener("focusin", onFocusIn, true);
  return () => document.removeEventListener("focusin", onFocusIn, true);
}
