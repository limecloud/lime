/**
 * @file 历史记录 Hook
 * @description 封装画布的撤销/重做功能
 * @module components/content-creator/canvas/poster/hooks/useHistory
 */

import { useState, useCallback, useRef, useEffect } from "react";
import { fabric } from "fabric";
import { resolvePosterCanvasHotkeyAction } from "./posterCanvasHotkeys";

/**
 * 历史记录状态
 */
export interface HistoryState {
  /** 历史记录栈 */
  stack: string[];
  /** 当前索引 */
  currentIndex: number;
}

/**
 * useHistory Hook 返回值类型
 */
export interface UseHistoryReturn {
  /** 是否可以撤销 */
  canUndo: boolean;
  /** 是否可以重做 */
  canRedo: boolean;
  /** 撤销 */
  undo: () => void;
  /** 重做 */
  redo: () => void;
  /** 保存当前状态到历史记录 */
  saveState: () => void;
  /** 清空历史记录 */
  clearHistory: () => void;
  /** 历史记录长度 */
  historyLength: number;
  /** 当前索引 */
  currentIndex: number;
}

/**
 * useHistory Hook 配置
 */
export interface UseHistoryOptions {
  /** Fabric.js Canvas 实例 */
  canvas: fabric.Canvas | null;
  /** 最大历史记录数量 */
  maxHistory?: number;
  /** 状态变更回调 */
  onStateChange?: () => void;
}

/**
 * 默认最大历史记录数量
 */
const DEFAULT_MAX_HISTORY = 50;

/**
 * 历史记录 Hook
 *
 * 提供画布的撤销/重做功能。
 *
 * @param options - 配置选项
 * @returns 历史记录操作方法和状态
 *
 * @example
 * ```tsx
 * const { canUndo, canRedo, undo, redo, saveState } = useHistory({
 *   canvas,
 *   maxHistory: 50,
 * });
 * ```
 */
export function useHistory(options: UseHistoryOptions): UseHistoryReturn {
  const { canvas, maxHistory = DEFAULT_MAX_HISTORY, onStateChange } = options;

  // 历史记录栈
  const historyRef = useRef<string[]>([]);
  // 当前索引
  const currentIndexRef = useRef(-1);
  // 是否正在恢复状态（防止恢复时触发保存）
  const isRestoringRef = useRef(false);

  // 用于触发重新渲染
  const [, forceUpdate] = useState({});

  /**
   * 保存当前状态到历史记录
   */
  const saveState = useCallback(() => {
    if (!canvas || isRestoringRef.current) return;

    const json = JSON.stringify(canvas.toJSON(["data"]));

    // 如果当前不在栈顶，删除当前位置之后的所有记录
    if (currentIndexRef.current < historyRef.current.length - 1) {
      historyRef.current = historyRef.current.slice(
        0,
        currentIndexRef.current + 1,
      );
    }

    // 添加新状态
    historyRef.current.push(json);

    // 限制历史记录数量
    if (historyRef.current.length > maxHistory) {
      historyRef.current = historyRef.current.slice(-maxHistory);
    }

    // 更新当前索引
    currentIndexRef.current = historyRef.current.length - 1;

    // 触发重新渲染
    forceUpdate({});
  }, [canvas, maxHistory]);

  /**
   * 撤销
   */
  const undo = useCallback(() => {
    if (!canvas || currentIndexRef.current <= 0) return;

    isRestoringRef.current = true;
    currentIndexRef.current--;

    const json = historyRef.current[currentIndexRef.current];
    canvas.loadFromJSON(json, () => {
      canvas.requestRenderAll();
      isRestoringRef.current = false;
      onStateChange?.();
      forceUpdate({});
    });
  }, [canvas, onStateChange]);

  /**
   * 重做
   */
  const redo = useCallback(() => {
    if (!canvas || currentIndexRef.current >= historyRef.current.length - 1)
      return;

    isRestoringRef.current = true;
    currentIndexRef.current++;

    const json = historyRef.current[currentIndexRef.current];
    canvas.loadFromJSON(json, () => {
      canvas.requestRenderAll();
      isRestoringRef.current = false;
      onStateChange?.();
      forceUpdate({});
    });
  }, [canvas, onStateChange]);

  /**
   * 清空历史记录
   */
  const clearHistory = useCallback(() => {
    historyRef.current = [];
    currentIndexRef.current = -1;
    forceUpdate({});
  }, []);

  /**
   * 监听键盘快捷键
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const action = resolvePosterCanvasHotkeyAction(e);
      if (!action) {
        return;
      }

      if (action === "undo") {
        e.preventDefault();
        undo();
        return;
      }

      if (action === "redo") {
        e.preventDefault();
        redo();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [undo, redo]);

  /**
   * 监听画布变更事件
   */
  useEffect(() => {
    if (!canvas) return;

    const handleObjectModified = () => {
      saveState();
    };

    const handleObjectAdded = () => {
      saveState();
    };

    const handleObjectRemoved = () => {
      saveState();
    };

    canvas.on("object:modified", handleObjectModified);
    canvas.on("object:added", handleObjectAdded);
    canvas.on("object:removed", handleObjectRemoved);

    // 保存初始状态
    saveState();

    return () => {
      canvas.off("object:modified", handleObjectModified);
      canvas.off("object:added", handleObjectAdded);
      canvas.off("object:removed", handleObjectRemoved);
    };
  }, [canvas, saveState]);

  return {
    canUndo: currentIndexRef.current > 0,
    canRedo: currentIndexRef.current < historyRef.current.length - 1,
    undo,
    redo,
    saveState,
    clearHistory,
    historyLength: historyRef.current.length,
    currentIndex: currentIndexRef.current,
  };
}

