import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface StoredAutofillPreferences {
  enabled: boolean;
}

export class AutofillPreferencesStore {
  readonly #filePath: string;

  constructor(filePath: string) {
    this.#filePath = filePath;
  }

  async read(): Promise<boolean> {
    try {
      const parsed = JSON.parse(await readFile(this.#filePath, "utf8"));
      return parsed?.enabled !== false;
    } catch {
      return true;
    }
  }

  async set(enabled: boolean): Promise<boolean> {
    const preferences: StoredAutofillPreferences = { enabled };
    await mkdir(path.dirname(this.#filePath), { recursive: true });
    await writeFile(
      this.#filePath,
      JSON.stringify(preferences, null, 2) + "\n",
      { mode: 0o600 },
    );
    return enabled;
  }
}
