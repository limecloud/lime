/**
 * @file 元素操作 Hook
 * @description 封装元素选择、变换、多选、组合等操作
 * @module components/content-creator/canvas/poster/hooks/useElementOperations
 */

import { useState, useCallback, useEffect, useRef } from "react";
import { fabric } from "fabric";
import type { Layer, ElementType } from "../types";
import { resolvePosterCanvasHotkeyAction } from "./posterCanvasHotkeys";

/**
 * 元素变换数据
 */
export interface ElementTransform {
  /** 元素 ID */
  id: string;
  /** X 坐标 */
  left: number;
  /** Y 坐标 */
  top: number;
  /** X 缩放 */
  scaleX: number;
  /** Y 缩放 */
  scaleY: number;
  /** 旋转角度 */
  angle: number;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
}

/**
 * useElementOperations Hook 返回值类型
 */
export interface UseElementOperationsReturn {
  /** 选中的元素 ID 列表 */
  selectedIds: string[];
  /** 选中单个元素 */
  selectElement: (id: string | null) => void;
  /** 多选元素（Shift+点击） */
  toggleElementSelection: (id: string) => void;
  /** 清除选择 */
  clearSelection: () => void;
  /** 全选 */
  selectAll: () => void;
  /** 获取元素变换数据 */
  getElementTransform: (id: string) => ElementTransform | null;
  /** 设置元素变换 */
  setElementTransform: (
    id: string,
    transform: Partial<ElementTransform>,
  ) => void;
  /** 组合选中元素 */
  groupSelected: () => string | null;
  /** 取消组合 */
  ungroupSelected: () => string[];
  /** 删除选中元素 */
  deleteSelected: () => void;
  /** 图层列表 */
  layers: Layer[];
  /** 同步图层列表 */
  syncLayers: () => void;
}

/**
 * useElementOperations Hook 配置
 */
