import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export interface ContactAutofillProfile {
  fullName: string;
  email: string;
  phone: string;
  address: string;
}

const EMPTY: ContactAutofillProfile = {
  fullName: "",
  email: "",
  phone: "",
  address: "",
};

function normalize(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

export class ContactAutofillStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<ContactAutofillProfile | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      if (!parsed || typeof parsed !== "object") return null;
      const record = parsed as Record<string, unknown>;
      const profile = {
        fullName: normalize(record.fullName),
        email: normalize(record.email),
        phone: normalize(record.phone),
        address: normalize(record.address),
      };
      return Object.values(profile).some(Boolean) ? profile : null;
    } catch {
      return null;
    }
  }

  async clear(): Promise<void> {
    await rm(this.#filePath, { force: true });
  }

  async save(
    input: Partial<ContactAutofillProfile>,
  ): Promise<ContactAutofillProfile> {
    const profile = {
      ...EMPTY,
      fullName: normalize(input.fullName),
      email: normalize(input.email),
      phone: normalize(input.phone),
      address: normalize(input.address),
    };
    if (!Object.values(profile).some(Boolean)) {
      throw new Error("请至少填写一项联系信息");
    }
    if (profile.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
      throw new Error("邮箱格式无效");
    }
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(profile, null, 2) + "\n", {
      mode: 0o600,
    });
    return profile;
  }
}
