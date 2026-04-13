import { safeInvoke } from "@/lib/dev-bridge";

export interface FileEntry {
  name: string;
  path: string;
  isDir: boolean;
  size: number;
  modifiedAt: number;
  permissions?: string;
  fileType?: string;
  isHidden?: boolean;
  modeStr?: string;
  mode?: number;
  mimeType?: string;
  isSymlink?: boolean;
}

export interface DirectoryListing {
  path: string;
  parentPath: string | null;
  entries: FileEntry[];
  error: string | null;
}

export interface FilePreview {
  path: string;
  content: string | null;
  isBinary: boolean;
  size: number;
  error: string | null;
}

export async function listDirectory(path: string): Promise<DirectoryListing> {
  return safeInvoke<DirectoryListing>("list_dir", { path });
}

export async function readFilePreview(
  path: string,
  maxSize: number,
): Promise<FilePreview> {
  return safeInvoke<FilePreview>("read_file_preview_cmd", { path, maxSize });
}

export async function createFileAtPath(path: string): Promise<void> {
  await safeInvoke("create_file", { path });
}

export async function createDirectoryAtPath(path: string): Promise<void> {
  await safeInvoke("create_directory", { path });
}

export async function renamePath(
  oldPath: string,
  newPath: string,
): Promise<void> {
  await safeInvoke("rename_file", { oldPath, newPath });
}

export async function deletePath(
  path: string,
  recursive: boolean,
): Promise<void> {
  await safeInvoke("delete_file", { path, recursive });
}
