/**
 * @file TerminalView.tsx
 * @description 终端视图组件 - 使用 Jotai 原子状态
 * @module components/terminal/TerminalView
 *
 * 重构后的终端视图组件，使用 Jotai 进行状态管理。
 * 对齐 waveterm 的 TerminalView 架构。
 *
 * ## 功能
 * - 使用 TermViewModel 管理状态
 * - 连接状态显示和重连
 * - 上下文菜单
 * - 多输入模式支持
 * - VDOM 模式支持
 * - 贴纸系统支持
 *
 * _Requirements: 9.7, 7.3, 7.4, 7.5, 10.1, 10.2, 10.3, 10.4, 10.5, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 14.1, 14.2, 15.1, 15.2, 15.3, 15.4_
 */

import React, {
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useState,
} from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { TermWrap } from "./termwrap";
import { TerminalSearch } from "./TerminalSearch";
import {
  TerminalContextMenu,
  type ContextMenuPosition,
} from "./TerminalContextMenu";
import { ConnectionStatusIndicator } from "./ConnectionStatusIndicator";
import { MultiInputIndicator } from "./MultiInputIndicator";
import { VDomView } from "./VDomView";
import { VDomModeToggle } from "./VDomModeSwitch";
import { StickerLayer } from "./StickerLayer";
import { cleanupStickerStateAtom } from "@/lib/terminal/stickers";
import {
  getOrCreateTermViewModel,
  cleanupTermViewModel,
  useControllerStatusSync,
  useConnStatusSync,
  setTermModeAtom,
  setConnStatusAtom,
  setFontSizeAtom,
  setThemeNameAtom,
  cleanupTerminalStateAtom,
  type TermMode,
} from "@/lib/terminal/store";
import { cleanupVDomStateAtom } from "@/lib/terminal/vdom";
import {
  writeToTerminalRaw,
  encodeBase64,
  type SessionStatus,
} from "@/lib/api/terminal";
import {
  type ThemeName,
  loadThemePreference,
  loadFontSizePreference,
  getTheme,
} from "@/lib/terminal/themes";
import "./terminal.css";

// ============================================================================
// 类型定义
// ============================================================================

/** TerminalView 属性 */
export interface TerminalViewProps {
  /** 块 ID（会话 ID） */
  blockId: string;
  /** 标签页 ID */
  tabId: string;
  /** 连接名称（可选，用于 SSH/WSL） */
  connection?: string;
  /** 是否显示搜索栏 */
  showSearch?: boolean;
  /** 搜索栏关闭回调 */
  onSearchClose?: () => void;
  /** 状态变化回调 */
  onStatusChange?: (status: SessionStatus) => void;
  /** 是否启用多输入模式 */
  multiInputEnabled?: boolean;
  /** 多输入模式切换回调 */
  onMultiInputToggle?: () => void;
  /** 初始主题 */
  initialTheme?: ThemeName;
  /** 初始字体大小 */
  initialFontSize?: number;
  /** 初始终端模式
   * _Requirements: 14.1_
   */
  initialTermMode?: TermMode;
  /** 是否显示模式切换按钮
   * _Requirements: 14.2_
   */
  showModeSwitch?: boolean;
  /** 模式变更回调 */
  onModeChange?: (mode: TermMode) => void;
  /** 是否显示贴纸层
   * _Requirements: 15.1_
   */
  showStickers?: boolean;
}

// ============================================================================
// TerminalView 组件
// ============================================================================

/**
 * 终端视图组件
 *
 * 使用 Jotai 原子状态管理，对齐 waveterm 架构。
 *
 * _Requirements: 9.7_
 */
