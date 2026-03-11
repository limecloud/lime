/**
 * @file termwrap.ts
 * @description 终端封装类 - 对齐 waveterm 架构
 * @module components/terminal/termwrap
 *
 * 封装 xterm.js 终端实例，管理终端生命周期、大小同步、输入输出。
 *
 * ## 架构说明（对齐 waveterm）
 * 1. 构造函数中：创建终端、加载插件、open、handleResize
 * 2. initTerminal() 异步方法：设置事件监听、连接到后端
 * 3. loaded 标志：在 initTerminal 完成后设为 true
 *
 * ## 功能特性
 * - WebGL 渲染（可配置，提升性能）
 * - Unicode 11 宽字符支持
 * - FitAddon 自适应大小
 * - 搜索功能
 * - 主题切换
 * - IME 输入法支持
 *
 * _Requirements: 8.1, 8.2, 8.4, 8.5_
 */

import { Terminal } from "@xterm/xterm";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon, type ISearchOptions } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { FitAddon } from "./fitaddon";
import {
  resizeTerminal,
  writeToTerminalRaw,
  onSessionOutput,
  onSessionStatus,
  decodeBytes,
  encodeBase64,
  type SessionStatus,
} from "@/lib/api/terminal";
import {
  type ThemeName,
  getTheme,
  loadThemePreference,
} from "@/lib/terminal/themes";

/** 简单的 debounce 实现（对齐 waveterm 参数顺序） */
function debounce<T extends (...args: unknown[]) => void>(
  delay: number,
  fn: T,
): T {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return ((...args: unknown[]) => {
    if (timeoutId) clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  }) as T;
}

/** 终端配置选项 */
export interface TermWrapOptions {
  /** 终端字体大小 */
  fontSize?: number;
  /** 终端字体 */
  fontFamily?: string;
  /** 主题名称 */
  themeName?: ThemeName;
  /** 状态变化回调 */
  onStatusChange?: (status: SessionStatus) => void;
  /** 是否启用 WebGL 渲染（默认 true）
   * _Requirements: 8.2_
   */
  webglEnabled?: boolean;
  /** 括号粘贴模式（默认 true）
   * _Requirements: 8.9_
   */
  bracketedPasteMode?: boolean;
  /** 滚动回滚行数（默认 5000） */
  scrollback?: number;
  /** 键盘事件处理器（对齐 waveterm）
   * 返回 true 表示事件已处理，阻止默认行为
   * 返回 false 表示事件未处理，继续传递
   */
  keydownHandler?: (e: KeyboardEvent) => boolean;
}

/** 搜索结果回调 */
export interface SearchCallbacks {
  /** 搜索结果变化 */
  onSearchResults?: (results: {
    resultIndex: number;
    resultCount: number;
  }) => void;
}

/**
 * 终端封装类 - 对齐 waveterm 架构
 *
 * _Requirements: 8.1, 8.2, 8.4, 8.5_
 */
export class TermWrap {
  /** 会话 ID（必须） */
  readonly sessionId: string;
  /** xterm 终端实例 */
  terminal: Terminal;
  /** 连接的 DOM 元素 */
  connectElem: HTMLDivElement;
  /** FitAddon 实例 */
  fitAddon: FitAddon;
  /** SearchAddon 实例 */
  searchAddon: SearchAddon;
  /** WebglAddon 实例（可选）
   * _Requirements: 8.2_
   */
  webglAddon: WebglAddon | null = null;
  /** Unicode11Addon 实例
   * _Requirements: 8.4_
   */
  unicode11Addon: Unicode11Addon;
  /** 是否已加载（对齐 waveterm） */
  loaded: boolean = false;
  /** 是否已 resize 过（对齐 waveterm） */
  hasResized: boolean = false;
  /** 防抖的 resize 处理函数
   * _Requirements: 8.6_
   */
  handleResize_debounced: () => void;
  /** 配置选项 */
  private options: TermWrapOptions;
  /** 当前主题名称 */
  private currentTheme: ThemeName;
  /** 搜索回调 */
  private searchCallbacks: SearchCallbacks = {};
  /** 需要清理的资源 */
  private toDispose: Array<{ dispose: () => void }> = [];
  /** 事件监听器清理函数 */
  private unlistenOutput?: () => void;
  private unlistenStatus?: () => void;
  /** WebGL 是否启用 */
  private webglEnabled: boolean;
  /** IME 组合状态
   * _Requirements: 8.11_
   */
  private isComposing: boolean = false;
  /** 写入队列（用于批量写入减少闪烁） */
  private writeQueue: Uint8Array[] = [];
  /** 写入定时器 */
  private writeTimer: ReturnType<typeof setTimeout> | null = null;
  /** 批量写入延迟（毫秒） */
  private readonly WRITE_BATCH_DELAY = 8; // ~120fps，平衡响应性和流畅性

