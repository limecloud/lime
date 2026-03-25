/**
 * @file TerminalPanel.tsx
 * @description 独立终端面板组件 - 用于分块布局中的附加终端
 * @module components/terminal/TerminalPanel
 *
 * 简化版终端组件，用于在分块布局中显示独立的终端实例。
 * 每个面板有自己的会话 ID 和 TermWrap 实例。
 * 借鉴 Waveterm 的右键菜单功能。
 */

import React, { useEffect, useRef, useCallback, useState } from "react";
import "@xterm/xterm/css/xterm.css";
import {
  createTerminalSession,
  closeTerminal,
  type SessionStatus,
} from "@/lib/api/terminal";
import { TermWrap } from "./termwrap";
import {
  loadThemePreference,
  loadFontSizePreference,
  saveFontSizePreference,
  saveThemePreference,
  getTheme,
  type ThemeName,
} from "@/lib/terminal/themes";
import {
  TerminalContextMenu,
  type ContextMenuPosition,
} from "./widgets/TerminalContextMenu";
import { resolveTerminalPageHotkeyAction } from "./terminalPageHotkeys";
import "./terminal.css";

interface TerminalPanelProps {
  /** 面板 ID */
  panelId: string;
  /** 工作目录（可选） */
  cwd?: string;
  /** 会话创建完成回调 */
  onSessionCreated?: (sessionId: string) => void;
  /** 状态变化回调 */
  onStatusChange?: (status: SessionStatus) => void;
  /** 水平分割回调 */
  onSplitHorizontal?: () => void;
  /** 垂直分割回调 */
  onSplitVertical?: () => void;
}

/**
 * 独立终端面板组件
 */