export interface UseElementOperationsOptions {
  /** Fabric.js Canvas 实例 */
  canvas: fabric.Canvas | null;
  /** 选择变更回调 */
  onSelectionChange?: (ids: string[]) => void;
  /** 图层变更回调 */
  onLayersChange?: (layers: Layer[]) => void;
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 获取元素类型
 */
function getElementType(obj: fabric.Object): ElementType {
  if (obj instanceof fabric.Group) return "group";
  if (obj instanceof fabric.IText || obj instanceof fabric.Text) return "text";
  if (obj instanceof fabric.Image) return "image";
  return "shape";
}

/**
 * 获取元素名称
 */
function getElementName(obj: fabric.Object, index: number): string {
  const type = getElementType(obj);
  const typeNames: Record<ElementType, string> = {
    text: "文字",
    image: "图片",
    shape: "形状",
    group: "组合",
  };
  return `${typeNames[type]} ${index + 1}`;
}

/**
 * 元素操作 Hook
 *
 * 提供元素选择、变换、多选、组合等操作功能。
 *
 * @param options - 配置选项
 * @returns 元素操作方法和状态
 */
export function useElementOperations(
  options: UseElementOperationsOptions,
): UseElementOperationsReturn {
  const { canvas, onSelectionChange, onLayersChange } = options;

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [layers, setLayers] = useState<Layer[]>([]);

  // 用于跟踪 Shift 键状态
  const isShiftPressedRef = useRef(false);

  /**
   * 确保元素有 ID
   */
  const ensureElementId = useCallback((obj: fabric.Object): string => {
    if (!obj.data?.id) {
      const id = generateId();
      obj.set("data", { ...obj.data, id });
    }
    return obj.data.id;
  }, []);

  /**
   * 同步图层列表
   */
  const syncLayers = useCallback(() => {
    if (!canvas) {
      setLayers([]);
      return;
    }

    const objects = canvas.getObjects();
    const newLayers: Layer[] = objects.map((obj, index) => {
      const id = ensureElementId(obj);
      return {
        id,
        name: obj.data?.name || getElementName(obj, index),
        type: getElementType(obj),
        visible: obj.visible !== false,
        locked: obj.selectable === false && obj.evented === false,
        fabricObjectRef: obj,
      };
    });

    // 反转顺序，使最上层的元素在列表顶部
    setLayers(newLayers.reverse());
    onLayersChange?.(newLayers.reverse());
  }, [canvas, ensureElementId, onLayersChange]);

  /**
   * 选中单个元素
   */
  const selectElement = useCallback(
    (id: string | null) => {
      if (!canvas) return;

      if (id === null) {
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        setSelectedIds([]);
        onSelectionChange?.([]);
        return;
      }

      const obj = canvas.getObjects().find((o) => o.data?.id === id);
      if (obj && obj.selectable !== false) {
        canvas.setActiveObject(obj);
        canvas.requestRenderAll();
        setSelectedIds([id]);
        onSelectionChange?.([id]);
      }
    },
    [canvas, onSelectionChange],
  );

  /**
   * 多选元素（Shift+点击）
   */
  const toggleElementSelection = useCallback(
    (id: string) => {
      if (!canvas) return;

      const obj = canvas.getObjects().find((o) => o.data?.id === id);
      if (!obj || obj.selectable === false) return;

      const currentSelection = canvas.getActiveObjects();
      const isSelected = currentSelection.some((o) => o.data?.id === id);

      let newSelection: fabric.Object[];
      if (isSelected) {
        // 从选择中移除
        newSelection = currentSelection.filter((o) => o.data?.id !== id);
      } else {
        // 添加到选择
        newSelection = [...currentSelection, obj];
      }

      if (newSelection.length === 0) {
        canvas.discardActiveObject();
      } else if (newSelection.length === 1) {
        canvas.setActiveObject(newSelection[0]);
      } else {
        const selection = new fabric.ActiveSelection(newSelection, { canvas });
        canvas.setActiveObject(selection);
      }

      canvas.requestRenderAll();

      const newIds = newSelection
        .map((o) => o.data?.id)
        .filter(Boolean) as string[];
      setSelectedIds(newIds);
      onSelectionChange?.(newIds);
    },
    [canvas, onSelectionChange],
  );

  /**
   * 清除选择
   */
  const clearSelection = useCallback(() => {
    if (!canvas) return;
    canvas.discardActiveObject();
    canvas.requestRenderAll();
    setSelectedIds([]);
    onSelectionChange?.([]);
  }, [canvas, onSelectionChange]);

  /**
   * 全选
   */
  const selectAll = useCallback(() => {
    if (!canvas) return;

    const selectableObjects = canvas
      .getObjects()
      .filter((obj) => obj.selectable !== false && obj.evented !== false);

    if (selectableObjects.length === 0) return;

    if (selectableObjects.length === 1) {
      canvas.setActiveObject(selectableObjects[0]);
    } else {
      const selection = new fabric.ActiveSelection(selectableObjects, {
        canvas,
      });
      canvas.setActiveObject(selection);
    }

    canvas.requestRenderAll();

    const ids = selectableObjects
      .map((o) => o.data?.id)
      .filter(Boolean) as string[];
    setSelectedIds(ids);
    onSelectionChange?.(ids);
  }, [canvas, onSelectionChange]);

  /**
   * 获取元素变换数据
   */
  const getElementTransform = useCallback(
    (id: string): ElementTransform | null => {
      if (!canvas) return null;

      const obj = canvas.getObjects().find((o) => o.data?.id === id);
      if (!obj) return null;

      return {
        id,
        left: obj.left || 0,
        top: obj.top || 0,
        scaleX: obj.scaleX || 1,
        scaleY: obj.scaleY || 1,
        angle: obj.angle || 0,
        width: obj.width || 0,
        height: obj.height || 0,
      };
    },
    [canvas],
  );

  /**
   * 设置元素变换
   */
  const setElementTransform = useCallback(
    (id: string, transform: Partial<ElementTransform>) => {
      if (!canvas) return;

      const obj = canvas.getObjects().find((o) => o.data?.id === id);
      if (!obj) return;

      const { id: _, ...transformProps } = transform;
      obj.set(transformProps);
      obj.setCoords();
      canvas.requestRenderAll();
    },
    [canvas],
  );

  /**
   * 组合选中元素
   */
  const groupSelected = useCallback((): string | null => {
    if (!canvas) return null;

    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== "activeSelection") return null;

    const activeSelection = activeObject as fabric.ActiveSelection;
    const objects = activeSelection.getObjects();

    if (objects.length < 2) return null;

    // 创建组
    const group = activeSelection.toGroup();
    const groupId = generateId();
    group.set("data", { id: groupId, name: `组合 ${Date.now()}` });

    canvas.requestRenderAll();
    syncLayers();

    setSelectedIds([groupId]);
    onSelectionChange?.([groupId]);

    return groupId;
  }, [canvas, syncLayers, onSelectionChange]);