  /**
   * 创建终端封装实例（对齐 waveterm 构造函数）
   *
   * 构造函数中：创建终端、加载插件、open、handleResize
   * 不在构造函数中连接到后端，由 initTerminal() 完成
   */
  constructor(
    sessionId: string,
    connectElem: HTMLDivElement,
    options: TermWrapOptions = {},
  ) {
    this.sessionId = sessionId;
    this.connectElem = connectElem;
    this.options = options;
    this.webglEnabled = options.webglEnabled ?? true;

    // 加载主题
    this.currentTheme = options.themeName ?? loadThemePreference();
    const theme = getTheme(this.currentTheme);

    // 创建终端实例
    // _Requirements: 8.1_
    this.terminal = new Terminal({
      cursorBlink: true,
      fontSize: options.fontSize ?? 14,
      fontFamily:
        options.fontFamily ?? 'Hack, Menlo, Monaco, "Courier New", monospace',
      theme,
      allowProposedApi: true,
      allowTransparency: true,
      scrollback: options.scrollback ?? 5000,
      drawBoldTextInBrightColors: false,
      fontWeight: "normal",
      fontWeightBold: "bold",
      // 括号粘贴模式配置
      // _Requirements: 8.9_
    });

    // 加载 FitAddon
    // _Requirements: 8.5_
    this.fitAddon = new FitAddon();
    // macOS 上禁用滚动条宽度计算（对齐 waveterm）
    const isMac = /mac/i.test(navigator.userAgent);
    this.fitAddon.noScrollbar = isMac;

    // 加载 SearchAddon
    // _Requirements: 8.3_
    this.searchAddon = new SearchAddon();

    // 加载 Unicode11Addon（宽字符支持）
    // _Requirements: 8.4_
    this.unicode11Addon = new Unicode11Addon();

    // 加载 WebLinksAddon
    const webLinksAddon = new WebLinksAddon();

    // 加载插件
    this.terminal.loadAddon(this.fitAddon);
    this.terminal.loadAddon(this.searchAddon);
    this.terminal.loadAddon(this.unicode11Addon);
    this.terminal.loadAddon(webLinksAddon);

    // 激活 Unicode 11 支持
    // _Requirements: 8.4_
    this.terminal.unicode.activeVersion = "11";

    // 打开终端
    this.terminal.open(this.connectElem);

    // 绑定键盘事件处理器（对齐 waveterm）
    if (options.keydownHandler) {
      this.terminal.attachCustomKeyEventHandler(options.keydownHandler);
    }

    // 尝试加载 WebGL 渲染器
    // _Requirements: 8.2_
    this.tryLoadWebgl();

    // 设置防抖的 resize 处理（对齐 waveterm 使用 50ms）
    // _Requirements: 8.6_
    this.handleResize_debounced = debounce(50, this.handleResize.bind(this));

    // 立即调用一次 resize（对齐 waveterm）
    this.handleResize();
  }

  /**
   * 尝试加载 WebGL 渲染器
   *
   * WebGL 渲染可以显著提升终端性能，但在某些环境下可能不可用。
   * 如果加载失败，会回退到 Canvas 渲染。
   *
   * _Requirements: 8.2_
   */
  private tryLoadWebgl(): void {
    if (!this.webglEnabled) {
      return;
    }

    try {
      this.webglAddon = new WebglAddon();

      // 监听 WebGL 上下文丢失事件
      this.webglAddon.onContextLoss(() => {
        console.warn("[TermWrap] WebGL 上下文丢失，回退到 Canvas 渲染");
        this.disposeWebgl();
      });

      this.terminal.loadAddon(this.webglAddon);
    } catch (err) {
      console.warn("[TermWrap] WebGL 渲染不可用，使用 Canvas 渲染:", err);
      this.webglAddon = null;
    }
  }

  /**
   * 销毁 WebGL 渲染器
   */
  private disposeWebgl(): void {
    if (this.webglAddon) {
      try {
        this.webglAddon.dispose();
      } catch {
        // ignore dispose errors
      }
      this.webglAddon = null;
    }
  }

