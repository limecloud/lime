/**
 * 初次安装引导 - 状态管理 Hook
 */

import { useState, useCallback } from "react";
import {
  STORAGE_KEYS,
  ONBOARDING_VERSION,
  type UserProfile,
} from "../constants";

function resolveNeedsOnboardingState(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    const isComplete =
      localStorage.getItem(STORAGE_KEYS.ONBOARDING_COMPLETE) === "true";
    const version = localStorage.getItem(STORAGE_KEYS.ONBOARDING_VERSION);

    return !isComplete || version !== ONBOARDING_VERSION;
  } catch (error) {
    console.warn("[Onboarding] 读取引导状态失败，默认继续进入主应用:", error);
    return false;
  }
}

/**
 * 引导状态 Hook
 *
 * 管理首次启动检测和引导完成状态
 */
export function useOnboardingState() {
  // 直接在初始化时同步读取,避免二次检查导致的延迟
  const [needsOnboarding, setNeedsOnboarding] = useState<boolean | null>(() => {
    // 在 SSR 环境下返回 null,等待客户端 hydration
    if (typeof window === "undefined") {
      return null;
    }
    // 客户端环境直接返回结果,不需要 useEffect 二次检查
    return resolveNeedsOnboardingState();
  });

  /**
   * 完成引导
   */
  const completeOnboarding = useCallback((userProfile?: UserProfile) => {
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_COMPLETE, "true");
    localStorage.setItem(STORAGE_KEYS.ONBOARDING_VERSION, ONBOARDING_VERSION);
    if (userProfile) {
      localStorage.setItem(STORAGE_KEYS.USER_PROFILE, userProfile);
    }
    setNeedsOnboarding(false);
  }, []);

  /**
   * 重置引导（用于设置页面"重新运行引导"）
   */
  const resetOnboarding = useCallback(() => {
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_COMPLETE);
    localStorage.removeItem(STORAGE_KEYS.ONBOARDING_VERSION);
    localStorage.removeItem(STORAGE_KEYS.USER_PROFILE);
    setNeedsOnboarding(true);
  }, []);

  /**
   * 获取保存的用户群体
   */
  const getSavedUserProfile = useCallback((): UserProfile | null => {
    const saved = localStorage.getItem(STORAGE_KEYS.USER_PROFILE);
    if (saved === "developer" || saved === "general") {
      return saved;
    }
    return null;
  }, []);

  return {
    needsOnboarding,
    completeOnboarding,
    resetOnboarding,
    getSavedUserProfile,
  };
}