  /**
   * 取消组合
   */
  const ungroupSelected = useCallback((): string[] => {
    if (!canvas) return [];

    const activeObject = canvas.getActiveObject();
    if (!activeObject || activeObject.type !== "group") return [];

    const group = activeObject as fabric.Group;
    const objects = group.getObjects();

    // 为每个子元素分配 ID
    objects.forEach((obj, index) => {
      if (!obj.data?.id) {
        obj.set("data", { id: generateId(), name: getElementName(obj, index) });
      }
    });

    // 取消组合
    group.toActiveSelection();
    canvas.requestRenderAll();
    syncLayers();

    const ids = objects.map((o) => o.data?.id).filter(Boolean) as string[];
    setSelectedIds(ids);
    onSelectionChange?.(ids);

    return ids;
  }, [canvas, syncLayers, onSelectionChange]);

  /**
   * 删除选中元素
   */
  const deleteSelected = useCallback(() => {
    if (!canvas) return;

    const activeObjects = canvas.getActiveObjects();
    if (activeObjects.length === 0) return;

    // 过滤掉锁定的元素
    const deletableObjects = activeObjects.filter(
      (obj) => obj.selectable !== false || obj.evented !== false,
    );

    if (deletableObjects.length === 0) return;

    canvas.discardActiveObject();
    deletableObjects.forEach((obj) => canvas.remove(obj));
    canvas.requestRenderAll();
    syncLayers();

    setSelectedIds([]);
    onSelectionChange?.([]);
  }, [canvas, syncLayers, onSelectionChange]);