  /**
   * 初始化终端（对齐 waveterm 的 initTerminal）
   *
   * 异步方法：设置事件监听、连接到后端
   */
  async initTerminal(): Promise<void> {
    // 首先确保 resize 已同步到后端（关键！）
    // 这样后端 PTY 的大小与前端一致，避免输出错位
    this.handleResize();
    // 等待 resize 命令发送到后端并生效
    await new Promise((resolve) => setTimeout(resolve, 100));

    // 设置输入处理
    const onDataDisposable = this.terminal.onData((data) => {
      // 对齐 waveterm：在 loaded 之前不处理输入
      if (!this.loaded) {
        return;
      }
      // IME 组合状态下不发送数据
      // _Requirements: 8.11_
      if (this.isComposing) {
        return;
      }
      const base64 = encodeBase64(data);
      writeToTerminalRaw(this.sessionId, base64).catch(console.error);
    });
    this.toDispose.push(onDataDisposable);

    // 设置 IME 组合事件处理
    // _Requirements: 8.11_
    this.setupIMEHandlers();

    // 暂存数据队列（对齐 waveterm 的 heldData）
    const heldData: Uint8Array[] = [];

    try {
      // 监听输出（使用批量写入减少闪烁）
      this.unlistenOutput = await onSessionOutput(this.sessionId, (data) => {
        if (!this.loaded) {
          // 在 loaded 之前暂存数据
          heldData.push(data);
          return;
        }
        // 使用批量写入
        this.queueWrite(data);
      });

      // 监听状态
      this.unlistenStatus = await onSessionStatus(this.sessionId, (event) => {
        this.options.onStatusChange?.(event.status);
      });
    } catch (err) {
      console.error("[TermWrap] 连接失败:", err);
      this.options.onStatusChange?.("error");
    }

    // 标记为已加载（对齐 waveterm）
    this.loaded = true;

    // 写入暂存的数据
    if (heldData.length > 0) {
      for (const data of heldData) {
        const decoded = decodeBytes(data);
        this.terminal.write(decoded);
      }
    }
  }

  /**
   * 将数据加入写入队列（批量写入减少闪烁）
   *
   * Claude Code 等应用会发送大量小数据包（如 ESC[2K + ESC[1A 组合），
   * 如果每个包都立即写入会导致闪烁。通过批量写入，将短时间内的多个
   * 数据包合并后一次性写入，减少渲染次数。
   */
  private queueWrite(data: Uint8Array): void {
    this.writeQueue.push(data);

    // 如果已有定时器，等待批量处理
    if (this.writeTimer !== null) {
      return;
    }

    // 设置定时器，延迟后批量写入
    this.writeTimer = setTimeout(() => {
      this.flushWriteQueue();
    }, this.WRITE_BATCH_DELAY);
  }

  /**
   * 刷新写入队列，将所有数据合并后写入终端
   */
  private flushWriteQueue(): void {
    this.writeTimer = null;

    if (this.writeQueue.length === 0) {
      return;
    }

    // 合并所有数据
    const totalLength = this.writeQueue.reduce(
      (sum, arr) => sum + arr.length,
      0,
    );
    const merged = new Uint8Array(totalLength);
    let offset = 0;
    for (const arr of this.writeQueue) {
      merged.set(arr, offset);
      offset += arr.length;
    }
    this.writeQueue = [];

    // 一次性写入
    const decoded = decodeBytes(merged);
    this.terminal.write(decoded);
  }

