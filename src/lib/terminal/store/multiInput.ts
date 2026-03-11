/**
 * @file multiInput.ts
 * @description 多输入模式状态管理
 * @module lib/terminal/store/multiInput
 *
 * 实现多输入模式的状态管理和输入广播逻辑。
 *
 * _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5_
 */

import { atom } from "jotai";
import { atomFamily } from "jotai/utils";
import { writeToTerminalRaw, encodeBase64 } from "@/lib/api/terminal";

// ============================================================================
// 类型定义
// ============================================================================

/**
 * 终端信息
 */
export interface TerminalInfo {
  /** 块 ID（会话 ID） */
  blockId: string;
  /** 标签页 ID */
  tabId: string;
  /** 是否为基础终端（非 VDOM、非 cmd 控制器）
   * _Requirements: 10.2_
   */
  isBasicTerminal: boolean;
  /** 是否活跃 */
  isActive: boolean;
}

// ============================================================================
// 多输入模式原子
// ============================================================================

/**
 * 多输入模式状态原子族（按 tabId 索引）
 *
 * 多输入模式状态存储在 Tab 级别。
 *
 * _Requirements: 10.5_
 */
export const multiInputEnabledAtomFamily = atomFamily((_tabId: string) =>
  atom<boolean>(false),
);

/**
 * 活跃终端列表原子族（按 tabId 索引）
 *
 * 存储当前 Tab 下所有活跃的基础终端。
 */
export const activeTerminalsAtomFamily = atomFamily((_tabId: string) =>
  atom<TerminalInfo[]>([]),
);

// ============================================================================
// 操作原子
// ============================================================================

/**
 * 切换多输入模式
 *
 * _Requirements: 10.4_
 */
export const toggleMultiInputAtom = atom(null, (get, set, tabId: string) => {
  const currentValue = get(multiInputEnabledAtomFamily(tabId));
  set(multiInputEnabledAtomFamily(tabId), !currentValue);
});

/**
 * 启用多输入模式
 */
export const enableMultiInputAtom = atom(null, (get, set, tabId: string) => {
  set(multiInputEnabledAtomFamily(tabId), true);
});

/**
 * 禁用多输入模式
 */
export const disableMultiInputAtom = atom(null, (get, set, tabId: string) => {
  set(multiInputEnabledAtomFamily(tabId), false);
});

/**
 * 注册终端到活跃列表
 */
export const registerTerminalAtom = atom(
  null,
  (get, set, terminal: TerminalInfo) => {
    const terminals = get(activeTerminalsAtomFamily(terminal.tabId));
    const exists = terminals.some((t) => t.blockId === terminal.blockId);

    if (!exists) {
      set(activeTerminalsAtomFamily(terminal.tabId), [...terminals, terminal]);
    } else {
      // 更新现有终端信息
      set(
        activeTerminalsAtomFamily(terminal.tabId),
        terminals.map((t) => (t.blockId === terminal.blockId ? terminal : t)),
      );
    }
  },
);

/**
 * 从活跃列表移除终端
 */
export const unregisterTerminalAtom = atom(
  null,
  (get, set, { tabId, blockId }: { tabId: string; blockId: string }) => {
    const terminals = get(activeTerminalsAtomFamily(tabId));
    set(
      activeTerminalsAtomFamily(tabId),
      terminals.filter((t) => t.blockId !== blockId),
    );
  },
);

/**
 * 更新终端活跃状态
 */
export const updateTerminalActiveAtom = atom(
  null,
  (
    get,
    set,
    {
      tabId,
      blockId,
      isActive,
    }: { tabId: string; blockId: string; isActive: boolean },
  ) => {
    const terminals = get(activeTerminalsAtomFamily(tabId));
    set(
      activeTerminalsAtomFamily(tabId),
      terminals.map((t) => (t.blockId === blockId ? { ...t, isActive } : t)),
    );
  },
);

// ============================================================================
// 派生原子
// ============================================================================

/**
 * 获取可广播的终端列表
 *
 * 只返回基础终端（非 VDOM、非 cmd 控制器）。
 *
 * _Requirements: 10.2_
 */
export const broadcastableTerminalsAtomFamily = atomFamily((tabId: string) =>
  atom((get) => {
    const terminals = get(activeTerminalsAtomFamily(tabId));
    return terminals.filter((t) => t.isBasicTerminal && t.isActive);
  }),
);

/**
 * 获取多输入模式下的目标终端数量
 */
export const multiInputTargetCountAtomFamily = atomFamily((tabId: string) =>
  atom((get) => {
    const enabled = get(multiInputEnabledAtomFamily(tabId));
    if (!enabled) return 0;

    const terminals = get(broadcastableTerminalsAtomFamily(tabId));
    return terminals.length;
  }),
);

// ============================================================================
// 输入广播函数
// ============================================================================

/**
 * 广播输入到所有活跃的基础终端
 *
 * _Requirements: 10.1_
 *
 * @param tabId - 标签页 ID
 * @param data - 输入数据（字符串）
 * @param terminals - 目标终端列表
 * @returns 成功发送的终端数量
 */
export async function broadcastInput(
  tabId: string,
  data: string,
  terminals: TerminalInfo[],
): Promise<number> {
  const base64Data = encodeBase64(data);
  let successCount = 0;

  // 并行发送到所有终端
  const results = await Promise.allSettled(
    terminals.map(async (terminal) => {
      try {
        await writeToTerminalRaw(terminal.blockId, base64Data);
        return true;
      } catch (err) {
        console.error(
          `[broadcastInput] 发送到终端 ${terminal.blockId} 失败:`,
          err,
        );
        return false;
      }
    }),
  );

  // 统计成功数量
  for (const result of results) {
    if (result.status === "fulfilled" && result.value) {
      successCount++;
    }
  }

  return successCount;
}

/**
 * 创建多输入处理器
 *
 * 返回一个函数，用于处理输入并根据多输入模式决定是否广播。
 *
 * @param tabId - 标签页 ID
 * @param currentBlockId - 当前终端的块 ID
 * @param getMultiInputEnabled - 获取多输入模式状态的函数
 * @param getBroadcastableTerminals - 获取可广播终端列表的函数
 * @returns 输入处理函数
 */
export function createMultiInputHandler(
  tabId: string,
  currentBlockId: string,
  getMultiInputEnabled: () => boolean,
  getBroadcastableTerminals: () => TerminalInfo[],
) {
  return async (data: string): Promise<void> => {
    const multiInputEnabled = getMultiInputEnabled();

    if (multiInputEnabled) {
      // 多输入模式：广播到所有基础终端
      const terminals = getBroadcastableTerminals();
      await broadcastInput(tabId, data, terminals);
    } else {
      // 单输入模式：只发送到当前终端
      const base64Data = encodeBase64(data);
      await writeToTerminalRaw(currentBlockId, base64Data);
    }
  };
}