  /**
   * 处理键盘事件
   */
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        isShiftPressedRef.current = true;
      }

      // Delete/Backspace 删除选中元素
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectedIds.length > 0
      ) {
        // 检查是否在输入框中
        const target = e.target as HTMLElement;
        if (
          target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable
        ) {
          return;
        }
        e.preventDefault();
        deleteSelected();
      }

      const action = resolvePosterCanvasHotkeyAction(e);
      if (!action) {
        return;
      }

      if (action === "select-all") {
        e.preventDefault();
        selectAll();
        return;
      }

      if (action === "group") {
        e.preventDefault();
        groupSelected();
        return;
      }

      if (action === "ungroup") {
        e.preventDefault();
        ungroupSelected();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === "Shift") {
        isShiftPressedRef.current = false;
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [selectedIds, deleteSelected, selectAll, groupSelected, ungroupSelected]);

  /**
   * 监听 Canvas 选择事件
   */
  useEffect(() => {
    if (!canvas) return;

    const handleSelectionCreated = (e: fabric.IEvent<Event>) => {
      const selected = e.selected || [];
      const ids = selected.map((obj) => ensureElementId(obj));
      setSelectedIds(ids);
      onSelectionChange?.(ids);
    };

    const handleSelectionUpdated = (e: fabric.IEvent<Event>) => {
      const selected = e.selected || [];
      const ids = selected.map((obj) => ensureElementId(obj));
      setSelectedIds(ids);
      onSelectionChange?.(ids);
    };

    const handleSelectionCleared = () => {
      setSelectedIds([]);
      onSelectionChange?.([]);
    };

    const handleObjectAdded = () => {
      syncLayers();
    };

    const handleObjectRemoved = () => {
      syncLayers();
    };

    canvas.on("selection:created", handleSelectionCreated);
    canvas.on("selection:updated", handleSelectionUpdated);
    canvas.on("selection:cleared", handleSelectionCleared);
    canvas.on("object:added", handleObjectAdded);
    canvas.on("object:removed", handleObjectRemoved);

    // 初始同步图层
    syncLayers();

    return () => {
      canvas.off(
        "selection:created",
        handleSelectionCreated as (e: fabric.IEvent<Event>) => void,
      );
      canvas.off(
        "selection:updated",
        handleSelectionUpdated as (e: fabric.IEvent<Event>) => void,
      );
      canvas.off("selection:cleared", handleSelectionCleared);
      canvas.off("object:added", handleObjectAdded);
      canvas.off("object:removed", handleObjectRemoved);
    };
  }, [canvas, ensureElementId, syncLayers, onSelectionChange]);

  /**
   * 处理 Shift+点击多选
   */
  useEffect(() => {
    if (!canvas) return;

    const handleMouseDown = (e: fabric.IEvent<Event>) => {
      const mouseEvent = e.e as MouseEvent;
      if (!mouseEvent.shiftKey) return;

      const target = e.target;
      if (!target) return;

      const id = target.data?.id;
      if (!id) return;

      // 阻止默认的选择行为
      e.e.preventDefault();
      toggleElementSelection(id);
    };

    canvas.on("mouse:down", handleMouseDown);

    return () => {
      canvas.off(
        "mouse:down",
        handleMouseDown as (e: fabric.IEvent<Event>) => void,
      );
    };
  }, [canvas, toggleElementSelection]);

  return {
    selectedIds,
    selectElement,
    toggleElementSelection,
    clearSelection,
    selectAll,
    getElementTransform,
    setElementTransform,
    groupSelected,
    ungroupSelected,
    deleteSelected,
    layers,
    syncLayers,
  };
}

/**
 * 元素变换工具函数（纯函数，用于测试）
 */
export const transformUtils = {
  /**
   * 计算移动后的位置
   */
  calculateMove: (
    initial: { left: number; top: number },
    delta: { x: number; y: number },
  ): { left: number; top: number } => {
    return {
      left: initial.left + delta.x,
      top: initial.top + delta.y,
    };
  },

  /**
   * 计算缩放后的尺寸
   */
  calculateScale: (
    initial: { scaleX: number; scaleY: number },
    factor: number,
  ): { scaleX: number; scaleY: number } => {
    return {
      scaleX: initial.scaleX * factor,
      scaleY: initial.scaleY * factor,
    };
  },

  /**
   * 计算旋转后的角度
   */
  calculateRotation: (initialAngle: number, deltaAngle: number): number => {
    // 标准化角度到 [0, 360) 范围
    let result = (initialAngle + deltaAngle) % 360;
    if (result < 0) result += 360;
    // 确保结果严格小于 360（处理浮点精度问题）
    if (result >= 360) result = result % 360;
    return result;
  },

  /**
   * 验证变换数据
   */
  isValidTransform: (transform: Partial<ElementTransform>): boolean => {
    if (transform.scaleX !== undefined && transform.scaleX <= 0) return false;
    if (transform.scaleY !== undefined && transform.scaleY <= 0) return false;
    if (transform.width !== undefined && transform.width < 0) return false;
    if (transform.height !== undefined && transform.height < 0) return false;
    return true;
  },
};

/**
 * 多选操作工具函数（纯函数，用于测试）
 */
export const selectionUtils = {
  /**
   * 计算 Shift+点击后的选择集合
   * @param currentSelection 当前选中的 ID 列表
   * @param clickedId 被点击的元素 ID
   * @returns 新的选择集合
   */
  calculateToggleSelection: (
    currentSelection: string[],
    clickedId: string,
  ): string[] => {
    const isSelected = currentSelection.includes(clickedId);
    if (isSelected) {
      // 从选择中移除
      return currentSelection.filter((id) => id !== clickedId);
    } else {
      // 添加到选择
      return [...currentSelection, clickedId];
    }
  },

  /**
   * 验证选择集合是否包含指定元素
   */
  selectionContains: (selection: string[], id: string): boolean => {
    return selection.includes(id);
  },

  /**
   * 验证选择集合是否不包含指定元素
   */
  selectionExcludes: (selection: string[], id: string): boolean => {
    return !selection.includes(id);
  },

  /**
   * 计算选择集合的大小
   */
  selectionSize: (selection: string[]): number => {
    return selection.length;
  },
};

