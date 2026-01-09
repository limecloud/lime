/**
 * @file TerminalPage.tsx
 * @description 内置终端页面组件 - 多容器架构保持状态
 * @module components/terminal/TerminalPage
 *
 * ## 架构说明
 * - 每个标签页有独立的终端容器和 TermWrap 实例
 * - 切换标签页时，只是显示/隐藏对应的容器
 * - 保持所有终端的状态，不销毁 TermWrap
 *
 * _Requirements: 8.7, 8.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6_
 */

import React, { useEffect, useRef, useState, useCallback } from "react";
import "@xterm/xterm/css/xterm.css";
import {
  createTerminalSession,
  closeTerminal,
  type SessionStatus,
} from "@/lib/terminal-api";
import { TermWrap } from "./termwrap";
import { TerminalSearch } from "./TerminalSearch";
import {
  type ThemeName,
  getThemeList,
  saveThemePreference,
  loadThemePreference,
  saveFontSizePreference,
  loadFontSizePreference,
  MIN_FONT_SIZE,
  MAX_FONT_SIZE,
} from "@/lib/terminal/themes";
import "./terminal.css";

// ============================================================================
// 类型定义
// ============================================================================

/** 标签页数据 */
interface Tab {
  id: string;
  sessionId: string;
  title: string;
  status: SessionStatus;
  isSSH?: boolean;
  termWrap?: TermWrap; // 保持 TermWrap 实例
}

// ============================================================================
// 子组件
// ============================================================================

/** 状态指示器 */
const StatusIndicator: React.FC<{ status: SessionStatus }> = ({ status }) => {
  const statusClasses: Record<SessionStatus, string> = {
    connecting: "connecting",
    running: "running",
    done: "done",
    error: "error",
  };
  return (
    <span
      className={`terminal-status-indicator ${statusClasses[status] || ""}`}
      title={status}
    />
  );
};

/** 终端图标 */
const TerminalIcon: React.FC<{ isSSH?: boolean; className?: string }> = ({
  isSSH,
  className,
}) => (
  <svg
    className={className || "w-4 h-4 mr-2 flex-shrink-0"}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {isSSH ? (
      <>
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </>
    ) : (
      <>
        <polyline points="4 17 10 11 4 5" />
        <line x1="12" y1="19" x2="20" y2="19" />
      </>
    )}
  </svg>
);

/** 关闭按钮 */
const CloseButton: React.FC<{ onClick: (e: React.MouseEvent) => void }> = ({
  onClick,
}) => (
  <button className="terminal-close-btn" onClick={onClick} title="关闭标签页">
    <svg
      className="w-3.5 h-3.5"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  </button>
);

/** 新建标签按钮 */
const NewTabButton: React.FC<{ onClick: () => void; disabled?: boolean }> = ({
  onClick,
  disabled,
}) => (
  <button
    className="terminal-new-tab-btn"
    onClick={onClick}
    disabled={disabled}
    title="新建终端"
  >
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  </button>
);

/** 搜索按钮 */
const SearchButton: React.FC<{ onClick: () => void }> = ({ onClick }) => (
  <button
    className="terminal-new-tab-btn"
    onClick={onClick}
    title="搜索 (Ctrl+F)"
  >
    <svg
      className="w-4 h-4"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <circle cx="11" cy="11" r="8" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  </button>
);

/** 主题选择器
 * _Requirements: 12.1, 12.4_
 */
