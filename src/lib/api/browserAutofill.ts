import { safeInvoke } from "@/lib/dev-bridge";

export async function readBrowserAutofillEnabled(): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_autofill_get");
  if (typeof result !== "boolean") {
    throw new Error("browser autofill returned an invalid state");
  }
  return result;
}

export async function setBrowserAutofillEnabled(
  enabled: boolean,
): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_autofill_set", { enabled });
  if (typeof result !== "boolean") {
    throw new Error("browser autofill update returned an invalid state");
  }
  return result;
}
