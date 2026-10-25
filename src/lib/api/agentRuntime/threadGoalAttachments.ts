import { AppServerClient } from "@/lib/api/appServer";
import {
  createDirectoryAtPath,
  readFileBytes,
  writeFileBytes,
} from "@/lib/api/fileBrowser";
import { getElectronHostBridge } from "@/lib/electron-host";

export interface ThreadGoalDraft {
  objective: string;
  pastedTextAttachments: readonly { text: string }[];
  imageAttachments: readonly {
    src: string;
    localPath?: string;
    filename?: string;
  }[];
}

interface AttachmentFiles {
  read(path: string): Promise<Uint8Array>;
  write(path: string, contents: Uint8Array): Promise<void>;
  createDirectory(path: string): Promise<void>;
  remove(path: string): Promise<void>;
}

interface AttachmentOptions {
  getAgentRoot?: () => string | undefined;
  createId?: () => string;
  files?: AttachmentFiles;
  assertRequestCurrent?: () => void;
}

const currentFiles: AttachmentFiles = {
  read: readFileBytes,
  write: writeFileBytes,
  createDirectory: createDirectoryAtPath,
  remove: async (path) => {
    await new AppServerClient().remove({ path, recursive: true, force: true });
  },
};
const UUID_V4 =
  /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const OBJECTIVE_LIMIT = 4000;

function joinPath(root: string, ...parts: string[]): string {
  const separator = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return [root.replace(/[\\/]+$/, ""), ...parts].join(separator);
}

/** 只拥有本次创建的 UUID 目录；绝不删除原始图片或别人的素材。 */
export class ThreadGoalAttachmentStore {
  private readonly directories = new Set<string>();
  private readonly files: AttachmentFiles;
  private readonly getAgentRoot: () => string | undefined;
  private readonly createId: () => string;

  constructor(options: AttachmentOptions = {}) {
    this.files = options.files ?? currentFiles;
    this.getAgentRoot =
      options.getAgentRoot ?? (() => getElectronHostBridge()?.agentRoot);
    this.createId = options.createId ?? (() => crypto.randomUUID());
  }

  private root(): string {
    const root = this.getAgentRoot();
    if (!root || root.includes("\0") || !/^(?:\/|[a-z]:[\\/]|\\\\)/i.test(root))
      throw new Error("Desktop Agent root is unavailable");
    return root;
  }

  async createDirectory(): Promise<{ path: string }> {
    const id = this.createId();
    if (!UUID_V4.test(id)) throw new Error("Invalid attachment directory ID");
    const path = joinPath(this.root(), "attachments", id);
    await this.files.createDirectory(path);
    this.directories.add(path);
    return { path };
  }

  async write({
    contents,
    directoryPath,
    filename,
  }: {
    contents: Uint8Array;
    directoryPath: string;
    filename: string;
  }): Promise<{ label: string; path: string; fsPath: string }> {
    this.assertOwnedDirectory(directoryPath);
    const basename = filename.trim().split(/[\\/]/).at(-1) ?? "";
    const sanitized = basename.replace(/[\\/:]/g, "_");
    const label =
      !sanitized || sanitized === "." || sanitized === ".."
        ? "attachment"
        : sanitized;
    const path = joinPath(directoryPath, label);
    await this.files.write(path, contents);
    return { label, path, fsPath: path };
  }

  async remove(directoryPath: string): Promise<void> {
    this.assertOwnedDirectory(directoryPath);
    await this.files.remove(directoryPath);
    this.directories.delete(directoryPath);
  }

  private assertOwnedDirectory(directoryPath: string): void {
    if (!this.directories.has(directoryPath))
      throw new Error("Unknown attachment directory");
    const id = directoryPath.split(/[\\/]/).at(-1) ?? "";
    if (
      !UUID_V4.test(id) ||
      directoryPath !== joinPath(this.root(), "attachments", id)
    )
      throw new Error("Invalid attachment directory");
  }
}

function localImagePath(source: string): string {
  if (!/^file:/i.test(source)) return source;
  const url = new URL(source);
  const path = decodeURIComponent(url.pathname);
  if (url.hostname) return `\\\\${url.hostname}${path.replace(/\//g, "\\")}`;
  return /^\/[a-z]:\//i.test(path) ? path.slice(1).replace(/\//g, "\\") : path;
}