/**
 * 历史记录工具函数（纯函数，用于测试）
 */
export const historyUtils = {
  /**
   * 计算撤销后的索引
   */
  calculateUndoIndex: (currentIndex: number): number => {
    return Math.max(0, currentIndex - 1);
  },

  /**
   * 计算重做后的索引
   */
  calculateRedoIndex: (currentIndex: number, stackLength: number): number => {
    return Math.min(stackLength - 1, currentIndex + 1);
  },

  /**
   * 判断是否可以撤销
   */
  canUndo: (currentIndex: number): boolean => {
    return currentIndex > 0;
  },

  /**
   * 判断是否可以重做
   */
  canRedo: (currentIndex: number, stackLength: number): boolean => {
    return currentIndex < stackLength - 1;
  },

  /**
   * 计算添加新状态后的栈
   * @param stack 当前栈
   * @param currentIndex 当前索引
   * @param newState 新状态
   * @param maxHistory 最大历史记录数量
   * @returns 新的栈和索引
   */
  addState: (
    stack: string[],
    currentIndex: number,
    newState: string,
    maxHistory: number,
  ): { stack: string[]; currentIndex: number } => {
    // 如果当前不在栈顶，删除当前位置之后的所有记录
    let newStack =
      currentIndex < stack.length - 1
        ? stack.slice(0, currentIndex + 1)
        : [...stack];

    // 添加新状态
    newStack.push(newState);

    // 限制历史记录数量
    if (newStack.length > maxHistory) {
      newStack = newStack.slice(-maxHistory);
    }

    return {
      stack: newStack,
      currentIndex: newStack.length - 1,
    };
  },

  /**
   * 模拟撤销操作
   */
  simulateUndo: (
    stack: string[],
    currentIndex: number,
  ): { stack: string[]; currentIndex: number; state: string | null } => {
    if (currentIndex <= 0) {
      return { stack, currentIndex, state: null };
    }

    const newIndex = currentIndex - 1;
    return {
      stack,
      currentIndex: newIndex,
      state: stack[newIndex],
    };
  },

  /**
   * 模拟重做操作
   */
  simulateRedo: (
    stack: string[],
    currentIndex: number,
  ): { stack: string[]; currentIndex: number; state: string | null } => {
    if (currentIndex >= stack.length - 1) {
      return { stack, currentIndex, state: null };
    }

    const newIndex = currentIndex + 1;
    return {
      stack,
      currentIndex: newIndex,
      state: stack[newIndex],
    };
  },
};
