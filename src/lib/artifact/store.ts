/**
 * @file Artifact 状态管理
 * @description 使用 Jotai 实现 Artifact 系统的状态管理，包括列表、选中状态和流式状态
 * @module lib/artifact/store
 * @requirements 9.1, 9.2, 9.3, 9.4, 9.6
 */

import { atom } from "jotai";
import type { Artifact } from "./types";

/**
 * Artifact 操作类型
 * 定义所有可用的状态操作
 */
export type ArtifactAction =
  | { type: "add"; artifact: Artifact }
  | { type: "update"; id: string; updates: Partial<Omit<Artifact, "id">> }
  | { type: "remove"; id: string }
  | { type: "select"; id: string | null }
  | { type: "clear" };

/**
 * Artifact 列表 atom
 * 存储所有 Artifact 对象的数组
 *
 * @requirements 9.2
 */
export const artifactsAtom = atom<Artifact[]>([]);

/**
 * 当前选中的 Artifact ID atom
 * 存储当前选中 Artifact 的 ID，null 表示未选中
 *
 * @requirements 9.3
 */
export const selectedArtifactIdAtom = atom<string | null>(null);

/**
 * 派生 atom: 选中的 Artifact
 * 根据 selectedArtifactIdAtom 从 artifactsAtom 中获取对应的 Artifact 对象
 *
 * @requirements 9.3
 */
export const selectedArtifactAtom = atom((get) => {
  const id = get(selectedArtifactIdAtom);
  if (id === null) return null;

  const artifacts = get(artifactsAtom);
  return artifacts.find((a) => a.id === id) ?? null;
});

/**
 * 流式 Artifact atom
 * 存储当前正在流式生成的 Artifact，用于实时更新显示
 *
 * @requirements 9.5 (流式更新支持)
 */
export const streamingArtifactAtom = atom<Artifact | null>(null);

/**
 * Artifact 操作 atom
 * 提供统一的状态操作接口，支持 add, update, remove, select, clear 操作
 *
 * @requirements 9.4
 */
export const artifactActionsAtom = atom(
  null,
  (get, set, action: ArtifactAction) => {
    switch (action.type) {
      case "add": {
        const artifacts = get(artifactsAtom);
        // 检查是否已存在相同 ID 的 artifact
        const existingIndex = artifacts.findIndex(
          (a) => a.id === action.artifact.id,
        );
        if (existingIndex >= 0) {
          // 如果已存在，更新它
          const newArtifacts = [...artifacts];
          newArtifacts[existingIndex] = action.artifact;
          set(artifactsAtom, newArtifacts);
        } else {
          // 否则添加新的
          set(artifactsAtom, [...artifacts, action.artifact]);
        }
        break;
      }

      case "update": {
        const artifacts = get(artifactsAtom);
        const index = artifacts.findIndex((a) => a.id === action.id);
        if (index >= 0) {
          const newArtifacts = [...artifacts];
          newArtifacts[index] = {
            ...newArtifacts[index],
            ...action.updates,
            updatedAt: Date.now(),
          };
          set(artifactsAtom, newArtifacts);
        }
        break;
      }

      case "remove": {
        const artifacts = get(artifactsAtom);
        const newArtifacts = artifacts.filter((a) => a.id !== action.id);
        set(artifactsAtom, newArtifacts);

        // 如果删除的是当前选中的，清除选中状态
        const selectedId = get(selectedArtifactIdAtom);
        if (selectedId === action.id) {
          set(selectedArtifactIdAtom, null);
        }
        break;
      }

      case "select": {
        set(selectedArtifactIdAtom, action.id);
        break;
      }

      case "clear": {
        set(artifactsAtom, []);
        set(selectedArtifactIdAtom, null);
        set(streamingArtifactAtom, null);
        break;
      }
    }
  },
);

/**
 * 派生 atom: Artifact 数量
 * 便捷获取当前 Artifact 列表的长度
 */
export const artifactCountAtom = atom((get) => get(artifactsAtom).length);

/**
 * 派生 atom: 是否有选中的 Artifact
 * 便捷检查是否有 Artifact 被选中
 */
export const hasSelectedArtifactAtom = atom(
  (get) => get(selectedArtifactIdAtom) !== null,
);

/**
 * 派生 atom: 是否正在流式生成
 * 便捷检查是否有 Artifact 正在流式生成
 */
export const isStreamingAtom = atom(
  (get) => get(streamingArtifactAtom) !== null,
);