const ThemeSelector: React.FC<{
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
}> = ({ currentTheme, onThemeChange }) => {
  const [isOpen, setIsOpen] = useState(false);
  const themes = getThemeList();

  return (
    <div className="relative">
      <button
        className="terminal-new-tab-btn"
        onClick={() => setIsOpen(!isOpen)}
        title="切换主题"
      >
        <svg
          className="w-4 h-4"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <circle cx="12" cy="12" r="5" />
          <line x1="12" y1="1" x2="12" y2="3" />
          <line x1="12" y1="21" x2="12" y2="23" />
          <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
          <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
          <line x1="1" y1="12" x2="3" y2="12" />
          <line x1="21" y1="12" x2="23" y2="12" />
          <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
          <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
        </svg>
      </button>
      {isOpen && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setIsOpen(false)}
          />
          <div className="terminal-theme-dropdown">
            {themes.map((theme) => (
              <div
                key={theme.name}
                className={`terminal-theme-item ${theme.name === currentTheme ? "active" : ""}`}
                onClick={() => {
                  onThemeChange(theme.name);
                  setIsOpen(false);
                }}
              >
                <div
                  className="terminal-theme-preview"
                  style={{ backgroundColor: theme.theme.background }}
                />
                {theme.displayName}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

/** 字体大小调整器
 * _Requirements: 8.8_
 */
const FontSizeControl: React.FC<{
  fontSize: number;
  onFontSizeChange: (size: number) => void;
}> = ({ fontSize, onFontSizeChange }) => {
  const handleDecrease = () => {
    if (fontSize > MIN_FONT_SIZE) {
      onFontSizeChange(fontSize - 1);
    }
  };

  const handleIncrease = () => {
    if (fontSize < MAX_FONT_SIZE) {
      onFontSizeChange(fontSize + 1);
    }
  };

  return (
    <div className="terminal-font-size-control">
      <button
        className="terminal-font-size-btn"
        onClick={handleDecrease}
        disabled={fontSize <= MIN_FONT_SIZE}
        title="减小字体 (Ctrl+-)"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
      <span className="terminal-font-size-value" title="字体大小">
        {fontSize}
      </span>
      <button
        className="terminal-font-size-btn"
        onClick={handleIncrease}
        disabled={fontSize >= MAX_FONT_SIZE}
        title="增大字体 (Ctrl++)"
      >
        <svg
          className="w-3 h-3"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
      </button>
    </div>
  );
};

/** 标签页组件 */
const TabItem: React.FC<{
  tab: Tab;
  isActive: boolean;
  onSelect: () => void;
  onClose: () => void;
}> = ({ tab, isActive, onSelect, onClose }) => {
  const handleClose = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      onClose();
    },
    [onClose],
  );

  return (
    <div
      className={`terminal-tab ${isActive ? "active" : ""}`}
      onClick={onSelect}
      role="tab"
      aria-selected={isActive}
    >
      <StatusIndicator status={tab.status} />
      <TerminalIcon isSSH={tab.isSSH} />
      <span className="truncate flex-1 text-left">{tab.title}</span>
      <CloseButton onClick={handleClose} />
    </div>
  );
};

/** 标签栏组件 */
const TerminalTabs: React.FC<{
  tabs: Tab[];
  activeTabId: string | null;
  onTabSelect: (id: string) => void;
  onTabClose: (id: string) => void;
  onNewTab: () => void;
  onSearchClick: () => void;
  currentTheme: ThemeName;
  onThemeChange: (theme: ThemeName) => void;
  fontSize: number;
  onFontSizeChange: (size: number) => void;
  isCreating?: boolean;
}> = ({
  tabs,
  activeTabId,
  onTabSelect,
  onTabClose,
  onNewTab,
  onSearchClick,
  currentTheme,
  onThemeChange,
  fontSize,
  onFontSizeChange,
  isCreating,
}) => (
  <div className="terminal-tabbar" role="tablist">
    <div className="flex items-center flex-1 overflow-x-auto h-full">
      {tabs.map((tab) => (
        <TabItem
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          onSelect={() => onTabSelect(tab.id)}
          onClose={() => onTabClose(tab.id)}
        />
      ))}
    </div>
    <SearchButton onClick={onSearchClick} />
    <FontSizeControl fontSize={fontSize} onFontSizeChange={onFontSizeChange} />
    <ThemeSelector currentTheme={currentTheme} onThemeChange={onThemeChange} />
    <NewTabButton onClick={onNewTab} disabled={isCreating} />
  </div>
);

/** 空状态占位符 */
const EmptyTabsPlaceholder: React.FC<{
  onNewTab: () => void;
  isCreating?: boolean;
}> = ({ onNewTab, isCreating }) => (
  <div className="terminal-empty-state">
    <TerminalIcon className="terminal-empty-state-icon" />
    <p className="terminal-empty-state-text">没有打开的终端</p>
    <button
      className="terminal-empty-state-btn"
      onClick={onNewTab}
      disabled={isCreating}
    >
      {isCreating ? "创建中..." : "新建终端"}
    </button>
  </div>
);

// ============================================================================
// 主组件 - 多容器架构保持状态
// ============================================================================

export function TerminalPage() {
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [currentTheme, setCurrentTheme] = useState<ThemeName>(
    loadThemePreference(),
  );
  // 字体大小状态
  // _Requirements: 8.8_
  const [fontSize, setFontSize] = useState<number>(loadFontSizePreference());
  const tabIdCounter = useRef(0);

  // 终端容器的父容器引用
  const terminalContainerRef = useRef<HTMLDivElement>(null);

  // 获取当前活动的标签页
  const activeTab = tabs.find((t) => t.id === activeTabId);

  // 获取当前活动的 TermWrap
  const getActiveTermWrap = useCallback(() => {
    return activeTab?.termWrap || null;
  }, [activeTab]);

  // 创建新终端
  const handleNewTerminal = useCallback(async () => {
    if (isCreating) return;

    setIsCreating(true);
    setError(null);

    try {
      // 先调用后端创建会话
      const sessionId = await createTerminalSession();
      console.log("[TerminalPage] 会话已创建:", sessionId);

      // 创建成功后添加标签页
      const newTabId = `tab-${++tabIdCounter.current}`;
      const newTab: Tab = {
        id: newTabId,
        sessionId,
        title: "Terminal",
        status: "running",
        isSSH: false,
      };

      setTabs((prev) => [...prev, newTab]);
      setActiveTabId(newTabId);
    } catch (err) {
      console.error("[TerminalPage] 创建终端失败:", err);
      setError("创建终端会话失败");
    } finally {
      setIsCreating(false);
    }
  }, [isCreating]);

  // 状态变化
  const handleStatusChange = useCallback(
    (tabId: string, status: SessionStatus) => {
      setTabs((prev) =>
        prev.map((tab) => (tab.id === tabId ? { ...tab, status } : tab)),
      );
    },
    [],
  );

  // 关闭会话
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      const tab = tabs.find((t) => t.id === tabId);
      if (tab) {
        try {
          // 销毁 TermWrap
          if (tab.termWrap) {
            tab.termWrap.dispose();
          }
          // 关闭后端会话
          await closeTerminal(tab.sessionId);
        } catch (err) {
          console.error("[TerminalPage] 关闭终端会话失败:", err);
        }
      }

      setTabs((prev) => {
        const remaining = prev.filter((t) => t.id !== tabId);
        // 如果关闭的是当前活动标签，切换到最后一个
        if (activeTabId === tabId && remaining.length > 0) {
          setActiveTabId(remaining[remaining.length - 1].id);
        } else if (remaining.length === 0) {
          setActiveTabId(null);
        }
        return remaining;
      });
    },
    [tabs, activeTabId],
  );

  // 主题变化
  const handleThemeChange = useCallback((theme: ThemeName) => {
    setCurrentTheme(theme);
    saveThemePreference(theme);
    // 更新所有终端的主题
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.termWrap) {
          tab.termWrap.setTheme(theme);
        }
        return tab;
      }),
    );
  }, []);

  // 字体大小变化
  // _Requirements: 8.8_
  const handleFontSizeChange = useCallback((size: number) => {
    setFontSize(size);
    saveFontSizePreference(size);
    // 更新所有终端的字体大小
    setTabs((prev) =>
      prev.map((tab) => {
        if (tab.termWrap) {
          tab.termWrap.setFontSize(size);
        }
        return tab;
      }),
    );
  }, []);

  // 搜索功能
  const handleSearch = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      const termWrap = getActiveTermWrap();
      if (!termWrap) return false;
      return termWrap.search(term, options);
    },
    [getActiveTermWrap],
  );

  const handleSearchNext = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      const termWrap = getActiveTermWrap();
      if (!termWrap) return false;
      return termWrap.searchNext(term, options);
    },
    [getActiveTermWrap],
  );

  const handleSearchPrevious = useCallback(
    (term: string, options: import("@xterm/addon-search").ISearchOptions) => {
      const termWrap = getActiveTermWrap();
      if (!termWrap) return false;
      return termWrap.searchPrevious(term, options);
    },
    [getActiveTermWrap],
  );

  const handleClearSearch = useCallback(() => {
    const termWrap = getActiveTermWrap();
    if (termWrap) {
      termWrap.clearSearch();
    }
  }, [getActiveTermWrap]);

  // 键盘快捷键
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+F 打开搜索
      if ((e.ctrlKey || e.metaKey) && e.key === "f") {
        e.preventDefault();
        setShowSearch(true);
      }
      // Ctrl++ 或 Ctrl+= 增大字体
      // _Requirements: 8.8_
      if ((e.ctrlKey || e.metaKey) && (e.key === "+" || e.key === "=")) {
        e.preventDefault();
        handleFontSizeChange(Math.min(fontSize + 1, MAX_FONT_SIZE));
      }
      // Ctrl+- 减小字体
      // _Requirements: 8.8_
      if ((e.ctrlKey || e.metaKey) && e.key === "-") {
        e.preventDefault();
        handleFontSizeChange(Math.max(fontSize - 1, MIN_FONT_SIZE));
      }
      // Ctrl+0 重置字体大小
      if ((e.ctrlKey || e.metaKey) && e.key === "0") {
        e.preventDefault();
        handleFontSizeChange(14);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [fontSize, handleFontSizeChange]);

  // 清除错误
  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  // 首次挂载时自动创建一个终端
  useEffect(() => {
    if (tabs.length === 0 && !isCreating) {
      handleNewTerminal();
    }
    // 只在首次挂载时执行
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================================
  // 核心：为每个标签页创建独立的终端容器和 TermWrap
  // ============================================================================

  // 键盘事件处理器
  // 返回 true = 允许事件传递到终端
  // 返回 false = 阻止事件传递到终端（已处理）
  const handleTerminalKeydown = useCallback(
    (e: KeyboardEvent): boolean => {
      // 只处理 keydown 事件
      if (e.type !== "keydown") {
        return true;
      }

      const termWrap = getActiveTermWrap();
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
    },
    [getActiveTermWrap],
  );

  // 为新标签页创建终端
  useEffect(() => {
    const container = terminalContainerRef.current;
    if (!container) return;

    // 为每个没有 termWrap 的标签页创建终端
    tabs.forEach((tab) => {
      if (tab.termWrap) return; // 已有 TermWrap，跳过

      // 创建独立的容器
      const termContainer = document.createElement("div");
      termContainer.className = "term-connectelem";
      termContainer.dataset.tabId = tab.id;
      termContainer.style.display = tab.id === activeTabId ? "block" : "none";
      container.appendChild(termContainer);

      // 创建 TermWrap
      const termWrap = new TermWrap(tab.sessionId, termContainer, {
        onStatusChange: (status) => handleStatusChange(tab.id, status),
        themeName: currentTheme,
        fontSize: fontSize,
        keydownHandler: handleTerminalKeydown,
      });

      // 保存到标签页
      tab.termWrap = termWrap;

      // 设置 ResizeObserver
      const rszObs = new ResizeObserver(() => {
        termWrap.handleResize_debounced();
      });
      rszObs.observe(termContainer);

      // 异步初始化终端
      termWrap.initTerminal().catch(console.error);

      // 如果是当前活动标签，自动聚焦
      if (tab.id === activeTabId) {
        setTimeout(() => termWrap.focus(), 10);
      }

      // 清理函数会在标签页关闭时由 handleCloseTab 调用
    });

    // 更新容器显示状态
    const allContainers = container.querySelectorAll(".term-connectelem");
    allContainers.forEach((elem) => {
      const htmlElem = elem as HTMLElement;
      const tabId = htmlElem.dataset.tabId;
      htmlElem.style.display = tabId === activeTabId ? "block" : "none";
    });

    // 聚焦当前活动终端
    if (activeTab?.termWrap) {
      setTimeout(() => activeTab.termWrap?.focus(), 10);
    }
  }, [
    tabs,
    activeTabId,
    currentTheme,
    fontSize,
    handleStatusChange,
    handleTerminalKeydown,
    activeTab,
  ]);

  // 没有标签页时显示空状态
  if (tabs.length === 0) {
    return (
      <div className="flex flex-col h-full w-full min-h-0 terminal-bg">
        <TerminalTabs
          tabs={[]}
          activeTabId={null}
          onTabSelect={() => {}}
          onTabClose={() => {}}
          onNewTab={handleNewTerminal}
          onSearchClick={() => setShowSearch(true)}
          currentTheme={currentTheme}
          onThemeChange={handleThemeChange}
          fontSize={fontSize}
          onFontSizeChange={handleFontSizeChange}
          isCreating={isCreating}
        />
        <div className="flex-1">
          <EmptyTabsPlaceholder
            onNewTab={handleNewTerminal}
            isCreating={isCreating}
          />
        </div>
        {error && (
          <div className="absolute bottom-4 right-4 bg-red-600/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
            {error}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="view-term terminal-bg">
      {/* 标签栏 */}
      <TerminalTabs
        tabs={tabs}
        activeTabId={activeTabId}
        onTabSelect={setActiveTabId}
        onTabClose={handleCloseTab}
        onNewTab={handleNewTerminal}
        onSearchClick={() => setShowSearch(true)}
        currentTheme={currentTheme}
        onThemeChange={handleThemeChange}
        fontSize={fontSize}
        onFontSizeChange={handleFontSizeChange}
        isCreating={isCreating}
      />

      {/* 搜索栏 */}
      <TerminalSearch
        visible={showSearch}
        onClose={() => setShowSearch(false)}
        onSearch={handleSearch}
        onSearchNext={handleSearchNext}
        onSearchPrevious={handleSearchPrevious}
        onClearSearch={handleClearSearch}
      />

      {/* 多终端容器（每个标签页一个容器） */}
      <div
        ref={terminalContainerRef}
        className="term-container-wrapper"
        onClick={() => activeTab?.termWrap?.focus()}
      />

      {/* 错误提示 */}
      {error && (
        <div className="absolute bottom-4 right-4 bg-red-600/90 text-white px-4 py-2 rounded-lg shadow-lg text-sm z-50">
          {error}
        </div>
      )}
    </div>
  );
}
export default TerminalPage;
