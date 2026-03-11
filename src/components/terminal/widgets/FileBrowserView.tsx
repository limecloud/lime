/**
 * 文件浏览器视图
 *
 * 显示文件系统目录结构，支持导航和文件预览
 * 通过 Tauri 命令与后端交互
 * 借鉴 Waveterm 的右键菜单功能
 *
 * @module widgets/FileBrowserView
 */

import React, { memo, useEffect, useState, useCallback } from "react";
import styled from "styled-components";
import {
  Folder,
  File,
  FileText,
  FileCode,
  FileJson,
  Image,
  Music,
  Video,
  Archive,
  ChevronRight,
  ChevronUp,
  Home,
  RefreshCw,
  Eye,
  EyeOff,
} from "lucide-react";
import { FileEntry } from "./types";
import {
  createDirectoryAtPath,
  createFileAtPath,
  listDirectory,
  readFilePreview,
  renamePath,
  type DirectoryListing,
  type FilePreview,
} from "@/lib/api/fileBrowser";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { FileContextMenu, ContextMenuPosition } from "./FileContextMenu";
import { EntryManagerOverlay, EntryManagerType } from "./EntryManagerOverlay";

// ============================================================================
// 类型定义
// ============================================================================

/** 组件属性 */
export interface FileBrowserViewProps {
  /** 在新终端中打开目录的回调 */
  onOpenTerminal?: (path: string) => void;
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a1a;
  color: #e0e0e0;
`;

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #2a2a2a;
  background: #1a1a1a;
`;

const PathBreadcrumb = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  gap: 4px;
  font-size: 12px;
  color: #808080;
  overflow: hidden;
`;

const PathSegment = styled.button`
  padding: 2px 6px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #e0e0e0;
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: #333;
  }
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #808080;
  cursor: pointer;

  &:hover {
    background: #333;
    color: #e0e0e0;
  }

  svg {
    width: 16px;
    height: 16px;
  }
`;

// ============================================================================
// 表格布局样式（对齐 Waveterm）
// ============================================================================

const TableContainer = styled.div`
  flex: 1;
  overflow: hidden;
  display: flex;
  flex-direction: column;
`;

const TableHead = styled.div`
  display: flex;
  align-items: center;
  padding: 6px 8px;
  border-bottom: 1px solid #2a2a2a;
  background: #1e1e1e;
  font-size: 11px;
  font-weight: 600;
  color: #888;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  user-select: none;
`;

const TableHeadCell = styled.div<{ $width?: string; $align?: string }>`
  flex: ${({ $width }) => ($width ? `0 0 ${$width}` : "1")};
  min-width: ${({ $width }) => $width || "auto"};
  text-align: ${({ $align }) => $align || "left"};
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const TableBody = styled.div`
  flex: 1;
  overflow: auto;
`;

const TableRow = styled.div<{ $selected?: boolean }>`
  display: flex;
  align-items: center;
  padding: 4px 8px;
  cursor: pointer;
  background: ${({ $selected }) =>
    $selected ? "rgba(88, 166, 255, 0.15)" : "transparent"};
  border-bottom: 1px solid rgba(255, 255, 255, 0.03);

  &:hover {
    background: ${({ $selected }) =>
      $selected ? "rgba(88, 166, 255, 0.2)" : "#252525"};
  }
`;

const TableCell = styled.div<{ $width?: string; $align?: string }>`
  flex: ${({ $width }) => ($width ? `0 0 ${$width}` : "1")};
  min-width: ${({ $width }) => $width || "auto"};
  text-align: ${({ $align }) => $align || "left"};
  padding: 0 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
`;

const FileIcon = styled.div<{ $color?: string }>`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  color: ${({ $color }) => $color || "#808080"};
  flex-shrink: 0;

  svg {
    width: 16px;
    height: 16px;
  }
`;

const FileName = styled.span<{ $isHidden?: boolean; $isSymlink?: boolean }>`
  font-size: 13px;
  font-weight: 500;
  color: ${({ $isHidden, $isSymlink }) =>
    $isHidden ? "#606060" : $isSymlink ? "#7aa2f7" : "#e0e0e0"};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const ModeStr = styled.span`
  font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
  font-size: 11px;
  color: #888;
  letter-spacing: 0.5px;
`;

const FileSize = styled.span`
  font-size: 12px;
  color: #888;
  font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
`;

const FileDate = styled.span`
  font-size: 12px;
  color: #888;
