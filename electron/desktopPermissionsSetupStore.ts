import path from "node:path";
import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  persistedAtomFileIO,
  type PersistedAtomFileIO,
} from "./persistedAtomFile";

function errorCode(error: unknown): string | undefined {
  return error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "string"
    ? error.code
    : undefined;
}

/** Guide completion is a UI preference, never an OS permission receipt. */
export class DesktopPermissionsSetupStore {
  readonly #file: string;
  readonly #io: PersistedAtomFileIO;
  #tail: Promise<unknown> = Promise.resolve();
  constructor(appDataRoot: string, io = persistedAtomFileIO) {
    if (!path.isAbsolute(appDataRoot))
      throw new Error("Permissions require AppDataRoot");
    this.#file = path.join(appDataRoot, "permissions", "setup.json");
    this.#io = io;
  }
  async read(): Promise<boolean> {
    await this.#tail;
    return (await this.#load()).complete;
  }
  async directory(): Promise<string | null> {
    await this.#tail;
    return (await this.#load()).selectedDirectory;
  }
  async #load(): Promise<{
    complete: boolean;
    selectedDirectory: string | null;
  }> {
    try {
      const data = JSON.parse(
        (await this.#io.readFile(this.#file, 16_384)).toString("utf8"),
      );
      return {
        complete: data?.version === 1 && data?.complete === true,
        selectedDirectory:
          data?.version === 1 &&
          typeof data.selectedDirectory === "string" &&
          path.isAbsolute(data.selectedDirectory)
            ? data.selectedDirectory
            : null,
      };
    } catch (error) {
      if (errorCode(error) === "ENOENT" || error instanceof SyntaxError)
        return { complete: false, selectedDirectory: null };
      throw error;
    }
  }
  complete(): Promise<void> {
    return this.#update({ complete: true });
  }
  selectDirectory(selectedDirectory: string): Promise<void> {
    if (!path.isAbsolute(selectedDirectory))
      throw new Error("Directory must be absolute");
    return this.#update({ selectedDirectory });
  }
  #update(change: {
    complete?: boolean;
    selectedDirectory?: string;
  }): Promise<void> {
    const operation = this.#tail.then(async () => {
      const current = { ...(await this.#load()), ...change };
      await this.#io.mkdir(path.dirname(this.#file));
      const temporary = `${this.#file}.${randomUUID()}.tmp`;
      try {
        await this.#io.writeFile(
          temporary,
          JSON.stringify({
            version: 1,
            complete: current.complete,
            ...(current.selectedDirectory
              ? { selectedDirectory: current.selectedDirectory }
              : {}),
          }),
        );
        for (let attempt = 0; ; attempt++) {
          try {
            await this.#io.rename(temporary, this.#file);
            break;
          } catch (error) {
            if (
              process.platform !== "win32" ||
              attempt >= 3 ||
              !["EPERM", "EACCES", "EBUSY"].includes(errorCode(error) ?? "")
            )
              throw error;
            await new Promise((resolve) =>
              setTimeout(resolve, 100 * 2 ** attempt),
            );
          }
        }
      } finally {
        await this.#io.removeTemporary(temporary).catch(() => undefined);
      }
    });
    this.#tail = operation.catch(() => undefined);
    return operation;
  }
}