function dataImage(source: string): Uint8Array {
  const match = /^data:([^,]*),(.*)$/s.exec(source);
  if (!match) throw new Error("Invalid image data URL");
  if (/(?:^|;)base64$/i.test(match[1])) {
    const binary = atob(match[2]);
    return Uint8Array.from(binary, (character) => character.charCodeAt(0));
  }
  return new TextEncoder().encode(decodeURIComponent(match[2]));
}

function imageExtension(
  image: ThreadGoalDraft["imageAttachments"][number],
): string {
  const pathExtension = /\.([a-z0-9]{1,8})$/i.exec(
    image.filename ?? image.localPath ?? "",
  );
  if (pathExtension) return pathExtension[1].toLowerCase();
  const mime = /^data:image\/([a-z0-9.+-]+);/i
    .exec(image.src)?.[1]
    ?.toLowerCase();
  if (mime === "jpeg") return "jpg";
  return mime?.replace(/[^a-z0-9]/g, "").slice(0, 8) || "png";
}

export interface MaterializedThreadGoal {
  objective: string;
  cleanup(): Promise<void>;
}

export async function materializeThreadGoal(
  draft: ThreadGoalDraft,
  options: AttachmentOptions = {},
): Promise<MaterializedThreadGoal> {
  const files = options.files ?? currentFiles;
  const store = new ThreadGoalAttachmentStore(options);
  const assertCurrent = options.assertRequestCurrent ?? (() => undefined);
  const encoder = new TextEncoder();
  let directoryPath: string | null = null;
  const cleanup = async () => {
    if (!directoryPath) return;
    try {
      await store.remove(directoryPath);
      directoryPath = null;
    } catch {
      // 清理失败不能遮蔽准备或保存的原始错误。
      console.error("[ThreadGoal] attachment cleanup failed");
    }
  };
  const getDirectory = async () => {
    assertCurrent();
    if (!directoryPath) {
      directoryPath = (await store.createDirectory()).path;
      assertCurrent();
    }
    return directoryPath;
  };
  const write = async (filename: string, contents: Uint8Array) => {
    const directoryPath = await getDirectory();
    assertCurrent();
    const file = await store.write({ directoryPath, filename, contents });
    assertCurrent();
    return file.path;
  };
  try {
    assertCurrent();
    const sections = [draft.objective.trim()].filter(Boolean);
    if (
      !sections.length &&
      !draft.pastedTextAttachments.length &&
      !draft.imageAttachments.length
    )
      throw new Error("A goal objective or attachment is required");
    const preparedPastes = draft.pastedTextAttachments.map((paste, index) => ({
      filename: `pasted-text-${index + 1}.txt`,
      contents: encoder.encode(paste.text),
    }));
    const preparedImages: {
      filename: string;
      contents: Uint8Array;
      position: number;
    }[] = [];
    const urls: string[] = [];
    for (const [index, image] of draft.imageAttachments.entries()) {
      assertCurrent();
      if (/^https?:\/\//i.test(image.src)) {
        urls.push(`- [Image #${index + 1}]: ${image.src}`);
        continue;
      }
      const contents = /^data:/i.test(image.src)
        ? dataImage(image.src)
        : await files.read(localImagePath(image.localPath ?? image.src));
      assertCurrent();
      preparedImages.push({
        filename: `image-${index + 1}.${imageExtension(image)}`,
        contents,
        position: index + 1,
      });
    }
    const pasted: string[] = [];
    for (const paste of preparedPastes) {
      const path = await write(paste.filename, paste.contents);
      pasted.push(
        `- pasted text file: ${path}. Read this file before continuing.`,
      );
    }
    if (pasted.length)
      sections.push(`Referenced pasted text files:\n${pasted.join("\n")}`);
    const images: string[] = [];
    for (const image of preparedImages) {
      const path = await write(image.filename, image.contents);
      images.push(`- [Image #${image.position}]: ${path}`);
    }
    if (images.length)
      sections.push(`Referenced image files:\n${images.join("\n")}`);
    if (urls.length)
      sections.push(`Referenced image URLs:\n${urls.join("\n")}`);
    let objective = sections.join("\n\n");
    if (Array.from(objective).length > OBJECTIVE_LIMIT) {
      const path = joinPath(await getDirectory(), "goal-objective.md");
      const reference = `Read the Lime goal objective file at ${path} before continuing.`;
      if (Array.from(reference).length > OBJECTIVE_LIMIT)
        throw new Error(
          "Goal objective file reference exceeds the objective limit",
        );
      await write("goal-objective.md", encoder.encode(objective));
      objective = reference;
    }
    assertCurrent();
    return { objective, cleanup };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