  /**
   * 设置 IME 输入法事件处理
   *
   * _Requirements: 8.11_
   */
  private setupIMEHandlers(): void {
    const textarea = this.connectElem.querySelector(
      ".xterm-helper-textarea",
    ) as HTMLTextAreaElement | null;
    if (!textarea) {
      console.warn("[TermWrap] 未找到 xterm textarea 元素");
      return;
    }

    // 监听组合开始
    textarea.addEventListener("compositionstart", () => {
      this.isComposing = true;
    });

    // 监听组合结束
    textarea.addEventListener("compositionend", () => {
      this.isComposing = false;
    });

    // 处理 Escape 键（在组合状态下取消组合）
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.isComposing) {
        // 取消组合
        this.isComposing = false;
        // 清空输入
        textarea.value = "";
      }
    });
  }

  /**
   * 处理终端大小变化（对齐 waveterm）
   *
   * _Requirements: 8.6_
   */
  handleResize(): void {
    const oldRows = this.terminal.rows;
    const oldCols = this.terminal.cols;

    // 调用 fit 计算新大小
    this.fitAddon.fit();

    // 如果尺寸改变，同步到后端
    if (oldRows !== this.terminal.rows || oldCols !== this.terminal.cols) {
      resizeTerminal(
        this.sessionId,
        this.terminal.rows,
        this.terminal.cols,
      ).catch((e) => console.error("[TermWrap] resize 同步失败:", e));
    }

    // 首次 resize 标记（对齐 waveterm）
    if (!this.hasResized) {
      this.hasResized = true;
    }
  }

  /**
   * 聚焦终端
   */
  focus(): void {
    this.terminal.focus();
  }

  /**
   * 获取终端是否聚焦
   */
  hasFocus(): boolean {
    return (
      document.activeElement ===
      this.connectElem.querySelector(".xterm-helper-textarea")
    );
  }

  /**
   * 获取当前终端大小
   */
  getSize(): { rows: number; cols: number } {
    return {
      rows: this.terminal.rows,
      cols: this.terminal.cols,
    };
  }

  /**
   * 检查 WebGL 是否启用
   *
   * _Requirements: 8.2_
   */
  isWebglEnabled(): boolean {
    return this.webglAddon !== null;
  }

  // ============================================================================
  // 搜索功能
  // _Requirements: 8.3_
  // ============================================================================

  /**
   * 设置搜索回调
   */
  setSearchCallbacks(callbacks: SearchCallbacks): void {
    this.searchCallbacks = callbacks;
  }

  /**
   * 搜索文本
   */
  search(term: string, options?: ISearchOptions): boolean {
    if (!term) {
      this.clearSearch();
      return false;
    }
    return this.searchAddon.findNext(term, options);
  }

  /**
   * 搜索下一个
   */
  searchNext(term: string, options?: ISearchOptions): boolean {
    if (!term) return false;
    return this.searchAddon.findNext(term, options);
  }

  /**
   * 搜索上一个
   */
  searchPrevious(term: string, options?: ISearchOptions): boolean {
    if (!term) return false;
    return this.searchAddon.findPrevious(term, options);
  }

  /**
   * 清除搜索高亮
   */
  clearSearch(): void {
    this.searchAddon.clearDecorations();
  }

  // ============================================================================
  // 主题功能
  // _Requirements: 8.7_
  // ============================================================================

  /**
   * 设置主题
   */
  setTheme(themeName: ThemeName): void {
    this.currentTheme = themeName;
    const theme = getTheme(themeName);
    this.terminal.options.theme = theme;
  }

  /**
   * 获取当前主题名称
   */
  getThemeName(): ThemeName {
    return this.currentTheme;
  }

  // ============================================================================
  // 字体配置
  // _Requirements: 8.8_
  // ============================================================================

  /**
   * 设置字体大小
   */
  setFontSize(size: number): void {
    this.terminal.options.fontSize = size;
    // 字体大小变化后需要重新 fit
    this.handleResize();
  }

  /**
   * 获取当前字体大小
   */
  getFontSize(): number {
    return this.terminal.options.fontSize ?? 14;
  }

  /**
   * 设置字体族
   */
  setFontFamily(fontFamily: string): void {
    this.terminal.options.fontFamily = fontFamily;
    // 字体变化后需要重新 fit
    this.handleResize();
  }

  /**
   * 获取当前字体族
   */
  getFontFamily(): string {
    return (
      this.terminal.options.fontFamily ??
      'Hack, Menlo, Monaco, "Courier New", monospace'
    );
  }

  // ============================================================================
  // 写入数据
  // ============================================================================

  /**
   * 直接写入数据到终端（不经过后端）
   *
   * 用于本地显示，如重同步时恢复历史数据
   */
  writeData(data: string | Uint8Array): void {
    this.terminal.write(data);
  }

  /**
   * 发送数据到后端 PTY（用于粘贴等外部输入）
   *
   * @param data - 要发送的文本数据
   */
  sendData(data: string): void {
    if (!this.loaded) {
      return;
    }
    const base64 = encodeBase64(data);
    writeToTerminalRaw(this.sessionId, base64).catch(console.error);
  }

  /**
   * 清空终端
   */
  clear(): void {
    this.terminal.clear();
  }

  /**
   * 重置终端
   */
  reset(): void {
    this.terminal.reset();
  }

  /**
   * 滚动到底部
   */
  scrollToBottom(): void {
    this.terminal.scrollToBottom();
  }

  /**
   * 滚动到顶部
   */
  scrollToTop(): void {
    this.terminal.scrollToTop();
  }

  /**
   * 销毁终端（对齐 waveterm）
   */
  dispose(): void {
    // 清理写入定时器
    if (this.writeTimer !== null) {
      clearTimeout(this.writeTimer);
      this.writeTimer = null;
    }
    // 刷新剩余数据
    this.flushWriteQueue();

    // 清理事件监听
    this.unlistenOutput?.();
    this.unlistenStatus?.();

    // 清理 WebGL
    this.disposeWebgl();

    // 清理其他资源
    this.toDispose.forEach((d) => {
      try {
        d.dispose();
      } catch {
        // ignore dispose errors
      }
    });

    // 销毁终端
    this.terminal.dispose();
  }
}
