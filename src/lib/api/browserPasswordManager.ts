import { safeInvoke } from "@/lib/dev-bridge";

export type BrowserPasswordManagerProvider = "onepassword" | "openai";

const PROVIDERS: readonly BrowserPasswordManagerProvider[] = [
  "onepassword",
  "openai",
];

function isProvider(value: unknown): value is BrowserPasswordManagerProvider {
  return PROVIDERS.includes(value as BrowserPasswordManagerProvider);
}

export async function getBrowserPasswordManagerProvider(): Promise<BrowserPasswordManagerProvider | null> {
  const result = await safeInvoke<unknown>("browser_password_manager_get");
  return isProvider(result) ? result : null;
}

export async function setBrowserPasswordManagerProvider(
  provider: BrowserPasswordManagerProvider | null,
): Promise<BrowserPasswordManagerProvider | null> {
  const result = await safeInvoke<unknown>("browser_password_manager_set", {
    provider,
  });
  return isProvider(result) ? result : null;
}
