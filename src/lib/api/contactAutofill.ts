import { safeInvoke } from "@/lib/dev-bridge";

export interface ContactAutofillProfile {
  fullName: string;
  email: string;
  phone: string;
  address: string;
}

function isProfile(value: unknown): value is ContactAutofillProfile {
  if (!value || typeof value !== "object") return false;
  const record = value as Record<string, unknown>;
  return ["fullName", "email", "phone", "address"].every(
    (key) => typeof record[key] === "string",
  );
}

export async function readContactAutofillProfile(): Promise<ContactAutofillProfile | null> {
  const result = await safeInvoke<unknown>("browser_contact_profile_read");
  if (result === null) return null;
  if (!isProfile(result)) {
    throw new Error("contact profile returned an invalid result");
  }
  return result;
}

export async function saveContactAutofillProfile(
  input: Partial<ContactAutofillProfile>,
): Promise<ContactAutofillProfile> {
  const result = await safeInvoke<unknown>("browser_contact_profile_save", {
    ...input,
  });
  if (!isProfile(result)) {
    throw new Error("contact profile save returned an invalid result");
  }
  return result;
}

export async function clearContactAutofillProfile(): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_contact_profile_clear");
  if (typeof result !== "boolean") {
    throw new Error("contact profile clear returned an invalid result");
  }
  return result;
}
