/**
 * @file useWorkbenchStore.ts
 * @description Workbench 页面的 Zustand 状态管理 Store
 * @module stores/useWorkbenchStore
 *
 * 管理 Workbench 页面的 UI 状态，包括侧边栏折叠状态
 * 使用 persist 中间件持久化到 localStorage
 */

import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type {
  ContentReviewExpert,
  CustomContentReviewExpertInput,
} from "@/lib/workspace/workbenchCanvas";
import type { Skill } from "@/lib/api/skills";

export interface WorkbenchContentReviewRailState {
  /** 专家列表 */
  experts: ContentReviewExpert[];
  /** 当前选中的专家 ID */
  selectedExpertIds: string[];
  /** 切换专家 */
  onToggleExpert: (expertId: string) => void;
  /** 关闭评审面板 */
  onClose: () => void;
  /** 创建自定义专家 */
  onCreateExpert: (input: CustomContentReviewExpertInput) => void;
  /** 开始内容评审 */
  onStartReview?: () => void;
  /** 是否正在评审 */
  reviewRunning?: boolean;
  /** 评审结果 */
  reviewResult?: string;
  /** 评审错误 */
  reviewError?: string;
}

export interface WorkbenchThemeSkillsRailState {
  /** 技能列表 */
  skills: Skill[];
  /** 是否正在自动运行 */
  isAutoRunning: boolean;
}

/**
 * Workbench Store 状态接口
 */
export interface WorkbenchState {
  /** 左侧栏是否折叠 */
  leftSidebarCollapsed: boolean;
  /** 当前右侧内容评审面板状态 */
  contentReviewRailState: WorkbenchContentReviewRailState | null;
  /** 当前右侧主题工作台技能面板状态 */
  themeSkillsRailState: WorkbenchThemeSkillsRailState | null;
  /** 待触发的技能 key（独立于面板状态，避免同步覆盖） */
  pendingSkillKey: string | null;

  /** 切换左侧栏折叠状态 */
  toggleLeftSidebar: () => void;

  /** 设置左侧栏折叠状态 */
  setLeftSidebarCollapsed: (collapsed: boolean) => void;

  /** 设置右侧内容评审面板状态 */
  setContentReviewRailState: (
    state: WorkbenchContentReviewRailState | null,
  ) => void;

  /** 清空右侧内容评审面板状态 */
  clearContentReviewRailState: () => void;

  /** 设置右侧主题工作台技能面板状态 */
  setThemeSkillsRailState: (state: WorkbenchThemeSkillsRailState | null) => void;

  /** 清空右侧主题工作台技能面板状态 */
  clearThemeSkillsRailState: () => void;

  /** 触发技能执行 */
  triggerSkill: (skillKey: string) => void;

  /** 消费 pendingSkillKey */
  consumePendingSkill: () => void;
}

/**
 * 初始状态
 */
const initialState = {
  leftSidebarCollapsed: true,
  contentReviewRailState: null,
  themeSkillsRailState: null,
  pendingSkillKey: null,
};

/**
 * Workbench Zustand Store
 *
 * 使用 persist 中间件持久化 UI 状态到 localStorage
 */
export const useWorkbenchStore = create<WorkbenchState>()(
  persist(
    (set) => ({
      ...initialState,

      toggleLeftSidebar: () => {
        set((state) => ({
          leftSidebarCollapsed: !state.leftSidebarCollapsed,
        }));
      },

      setLeftSidebarCollapsed: (collapsed: boolean) => {
        set({ leftSidebarCollapsed: collapsed });
      },

      setContentReviewRailState: (contentReviewRailState) => {
        set((state) => {
          if (state.contentReviewRailState === contentReviewRailState) {
            return state;
          }
          return { contentReviewRailState };
        });
      },

      clearContentReviewRailState: () => {
        set((state) => {
          if (!state.contentReviewRailState) {
            return state;
          }
          return { contentReviewRailState: null };
        });
      },

      setThemeSkillsRailState: (themeSkillsRailState) => {
        set((state) => {
          if (state.themeSkillsRailState === themeSkillsRailState) {
            return state;
          }
          return { themeSkillsRailState };
        });
      },

      clearThemeSkillsRailState: () => {
        set((state) => {
          if (!state.themeSkillsRailState) {
            return state;
          }
          return { themeSkillsRailState: null, pendingSkillKey: null };
        });
      },

      triggerSkill: (skillKey: string) => {
        set({ pendingSkillKey: skillKey });
      },

      consumePendingSkill: () => {
        set((state) => {
          if (!state.pendingSkillKey) return state;
          return { pendingSkillKey: null };
        });
      },
    }),
    {
      name: "workbench-storage",
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        leftSidebarCollapsed: state.leftSidebarCollapsed,
      }),
    },
  ),
);
