import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ContactAutofillData {
  emails: string[];
  phones: string[];
  addresses: string[];
}

function normalizeList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map((item) => (typeof item === "string" ? item.trim() : ""))
        .filter(Boolean),
    ),
  ];
}

export class ContactAutofillStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<ContactAutofillData | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      const record = parsed as Record<string, unknown>;
      const data = {
        emails: normalizeList(record.emails),
        phones: normalizeList(record.phones),
        addresses: normalizeList(record.addresses),
      };
      return Object.values(data).some((list) => list.length > 0) ? data : null;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await rm(this.#filePath, { force: true });
  }

  async save(
    input: Partial<ContactAutofillData>,
  ): Promise<ContactAutofillData> {
    const data = {
      emails: normalizeList(input.emails),
      phones: normalizeList(input.phones),
      addresses: normalizeList(input.addresses),
    };
    if (!Object.values(data).some((list) => list.length > 0)) {
      throw new Error("请至少填写一项联系信息");
    }
    if (
      data.emails.some((email) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    ) {
      throw new Error("邮箱格式无效");
    }
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(data, null, 2) + "\n", {
      mode: 0o600,
    });
    return data;
  }
}
