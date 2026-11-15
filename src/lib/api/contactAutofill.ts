import { safeInvoke } from "@/lib/dev-bridge";

export interface ContactAutofillData {
  emails: string[];
  phones: string[];
  addresses: string[];
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

export async function readContactAutofillData(): Promise<ContactAutofillData | null> {
  const result = await safeInvoke<unknown>("browser_contact_profile_read");
  if (result === null) return null;
  if (!isData(result)) {
    throw new Error("contact info returned an invalid result");
  }
  return result;
}

export async function saveContactAutofillData(
  input: Partial<ContactAutofillData>,
): Promise<ContactAutofillData> {
  const result = await safeInvoke<unknown>("browser_contact_profile_save", {
    ...input,
  });
  if (!isData(result)) {
    throw new Error("contact info save returned an invalid result");
  }
  return result;
}

export async function clearContactAutofillData(): Promise<boolean> {
  const result = await safeInvoke<unknown>("browser_contact_profile_clear");
  if (typeof result !== "boolean") {
    throw new Error("contact info clear returned an invalid result");
  }
  return result;
}