`;

const FileType = styled.span`
  font-size: 11px;
  color: #666;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`;

const PreviewPanel = styled.div`
  border-top: 1px solid #2a2a2a;
  max-height: 200px;
  overflow: auto;
  background: #1a1a1a;
`;

const PreviewContent = styled.pre`
  margin: 0;
  padding: 12px;
  font-size: 12px;
  font-family: "SF Mono", Monaco, "Cascadia Code", monospace;
  white-space: pre-wrap;
  word-break: break-all;
  color: #e0e0e0;
`;

const PreviewMessage = styled.div`
  padding: 12px;
  font-size: 12px;
  color: #808080;
  text-align: center;
`;

const LoadingMessage = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: #808080;
`;

const ErrorMessage = styled.div`
  padding: 16px;
  color: #ff6b6b;
  text-align: center;
`;

/**
 * 格式化文件大小（对齐 Waveterm）
 * @param bytes - 文件大小（字节）
 * @param sigfig - 有效数字位数
 */
function formatFileSize(bytes: number, sigfig: number = 3): string {
  if (bytes < 0) return "-"; // 目录
  if (bytes === 0) return "0";

  const k = 1024;
  const units = ["", "k", "m", "g", "t", "p"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  if (i === 0) return bytes.toString();

  const value = bytes / Math.pow(k, i);
  // 根据数值大小调整小数位数
  let decimals = sigfig - Math.floor(Math.log10(value)) - 1;
  decimals = Math.max(0, Math.min(decimals, sigfig - 1));

  return value.toFixed(decimals) + units[i];
}

/**
 * 清理 MIME 类型显示
 */
function cleanMimeType(mimeType: string | undefined): string {
  if (!mimeType) return "-";
  // 移除 charset 等参数
  const cleaned = mimeType.split(";")[0].trim();
  // 简化显示
  if (cleaned === "directory") return "Directory";
  if (cleaned === "symlink") return "Symlink";
  if (cleaned === "application/octet-stream") return "Binary";
  // 对于常见类型，只显示子类型
  const parts = cleaned.split("/");
  if (parts.length === 2) {
    const mainType = parts[0];
    const subType = parts[1];
    // 移除 x- 前缀
    const cleanSubType = subType.replace(/^x-/, "").replace(/^vnd\./, "");
    // 对于 text 类型，显示更友好的名称
    if (mainType === "text") {
      return cleanSubType.charAt(0).toUpperCase() + cleanSubType.slice(1);
    }
    return cleanSubType;
  }
  return cleaned;
}

/**
 * 格式化日期
 */
function formatDate(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return date.toLocaleDateString("zh-CN", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * 获取文件图标
 */
function getFileIcon(entry: FileEntry) {
  if (entry.isDir) {
    return { icon: Folder, color: "hsl(var(--warning))" };
  }

  const ext = entry.fileType?.toLowerCase();
  switch (ext) {
    case "js":
    case "ts":
    case "tsx":
    case "jsx":
    case "rs":
    case "py":
    case "go":
    case "java":
    case "c":
    case "cpp":
    case "h":
      return { icon: FileCode, color: "hsl(var(--info))" };
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return { icon: FileJson, color: "hsl(var(--warning))" };
    case "md":
    case "txt":
    case "log":
      return { icon: FileText, color: "hsl(var(--muted-foreground))" };
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "webp":
      return { icon: Image, color: "hsl(var(--success))" };
    case "mp3":
    case "wav":
    case "flac":
    case "ogg":
      return { icon: Music, color: "hsl(var(--primary))" };
    case "mp4":
    case "mov":
    case "avi":
    case "mkv":
      return { icon: Video, color: "hsl(var(--destructive))" };
    case "zip":
    case "tar":
    case "gz":
    case "rar":
    case "7z":
      return { icon: Archive, color: "hsl(var(--muted-foreground))" };
    default:
      return { icon: File, color: "hsl(var(--muted-foreground))" };
  }
}

/**
 * 文件浏览器视图
 */
export const FileBrowserView = memo(function FileBrowserView({
  onOpenTerminal,
}: FileBrowserViewProps) {
  const [currentPath, setCurrentPath] = useState<string>("~");
  const [listing, setListing] = useState<DirectoryListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    position: ContextMenuPosition;
    file: FileEntry | null;
  } | null>(null);

  // 文件/文件夹名称编辑状态
  const [entryManager, setEntryManager] = useState<{
    type: EntryManagerType;
    initialValue?: string;
    targetFile?: FileEntry;
  } | null>(null);

  // 加载目录
  const loadDirectory = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    setSelectedFile(null);
    setPreview(null);

    try {
      const result = await listDirectory(path);
      setListing(result);
      setCurrentPath(result.path);
      if (result.error) {
        setError(result.error);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  // 初始加载
  useEffect(() => {
    loadDirectory("~");
  }, [loadDirectory]);

  // 加载文件预览
  const loadPreview = useCallback(async (file: FileEntry) => {
    if (file.isDir) return;

    try {
      const result = await readFilePreview(file.path, 50000);
      setPreview(result);
    } catch (e) {
      setPreview({
        path: file.path,
        content: null,
        isBinary: false,
        size: file.size,
        error: String(e),
      });
    }
  }, []);

  // 处理文件点击
  const handleFileClick = useCallback(
    (entry: FileEntry) => {
      setSelectedFile(entry);
      if (!entry.isDir) {
        loadPreview(entry);
      }
    },
    [loadPreview],
  );

  // 处理双击
  const handleFileDoubleClick = useCallback(
    (entry: FileEntry) => {
      if (entry.isDir) {
        loadDirectory(entry.path);
      }
    },
    [loadDirectory],
  );

  // 处理右键菜单
  const handleContextMenu = useCallback(
    (e: React.MouseEvent, entry: FileEntry | null) => {
      e.preventDefault();
      e.stopPropagation();
      setContextMenu({
        position: { x: e.clientX, y: e.clientY },
        file: entry,
      });
      if (entry) {
        setSelectedFile(entry);
      }
    },
    [],
  );

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 刷新目录
  const refresh = useCallback(() => {
    loadDirectory(currentPath);
  }, [currentPath, loadDirectory]);

  // 新建文件
  const handleNewFile = useCallback(() => {
    setEntryManager({ type: EntryManagerType.NewFile });
  }, []);

  // 新建文件夹
  const handleNewFolder = useCallback(() => {
    setEntryManager({ type: EntryManagerType.NewFolder });
  }, []);

  // 重命名
  const handleRename = useCallback((file: FileEntry) => {
    setEntryManager({
      type: EntryManagerType.Rename,
      initialValue: file.name,
      targetFile: file,
    });
  }, []);

  // 保存文件/文件夹名称
  const handleEntryManagerSave = useCallback(
    async (value: string) => {
      if (!entryManager) return;

      try {
        if (entryManager.type === EntryManagerType.NewFile) {
          const newPath = `${currentPath}/${value}`;
          await createFileAtPath(newPath);
        } else if (entryManager.type === EntryManagerType.NewFolder) {
          const newPath = `${currentPath}/${value}`;
          await createDirectoryAtPath(newPath);
        } else if (
          entryManager.type === EntryManagerType.Rename &&
          entryManager.targetFile
        ) {
          const oldPath = entryManager.targetFile.path;
          const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
          const newPath = `${parentPath}/${value}`;
          await renamePath(oldPath, newPath);
        }
        refresh();
      } catch (e) {
        console.error("[FileBrowserView] 操作失败:", e);
        alert(`操作失败: ${e}`);
      }

      setEntryManager(null);
    },
    [entryManager, currentPath, refresh],
  );

  // 取消编辑
  const handleEntryManagerCancel = useCallback(() => {
    setEntryManager(null);
  }, []);

  // 导航到父目录
  const goToParent = useCallback(() => {
    if (listing?.parentPath) {
      loadDirectory(listing.parentPath);
    }
  }, [listing, loadDirectory]);

  // 导航到主目录
  const goToHome = useCallback(() => {
    loadDirectory("~");
  }, [loadDirectory]);

  // 解析路径为面包屑
  const pathSegments = currentPath.split("/").filter(Boolean);

  // 过滤隐藏文件
  const visibleEntries = listing?.entries.filter(
    (e) => showHidden || !e.isHidden,
  );

  if (loading && !listing) {
    return (
      <Container>
        <LoadingMessage>正在加载...</LoadingMessage>
      </Container>
    );
  }

  return (
    <Container onContextMenu={(e) => handleContextMenu(e, null)}>
      <Toolbar>
        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={goToHome}>
              <Home />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>主目录</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={goToParent} disabled={!listing?.parentPath}>
              <ChevronUp />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>上级目录</TooltipContent>
        </Tooltip>

        <PathBreadcrumb>
          <PathSegment onClick={goToHome}>/</PathSegment>
          {pathSegments.map((segment, idx) => (
            <span key={idx} style={{ display: "flex", alignItems: "center" }}>
              <ChevronRight
                size={12}
                style={{ color: "hsl(var(--muted-foreground))" }}
              />
              <PathSegment
                onClick={() => {
                  const path = "/" + pathSegments.slice(0, idx + 1).join("/");
                  loadDirectory(path);
                }}
              >
                {segment}
              </PathSegment>
            </span>
          ))}
        </PathBreadcrumb>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={() => setShowHidden(!showHidden)}>
              {showHidden ? <Eye /> : <EyeOff />}
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>
            {showHidden ? "隐藏隐藏文件" : "显示隐藏文件"}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <IconButton onClick={refresh}>
              <RefreshCw />
            </IconButton>
          </TooltipTrigger>
          <TooltipContent>刷新</TooltipContent>
        </Tooltip>
      </Toolbar>

      {error && <ErrorMessage>{error}</ErrorMessage>}

      <TableContainer>
        {/* 表头 */}
        <TableHead>
          <TableHeadCell $width="24px"></TableHeadCell>
          <TableHeadCell>Name</TableHeadCell>
          <TableHeadCell $width="90px">Perm</TableHeadCell>
          <TableHeadCell $width="100px">Modified</TableHeadCell>
          <TableHeadCell $width="60px" $align="right">
            Size
          </TableHeadCell>
          <TableHeadCell $width="100px">Type</TableHeadCell>
        </TableHead>

        {/* 表体 */}
        <TableBody>
          {visibleEntries?.map((entry) => {
            const { icon: Icon, color } = getFileIcon(entry);
            const isSelected = selectedFile?.path === entry.path;

            return (
              <TableRow
                key={entry.path}
                $selected={isSelected}
                onClick={() => handleFileClick(entry)}
                onDoubleClick={() => handleFileDoubleClick(entry)}
                onContextMenu={(e) => handleContextMenu(e, entry)}
              >
                {/* 图标 */}
                <TableCell $width="24px">
                  <FileIcon $color={color}>
                    <Icon />
                  </FileIcon>
                </TableCell>

                {/* 文件名 */}
                <TableCell>
                  <FileName
                    $isHidden={entry.isHidden}
                    $isSymlink={entry.isSymlink}
                  >
                    {entry.name}
                    {entry.isSymlink && " →"}
                  </FileName>
                </TableCell>

                {/* 权限 */}
                <TableCell $width="90px">
                  <ModeStr>{entry.modeStr || "-"}</ModeStr>
                </TableCell>

                {/* 修改时间 */}
                <TableCell $width="100px">
                  <FileDate>{formatDate(entry.modifiedAt)}</FileDate>
                </TableCell>

                {/* 文件大小 */}
                <TableCell $width="60px" $align="right">
                  <FileSize>
                    {entry.isDir ? "-" : formatFileSize(entry.size)}
                  </FileSize>
                </TableCell>

                {/* 文件类型 */}
                <TableCell $width="100px">
                  <FileType>{cleanMimeType(entry.mimeType)}</FileType>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </TableContainer>

      {preview && (
        <PreviewPanel>
          {preview.error ? (
            <PreviewMessage>{preview.error}</PreviewMessage>
          ) : preview.isBinary ? (
            <PreviewMessage>二进制文件，无法预览</PreviewMessage>
          ) : preview.content ? (
            <PreviewContent>{preview.content}</PreviewContent>
          ) : (
            <PreviewMessage>无内容</PreviewMessage>
          )}
        </PreviewPanel>
      )}

      {/* 右键菜单 */}
      {contextMenu && (
        <FileContextMenu
          position={contextMenu.position}
          file={contextMenu.file}
          currentPath={currentPath}
          onClose={closeContextMenu}
          onRefresh={refresh}
          onNewFile={handleNewFile}
          onNewFolder={handleNewFolder}
          onRename={handleRename}
          onOpenTerminal={onOpenTerminal}
        />
      )}

      {/* 文件/文件夹名称编辑对话框 */}
      {entryManager && (
        <EntryManagerOverlay
          type={entryManager.type}
          initialValue={entryManager.initialValue}
          onSave={handleEntryManagerSave}
          onCancel={handleEntryManagerCancel}
        />
      )}
    </Container>
  );
});