/**
 * 组合操作工具函数（纯函数，用于测试）
 */
export const groupUtils = {
  /**
   * 验证组合操作的前置条件
   * @param selectedCount 选中元素数量
   * @returns 是否可以执行组合操作
   */
  canGroup: (selectedCount: number): boolean => {
    return selectedCount >= 2;
  },

  /**
   * 验证取消组合操作的前置条件
   * @param isGroup 是否为组对象
   * @returns 是否可以执行取消组合操作
   */
  canUngroup: (isGroup: boolean): boolean => {
    return isGroup;
  },

  /**
   * 计算组合后的元素数量变化
   * @param originalCount 原始元素数量
   * @param groupedCount 被组合的元素数量
   * @returns 组合后的元素数量
   */
  calculateGroupedCount: (
    originalCount: number,
    groupedCount: number,
  ): number => {
    // 组合后：原始数量 - 被组合数量 + 1（新组）
    return originalCount - groupedCount + 1;
  },

  /**
   * 计算取消组合后的元素数量变化
   * @param originalCount 原始元素数量
   * @param ungroupedCount 组内元素数量
   * @returns 取消组合后的元素数量
   */
  calculateUngroupedCount: (
    originalCount: number,
    ungroupedCount: number,
  ): number => {
    // 取消组合后：原始数量 - 1（组） + 组内元素数量
    return originalCount - 1 + ungroupedCount;
  },
};

/**
 * 删除操作工具函数（纯函数，用于测试）
 */
export const deleteUtils = {
  /**
   * 验证删除操作的前置条件
   * @param selectedCount 选中元素数量
   * @returns 是否可以执行删除操作
   */
  canDelete: (selectedCount: number): boolean => {
    return selectedCount > 0;
  },

  /**
   * 计算删除后的元素数量
   * @param originalCount 原始元素数量
   * @param deletedCount 被删除的元素数量
   * @returns 删除后的元素数量
   */
  calculateDeletedCount: (
    originalCount: number,
    deletedCount: number,
  ): number => {
    return Math.max(0, originalCount - deletedCount);
  },

  /**
   * 过滤可删除的元素（排除锁定的元素）
   * @param elements 元素列表
   * @param lockedIds 锁定的元素 ID 列表
   * @returns 可删除的元素 ID 列表
   */
  filterDeletableElements: (
    elements: string[],
    lockedIds: string[],
  ): string[] => {
    return elements.filter((id) => !lockedIds.includes(id));
  },

  /**
   * 验证删除后的状态
   * @param originalElements 原始元素 ID 列表
   * @param deletedElements 被删除的元素 ID 列表
   * @returns 删除后剩余的元素 ID 列表
   */
  calculateRemainingElements: (
    originalElements: string[],
    deletedElements: string[],
  ): string[] => {
    return originalElements.filter((id) => !deletedElements.includes(id));
  },

  /**
   * 验证元素是否已被删除
   * @param remainingElements 剩余元素列表
   * @param deletedId 被删除的元素 ID
   * @returns 元素是否已被删除
   */
  isDeleted: (remainingElements: string[], deletedId: string): boolean => {
    return !remainingElements.includes(deletedId);
  },

  /**
   * 验证删除后选择状态应该被清空
   * @param selectedIds 删除前选中的 ID 列表
   * @param deletedIds 被删除的 ID 列表
   * @returns 删除后应该保留的选中 ID 列表
   */
  calculateRemainingSelection: (
    selectedIds: string[],
    deletedIds: string[],
  ): string[] => {
    return selectedIds.filter((id) => !deletedIds.includes(id));
  },
};
