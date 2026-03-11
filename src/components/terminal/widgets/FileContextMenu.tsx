/**
 * 文件浏览器右键菜单组件
 *
 * 借鉴 Waveterm 的右键菜单功能，提供文件操作菜单
 * 包括新建、重命名、复制、删除、在 Finder 中显示等功能
 *
 * @module widgets/FileContextMenu
 */

import React, { memo, useCallback, useMemo, useEffect, useRef } from "react";
import styled from "styled-components";
import {
  openPathWithDefaultApp,
  revealPathInFinder,
} from "@/lib/api/fileSystem";
import { deletePath } from "@/lib/api/fileBrowser";
import {
  FilePlus,
  FolderPlus,
  Pencil,
  Copy,
  Clipboard,
  ExternalLink,
  FolderOpen,
  Terminal,
  Trash2,
} from "lucide-react";
import { FileEntry } from "./types";

// ============================================================================
// 类型定义
// ============================================================================

/** 菜单位置 */
export interface ContextMenuPosition {
  x: number;
  y: number;
}

/** 组件属性 */
export interface FileContextMenuProps {
  /** 菜单位置 */
  position: ContextMenuPosition;
  /** 选中的文件 */
  file: FileEntry | null;
  /** 当前目录路径 */
  currentPath: string;
  /** 关闭回调 */
  onClose: () => void;
  /** 刷新目录回调 */
  onRefresh: () => void;
  /** 新建文件回调 */
  onNewFile: () => void;
  /** 新建文件夹回调 */
  onNewFolder: () => void;
  /** 重命名回调 */
  onRename: (file: FileEntry) => void;
  /** 在新终端中打开回调 */
  onOpenTerminal?: (path: string) => void;
}

/** 菜单项 */
interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  disabled?: boolean;
  danger?: boolean;
  onClick: () => void;
}

/** 菜单分隔线 */
interface MenuDivider {
  id: string;
  type: "divider";
}

type MenuItemOrDivider = MenuItem | MenuDivider;

// ============================================================================
// 样式组件
// ============================================================================

const MenuContainer = styled.div`
  position: fixed;
  z-index: 9999;
  min-width: 200px;
  padding: 4px 0;
  background: rgb(30, 30, 30);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 6px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
`;

const MenuItemButton = styled.button<{
  $danger?: boolean;
  $disabled?: boolean;
}>`
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 12px;
  border: none;
  background: transparent;
  color: ${({ $danger, $disabled }) =>
    $disabled ? "#505050" : $danger ? "#e54d2e" : "#e0e0e0"};
  font-size: 13px;
  text-align: left;
  cursor: ${({ $disabled }) => ($disabled ? "not-allowed" : "pointer")};
  transition: background 0.1s ease;

  &:hover:not(:disabled) {
    background: ${({ $danger }) =>
      $danger ? "rgba(229, 77, 46, 0.15)" : "rgba(255, 255, 255, 0.08)"};
  }

  svg {
    width: 16px;
    height: 16px;
    opacity: 0.8;
  }
`;

const MenuItemLabel = styled.span`
  flex: 1;
`;

const MenuItemShortcut = styled.span`
  font-size: 11px;
  color: #606060;
`;

const MenuDividerLine = styled.div`
  height: 1px;
  margin: 4px 8px;
  background: rgba(255, 255, 255, 0.1);
`;

// ============================================================================
// 工具函数
// ============================================================================

/**
 * Shell 引用文件名
 */
function shellQuote(str: string): string {
  // 简单的 shell 引用实现
  if (/^[a-zA-Z0-9._/-]+$/.test(str)) {
    return str;
  }
  return `'${str.replace(/'/g, "'\\''")}'`;
}

// ============================================================================
// 主组件
// ============================================================================

/**
 * 文件浏览器右键菜单
 */
