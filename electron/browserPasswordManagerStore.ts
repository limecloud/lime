import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const BROWSER_PASSWORD_MANAGER_PROVIDERS = [
  "onepassword",
  "openai",
] as const;
export type BrowserPasswordManagerProvider =
  (typeof BROWSER_PASSWORD_MANAGER_PROVIDERS)[number];

interface StoredPasswordManager {
  provider: BrowserPasswordManagerProvider | null;
}

export class BrowserPasswordManagerStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<BrowserPasswordManagerProvider | null> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      const provider = parsed?.provider;
      return BROWSER_PASSWORD_MANAGER_PROVIDERS.includes(provider)
        ? provider
        : null;
    } catch {
      return null;
    }
  }

  async set(
    provider: BrowserPasswordManagerProvider | null,
  ): Promise<BrowserPasswordManagerProvider | null> {
    const stored: StoredPasswordManager = { provider };
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(this.#filePath, JSON.stringify(stored, null, 2) + "\n", {
      mode: 0o600,
    });
    return provider;
  }
}
