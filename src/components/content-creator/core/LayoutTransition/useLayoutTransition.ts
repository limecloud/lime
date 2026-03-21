/**
 * @file 布局过渡 Hook
 * @description 管理布局切换动画状态
 * @module components/content-creator/core/LayoutTransition/useLayoutTransition
 */

import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { LayoutMode } from "../../types";

/** 过渡状态 */
export type TransitionState =
  | "idle"
  | "entering"
  | "entered"
  | "exiting"
  | "exited";

/** 过渡配置 */
export interface TransitionConfig {
  /** 进入动画时长 (ms) */
  enterDuration?: number;
  /** 退出动画时长 (ms) */
  exitDuration?: number;
  /** 进入动画延迟 (ms) */
  enterDelay?: number;
  /** 退出动画延迟 (ms) */
  exitDelay?: number;
}

const DEFAULT_CONFIG: Required<TransitionConfig> = {
  enterDuration: 300,
  exitDuration: 250,
  enterDelay: 0,
  exitDelay: 0,
};

const CHAT_CANVAS_PANEL_WIDTH = "min(100%, clamp(480px, 40%, 600px))";

/**
 * 布局过渡 Hook
 *
 * 管理布局切换时的动画状态
 */
export function useLayoutTransition(
  mode: LayoutMode,
  config: TransitionConfig = {},
) {
  const mergedConfig = useMemo(
    () => ({ ...DEFAULT_CONFIG, ...config }),
    [config],
  );
  const [transitionState, setTransitionState] = useState<TransitionState>(
    mode === "chat" ? "idle" : "entered",
  );
  const [isCanvasVisible, setIsCanvasVisible] = useState(mode !== "chat");
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevModeRef = useRef<LayoutMode>(mode);

  // 清理定时器
  const clearTimeouts = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  // 监听模式变化
  useEffect(() => {
    if (prevModeRef.current === mode) return;

    clearTimeouts();

    if (mode !== "chat") {
      // 进入画布模式
      setIsCanvasVisible(true);
      setTransitionState("entering");

      timeoutRef.current = setTimeout(() => {
        setTransitionState("entered");
      }, mergedConfig.enterDuration + mergedConfig.enterDelay);
    } else {
      // 退出画布模式
      setTransitionState("exiting");

      timeoutRef.current = setTimeout(() => {
        setTransitionState("exited");
        setIsCanvasVisible(false);

        // 重置为 idle
        setTimeout(() => {
          setTransitionState("idle");
        }, 50);
      }, mergedConfig.exitDuration + mergedConfig.exitDelay);
    }

    prevModeRef.current = mode;

    return clearTimeouts;
  }, [mode, mergedConfig, clearTimeouts]);

  // 获取 CSS 过渡样式
  const getTransitionStyles = useCallback(
    (target: "chat" | "canvas") => {
      const duration =
        transitionState === "entering" || transitionState === "entered"
          ? mergedConfig.enterDuration
          : mergedConfig.exitDuration;

      if (target === "canvas") {
        return {
          transition: `transform ${duration}ms ease-out, opacity ${duration}ms ease-out`,
          transform:
            transitionState === "entering" || transitionState === "entered"
              ? "translateX(0)"
              : "translateX(-100%)",
          opacity:
            transitionState === "entering" || transitionState === "entered"
              ? 1
              : 0,
        };
      }

      // chat 区域 - 画布打开时提升右侧聊天区宽度
      return {
        transition: `width ${duration}ms ease-out`,
        width:
          mode === "chat-canvas"
            ? CHAT_CANVAS_PANEL_WIDTH
            : mode === "canvas"
              ? "0%"
              : "100%",
      };
    },
    [transitionState, mergedConfig, mode],
  );

  return {
    /** 当前过渡状态 */
    transitionState,
    /** 画布是否可见 */
    isCanvasVisible,
    /** 是否正在过渡中 */
    isTransitioning:
      transitionState === "entering" || transitionState === "exiting",
    /** 获取过渡样式 */
    getTransitionStyles,
  };
}