export const TerminalView: React.FC<TerminalViewProps> = ({
  blockId,
  tabId,
  connection,
  showSearch = false,
  onSearchClose,
  onStatusChange,
  multiInputEnabled = false,
  onMultiInputToggle,
  initialTheme,
  initialFontSize,
  initialTermMode = "term",
  showModeSwitch = false,
  onModeChange,
  showStickers = true,
}) => {
  // 获取 TermViewModel
  const viewModel = useMemo(
    () => getOrCreateTermViewModel(blockId, tabId),
    [blockId, tabId],
  );

  // 订阅后端事件
  useControllerStatusSync(blockId);
  useConnStatusSync(blockId, connection);

  // 读取原子状态
  const termMode = useAtomValue(viewModel.termModeAtom);
  const connStatus = useAtomValue(viewModel.connStatusAtom);
  const fontSize = useAtomValue(viewModel.fontSizeAtom);
  const themeName = useAtomValue(viewModel.termThemeNameAtom);
  const shellProcStatus = useAtomValue(viewModel.shellProcStatusAtom);
  const _isConnected = useAtomValue(viewModel.isConnectedAtom);
  const _isRunning = useAtomValue(viewModel.isRunningAtom);
  const _isDone = useAtomValue(viewModel.isDoneAtom);
  const _hasError = useAtomValue(viewModel.hasErrorAtom);
  const exitCode = useAtomValue(viewModel.exitCodeAtom);

  // 设置原子状态的 actions
  const setTermMode = useSetAtom(setTermModeAtom);
  const _setConnStatus = useSetAtom(setConnStatusAtom);
  const setFontSize = useSetAtom(setFontSizeAtom);
  const setThemeName = useSetAtom(setThemeNameAtom);
  const cleanupState = useSetAtom(cleanupTerminalStateAtom);
  const cleanupVDom = useSetAtom(cleanupVDomStateAtom);
  const cleanupStickers = useSetAtom(cleanupStickerStateAtom);

  // 本地状态
  const [contextMenu, setContextMenu] = useState<ContextMenuPosition | null>(
    null,
  );

  // Refs
  const connectElemRef = useRef<HTMLDivElement>(null);
  const termWrapRef = useRef<TermWrap | null>(null);
  // 使用 ref 存储回调，避免回调变化导致终端重建
  const onStatusChangeRef = useRef(onStatusChange);

  // 更新回调 ref
  useEffect(() => {
    onStatusChangeRef.current = onStatusChange;
  }, [onStatusChange]);

  // 初始化主题和字体大小
  useEffect(() => {
    const theme = initialTheme ?? loadThemePreference();
    const size = initialFontSize ?? loadFontSizePreference();
    setThemeName({ blockId, themeName: theme });
    setFontSize({ blockId, fontSize: size });
    // 初始化终端模式
    // _Requirements: 14.1_
    setTermMode({ blockId, mode: initialTermMode });
  }, [
    blockId,
    initialTheme,
    initialFontSize,
    initialTermMode,
    setThemeName,
    setFontSize,
    setTermMode,
  ]);

  // ============================================================================
  // 键盘事件处理器（对齐 waveterm 的 handleTerminalKeydown）
  // 返回 true = 允许事件传递到终端
  // 返回 false = 阻止事件传递到终端（已处理）
  // ============================================================================

  const handleTerminalKeydown = useCallback((e: KeyboardEvent): boolean => {
    // 只处理 keydown 事件
    if (e.type !== "keydown") {
      return true;
    }

    const termWrap = termWrapRef.current;
    if (!termWrap) return true;

    const isMac = /mac/i.test(navigator.userAgent);

    // Shift+End - 滚动到底部
    if (
      e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "End"
    ) {
      termWrap.terminal.scrollToBottom();
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Shift+Home - 滚动到顶部
    if (
      e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "Home"
    ) {
      termWrap.terminal.scrollToLine(0);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+End (macOS) - 滚动到底部
    if (
      isMac &&
      e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key === "End"
    ) {
      termWrap.terminal.scrollToBottom();
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Cmd+Home (macOS) - 滚动到顶部
    if (
      isMac &&
      e.metaKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.shiftKey &&
      e.key === "Home"
    ) {
      termWrap.terminal.scrollToLine(0);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Shift+PageDown - 向下滚动一页
    if (
      e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "PageDown"
    ) {
      termWrap.terminal.scrollPages(1);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // Shift+PageUp - 向上滚动一页
    if (
      e.shiftKey &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey &&
      e.key === "PageUp"
    ) {
      termWrap.terminal.scrollPages(-1);
      e.preventDefault();
      e.stopPropagation();
      return false;
    }

    // 未处理的事件，允许传递到终端
    return true;
  }, []);

  // ============================================================================
  // TermWrap 生命周期管理
  // 注意：只依赖 blockId，避免主题/字体/回调变化导致终端重建
  // ============================================================================

  useEffect(() => {
    const container = connectElemRef.current;
    if (!container) return;

    // 如果已有 TermWrap，不重建
    if (termWrapRef.current) {
      return;
    }

    // 清空容器
    container.innerHTML = "";

    // 创建新的 TermWrap
    const termWrap = new TermWrap(blockId, container, {
      onStatusChange: (status) => {
        onStatusChangeRef.current?.(status);
      },
      themeName: themeName as ThemeName,
      fontSize: fontSize,
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
      termWrapRef.current = null;
      rszObs.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blockId]);

  // 主题变化时更新终端（不重建）
  useEffect(() => {
    if (termWrapRef.current?.terminal) {
      const themeConfig = getTheme(themeName as ThemeName);
      termWrapRef.current.terminal.options.theme = themeConfig;
    }
  }, [themeName]);

  // 字体大小变化时更新终端（不重建）
  useEffect(() => {
    if (termWrapRef.current?.terminal) {
      termWrapRef.current.terminal.options.fontSize = fontSize;
      termWrapRef.current.handleResize_debounced();
    }
  }, [fontSize]);

  // 清理 TermViewModel
  useEffect(() => {
    return () => {
      cleanupTermViewModel(blockId, tabId);
      cleanupState(blockId);
      cleanupVDom(blockId);
      cleanupStickers(blockId);
    };
  }, [blockId, tabId, cleanupState, cleanupVDom, cleanupStickers]);

  // ============================================================================
  // 搜索功能
  // ============================================================================

  const handleSearch = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      if (!termWrapRef.current) return false;
      return termWrapRef.current.search(term, options);
    },
    [],
  );

  const handleSearchNext = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      if (!termWrapRef.current) return false;
      return termWrapRef.current.searchNext(term, options);
    },
    [],
  );

  const handleSearchPrevious = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      if (!termWrapRef.current) return false;
      return termWrapRef.current.searchPrevious(term, options);
    },
    [],
  );

  const handleClearSearch = useCallback(() => {
    termWrapRef.current?.clearSearch();
  }, []);

  const handleSearchClose = useCallback(() => {
    handleClearSearch();
    onSearchClose?.();
  }, [handleClearSearch, onSearchClose]);

  // ============================================================================
  // 上下文菜单
  // _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
  // ============================================================================

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
    });
  }, []);

  const handleContextMenuClose = useCallback(() => {
    setContextMenu(null);
  }, []);

  const handleCopy = useCallback(() => {
    const selection = termWrapRef.current?.terminal.getSelection();
    if (selection) {
      navigator.clipboard.writeText(selection);
    }
    setContextMenu(null);
  }, []);

  const handlePaste = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && termWrapRef.current) {
        const base64 = encodeBase64(text);
        await writeToTerminalRaw(blockId, base64);
      }
    } catch (err) {
      console.error("[TerminalView] 粘贴失败:", err);
    }
    setContextMenu(null);
  }, [blockId]);

  const getSelectedText = useCallback(() => {
    return termWrapRef.current?.terminal.getSelection() ?? "";
  }, []);

  // ============================================================================
  // 重连功能
  // _Requirements: 7.4, 7.5_
  // ============================================================================

  const handleReconnect = useCallback(async () => {
    // TODO: 实现重连逻辑，调用后端 resync_controller
    console.log("[TerminalView] 重连请求:", blockId);
  }, [blockId]);

  // ============================================================================
  // 模式切换处理
  // _Requirements: 14.1, 14.2_
  // ============================================================================

  const handleModeChange = useCallback(
    (mode: TermMode) => {
      setTermMode({ blockId, mode });
      onModeChange?.(mode);
    },
    [blockId, setTermMode, onModeChange],
  );

  const handleSwitchToTerminal = useCallback(() => {
    handleModeChange("term");
    // 聚焦终端
    setTimeout(() => termWrapRef.current?.focus(), 10);
  }, [handleModeChange]);

  // ============================================================================
  // 聚焦处理
  // ============================================================================

  const handleContainerClick = useCallback(() => {
    termWrapRef.current?.focus();
  }, []);

  // ============================================================================
  // 渲染
  // ============================================================================

  // VDOM 模式渲染
  // _Requirements: 14.1, 14.2_
  if (termMode === "vdom") {
    return (
      <div className="terminal-view">
        <VDomView
          blockId={blockId}
          tabId={tabId}
          onSwitchToTerminal={handleSwitchToTerminal}
        />
      </div>
    );
  }

  // 终端模式渲染
  return (
    <div className="terminal-view" onContextMenu={handleContextMenu}>
      {/* 连接状态指示器
       * _Requirements: 7.3, 7.4, 7.5_
       */}
      <ConnectionStatusIndicator
        connStatus={connStatus}
        shellProcStatus={shellProcStatus}
        exitCode={exitCode}
        onReconnect={handleReconnect}
      />

      {/* 多输入模式指示器
       * _Requirements: 10.3, 10.4_
       */}
      {multiInputEnabled && (
        <MultiInputIndicator onToggle={onMultiInputToggle} />
      )}

      {/* 模式切换按钮
       * _Requirements: 14.2_
       */}
      {showModeSwitch && (
        <div className="terminal-mode-switch-container">
          <VDomModeToggle blockId={blockId} onModeChange={handleModeChange} />
        </div>
      )}

      {/* 搜索栏 */}
      {showSearch && (
        <TerminalSearch
          visible={showSearch}
          onClose={handleSearchClose}
          onSearch={handleSearch}
          onSearchNext={handleSearchNext}
          onSearchPrevious={handleSearchPrevious}
          onClearSearch={handleClearSearch}
        />
      )}

      {/* 终端容器 */}
      <div
        ref={connectElemRef}
        className="term-connectelem"
        onClick={handleContainerClick}
      />

      {/* 贴纸层
       * _Requirements: 15.1, 15.2, 15.3, 15.4_
       */}
      {showStickers && (
        <StickerLayer blockId={blockId} terminalRef={connectElemRef} />
      )}

      {/* 上下文菜单
       * _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6_
       */}
      {contextMenu && (
        <TerminalContextMenu
          position={contextMenu}
          onClose={handleContextMenuClose}
          onCopy={handleCopy}
          onPaste={handlePaste}
          selectedText={getSelectedText()}
          blockId={blockId}
        />
      )}
    </div>
  );
};

export default TerminalView;