export function TerminalPanel({
  panelId,
  cwd,
  onSessionCreated,
  onStatusChange,
  onSplitHorizontal,
  onSplitVertical,
}: TerminalPanelProps) {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  // 右键菜单状态
  const [contextMenu, setContextMenu] = useState<{
    position: ContextMenuPosition;
  } | null>(null);

  // 终端设置状态
  const [fontSize, setFontSize] = useState(loadFontSizePreference());
  const [themeName, setThemeName] = useState(loadThemePreference());

  const connectElemRef = useRef<HTMLDivElement>(null);
  const termWrapRef = useRef<TermWrap | null>(null);

  // 创建终端会话
  const createSession = useCallback(async () => {
    if (isCreating || sessionId) return;

    setIsCreating(true);
    setError(null);

    try {
      const newSessionId = await createTerminalSession(cwd);
      console.log(
        `[TerminalPanel ${panelId}] 会话已创建:`,
        newSessionId,
        cwd ? `(cwd: ${cwd})` : "",
      );
      setSessionId(newSessionId);
      onSessionCreated?.(newSessionId);
    } catch (err) {
      console.error(`[TerminalPanel ${panelId}] 创建终端失败:`, err);
      setError("创建终端会话失败");
    } finally {
      setIsCreating(false);
    }
  }, [isCreating, sessionId, panelId, cwd, onSessionCreated]);

  // 首次挂载时创建会话
  useEffect(() => {
    createSession();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 键盘事件处理器
  const handleTerminalKeydown = useCallback((e: KeyboardEvent): boolean => {
    if (e.type !== "keydown") return true;

    const termWrap = termWrapRef.current;
    if (!termWrap) return true;

    const action = resolveTerminalPageHotkeyAction(e);

    if (action === "scroll-to-bottom") {
      termWrap.terminal.scrollToBottom();
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (action === "scroll-to-top") {
      termWrap.terminal.scrollToLine(0);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (action === "scroll-page-down") {
      termWrap.terminal.scrollPages(1);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    if (action === "scroll-page-up") {
      termWrap.terminal.scrollPages(-1);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    return true;
  }, []);

  // 使用 ref 存储回调，避免回调变化导致终端重建
  const onStatusChangeRef = useRef(onStatusChange);
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // 当 sessionId 变化时，创建 TermWrap
  // 注意：只依赖 sessionId 和 handleTerminalKeydown，避免回调变化导致终端重建
  useEffect(() => {
    const container = connectElemRef.current;
    if (!container || !sessionId) {
      if (termWrapRef.current) {
        termWrapRef.current.dispose();
        termWrapRef.current = null;
      }
      return;
    }

    // 如果已有 TermWrap 且 sessionId 相同，不重建
    if (termWrapRef.current) {
      return;
    }

    // 清空容器
    container.innerHTML = "";

    // 创建新的 TermWrap
    const termWrap = new TermWrap(sessionId, container, {
      onStatusChange: (status) => onStatusChangeRef.current?.(status),
      themeName: loadThemePreference(),
      fontSize: loadFontSizePreference(),
      keydownHandler: handleTerminalKeydown,
    });

    termWrapRef.current = termWrap;

    // 设置 ResizeObserver
    const rszObs = new ResizeObserver(() => {
      termWrap.handleResize_debounced();
    });
    rszObs.observe(container);

    // 异步初始化终端
    termWrap.initTerminal().catch(console.error);

    // 自动聚焦
    setTimeout(() => termWrap.focus(), 10);

    return () => {
      termWrap.dispose();
      rszObs.disconnect();
    };
  }, [sessionId, handleTerminalKeydown]);

  // 组件卸载时关闭会话
  useEffect(() => {
    return () => {
      if (sessionId) {
        closeTerminal(sessionId).catch(console.error);
      }
    };
  }, [sessionId]);

  // 右键菜单处理
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      position: { x: e.clientX, y: e.clientY },
    });
  }, []);

  // 关闭右键菜单
  const closeContextMenu = useCallback(() => {
    setContextMenu(null);
  }, []);

  // 复制选中文本
  const handleCopy = useCallback(() => {
    const selection = termWrapRef.current?.terminal?.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    }
  }, []);

  // 粘贴
  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && termWrapRef.current) {
        // 通过终端发送粘贴的文本
        termWrapRef.current.sendData(text);
      }
    } catch (e) {
      console.error("[TerminalPanel] 粘贴失败:", e);
    }
  }, []);

  // 清屏
  const handleClear = useCallback(() => {
    termWrapRef.current?.terminal?.clear();
  }, []);

  // 获取选中文本
  const getSelection = useCallback(() => {
    return termWrapRef.current?.terminal?.getSelection() || null;
  }, []);

  // 检查是否有选中文本
  const hasSelection = useCallback(() => {
    return termWrapRef.current?.terminal?.hasSelection() || false;
  }, []);

  // 字体大小变化
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
    saveFontSizePreference(size);
    if (termWrapRef.current?.terminal) {
      termWrapRef.current.terminal.options.fontSize = size;
      termWrapRef.current.handleResize_debounced();
    }
  }, []);

  // 主题变化
  const handleThemeChange = useCallback((theme: ThemeName) => {
    setThemeName(theme);
    saveThemePreference(theme);
    if (termWrapRef.current?.terminal) {
      const themeConfig = getTheme(theme);
      termWrapRef.current.terminal.options.theme = themeConfig;
    }
  }, []);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1a1a1a] text-red-400 text-sm">
        {error}
      </div>
    );
  }

  if (isCreating || !sessionId) {
    return (
      <div className="flex items-center justify-center h-full bg-[#1a1a1a] text-gray-400 text-sm">
        正在创建终端...
      </div>
    );
  }

  return (
    <div
      ref={connectElemRef}
      className="term-connectelem"
      style={{ height: "100%", width: "100%" }}
      onClick={() => termWrapRef.current?.focus()}
      onContextMenu={handleContextMenu}
    >
      {/* 右键菜单 */}
      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu.position}
          onClose={closeContextMenu}
          hasSelection={hasSelection()}
          getSelection={getSelection}
          onCopy={handleCopy}
          onPaste={handlePaste}
          onClear={handleClear}
          onFontSizeChange={handleFontSizeChange}
          currentFontSize={fontSize}
          onThemeChange={handleThemeChange}
          currentTheme={themeName}
          onSplitHorizontal={onSplitHorizontal}
          onSplitVertical={onSplitVertical}
        />
      )}
    </div>
  );
}

export default TerminalPanel;