export const FileContextMenu = memo(function FileContextMenu({
  position,
  file,
  currentPath,
  onClose,
  onRefresh,
  onNewFile,
  onNewFolder,
  onRename,
  onOpenTerminal,
}: FileContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  // 点击外部关闭菜单
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // 调整菜单位置，确保不超出视口
  useEffect(() => {
    if (menuRef.current) {
      const menu = menuRef.current;
      const rect = menu.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      let x = position.x;
      let y = position.y;

      if (x + rect.width > viewportWidth) {
        x = viewportWidth - rect.width - 8;
      }

      if (y + rect.height > viewportHeight) {
        y = viewportHeight - rect.height - 8;
      }

      menu.style.left = `${x}px`;
      menu.style.top = `${y}px`;
    }
  }, [position]);

  // 复制文件名
  const handleCopyFileName = useCallback(async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.name);
    } catch (e) {
      console.error("[FileContextMenu] 复制文件名失败:", e);
    }
    onClose();
  }, [file, onClose]);

  // 复制完整路径
  const handleCopyFullPath = useCallback(async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(file.path);
    } catch (e) {
      console.error("[FileContextMenu] 复制完整路径失败:", e);
    }
    onClose();
  }, [file, onClose]);

  // 复制文件名（Shell 引用）
  const handleCopyFileNameQuoted = useCallback(async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(shellQuote(file.name));
    } catch (e) {
      console.error("[FileContextMenu] 复制文件名失败:", e);
    }
    onClose();
  }, [file, onClose]);

  // 复制完整路径（Shell 引用）
  const handleCopyFullPathQuoted = useCallback(async () => {
    if (!file) return;
    try {
      await navigator.clipboard.writeText(shellQuote(file.path));
    } catch (e) {
      console.error("[FileContextMenu] 复制完整路径失败:", e);
    }
    onClose();
  }, [file, onClose]);

  // 在 Finder 中显示
  const handleRevealInFinder = useCallback(async () => {
    const targetPath = file?.path || currentPath;
    try {
      await revealPathInFinder(targetPath);
    } catch (e) {
      console.error("[FileContextMenu] 在 Finder 中显示失败:", e);
    }
    onClose();
  }, [file, currentPath, onClose]);

  // 使用默认应用打开
  const handleOpenWithDefault = useCallback(async () => {
    if (!file || file.isDir) return;
    try {
      await openPathWithDefaultApp(file.path);
    } catch (e) {
      console.error("[FileContextMenu] 打开文件失败:", e);
    }
    onClose();
  }, [file, onClose]);

  // 在新终端中打开
  const handleOpenTerminal = useCallback(() => {
    const targetPath = file?.isDir ? file.path : currentPath;
    onOpenTerminal?.(targetPath);
    onClose();
  }, [file, currentPath, onOpenTerminal, onClose]);

  // 删除文件
  const handleDelete = useCallback(async () => {
    if (!file) return;

    const confirmMessage = file.isDir
      ? `确定要删除文件夹 "${file.name}" 及其所有内容吗？`
      : `确定要删除文件 "${file.name}" 吗？`;

    if (!window.confirm(confirmMessage)) {
      onClose();
      return;
    }

    try {
      await deletePath(file.path, file.isDir);
      onRefresh();
    } catch (e) {
      console.error("[FileContextMenu] 删除失败:", e);
      alert(`删除失败: ${e}`);
    }
    onClose();
  }, [file, onRefresh, onClose]);

  // 构建菜单项
  const menuItems: MenuItemOrDivider[] = useMemo(() => {
    const items: MenuItemOrDivider[] = [];

    // 新建文件
    items.push({
      id: "new-file",
      label: "新建文件",
      icon: <FilePlus />,
      onClick: () => {
        onNewFile();
        onClose();
      },
    });

    // 新建文件夹
    items.push({
      id: "new-folder",
      label: "新建文件夹",
      icon: <FolderPlus />,
      onClick: () => {
        onNewFolder();
        onClose();
      },
    });

    // 重命名（仅当选中文件时）
    if (file && file.name !== "..") {
      items.push({
        id: "rename",
        label: "重命名",
        icon: <Pencil />,
        onClick: () => {
          onRename(file);
          onClose();
        },
      });
    }

    items.push({ id: "divider-1", type: "divider" });

    // 复制相关（仅当选中文件时）
    if (file && file.name !== "..") {
      items.push({
        id: "copy-name",
        label: "复制文件名",
        icon: <Copy />,
        onClick: handleCopyFileName,
      });

      items.push({
        id: "copy-path",
        label: "复制完整路径",
        icon: <Clipboard />,
        onClick: handleCopyFullPath,
      });

      items.push({
        id: "copy-name-quoted",
        label: "复制文件名 (Shell 引用)",
        icon: <Copy />,
        onClick: handleCopyFileNameQuoted,
      });

      items.push({
        id: "copy-path-quoted",
        label: "复制完整路径 (Shell 引用)",
        icon: <Clipboard />,
        onClick: handleCopyFullPathQuoted,
      });

      items.push({ id: "divider-2", type: "divider" });
    }

    // 在 Finder 中显示
    items.push({
      id: "reveal-finder",
      label: "在 Finder 中显示",
      icon: <FolderOpen />,
      onClick: handleRevealInFinder,
    });

    // 使用默认应用打开（仅文件）
    if (file && !file.isDir && file.name !== "..") {
      items.push({
        id: "open-default",
        label: "使用默认应用打开",
        icon: <ExternalLink />,
        onClick: handleOpenWithDefault,
      });
    }

    // 在新终端中打开
    if (onOpenTerminal) {
      items.push({
        id: "open-terminal",
        label: "在新终端中打开",
        icon: <Terminal />,
        onClick: handleOpenTerminal,
      });
    }

    // 删除（仅当选中文件且不是 ".." 时）
    if (file && file.name !== "..") {
      items.push({ id: "divider-3", type: "divider" });

      items.push({
        id: "delete",
        label: "删除",
        icon: <Trash2 />,
        danger: true,
        onClick: handleDelete,
      });
    }

    return items;
  }, [
    file,
    onNewFile,
    onNewFolder,
    onRename,
    onOpenTerminal,
    onClose,
    handleCopyFileName,
    handleCopyFullPath,
    handleCopyFileNameQuoted,
    handleCopyFullPathQuoted,
    handleRevealInFinder,
    handleOpenWithDefault,
    handleOpenTerminal,
    handleDelete,
  ]);

  return (
    <MenuContainer
      ref={menuRef}
      style={{
        left: position.x,
        top: position.y,
      }}
    >
      {menuItems.map((item) =>
        "type" in item && item.type === "divider" ? (
          <MenuDividerLine key={item.id} />
        ) : (
          <MenuItemButton
            key={item.id}
            $danger={(item as MenuItem).danger}
            $disabled={(item as MenuItem).disabled}
            onClick={(item as MenuItem).onClick}
            disabled={(item as MenuItem).disabled}
          >
            {(item as MenuItem).icon}
            <MenuItemLabel>{(item as MenuItem).label}</MenuItemLabel>
            {(item as MenuItem).shortcut && (
              <MenuItemShortcut>{(item as MenuItem).shortcut}</MenuItemShortcut>
            )}
          </MenuItemButton>
        ),
      )}
    </MenuContainer>
  );
});

export default FileContextMenu;
