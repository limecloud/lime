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
  iconDataUrl?: string | null;
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

export interface FileManagerLocation {
  id: string;
  label: string;
  path: string;
  kind:
    | "home"
    | "desktop"
    | "documents"
    | "downloads"
    | "applications"
    | string;
}

export async function listDirectory(path: string): Promise<DirectoryListing> {
  return safeInvoke<DirectoryListing>("list_dir", { path });
}

export async function getFileManagerLocations(): Promise<
  FileManagerLocation[]
> {
  return safeInvoke<FileManagerLocation[]>("get_file_manager_locations");
}

export async function getFileIconDataUrl(path: string): Promise<string | null> {
  return safeInvoke<string | null>("get_file_icon_data_url", { path });
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
