import { useLayoutEffect, useSyncExternalStore, type ReactNode } from "react";
import {
  clearContextualSidebar,
  getContextualSidebarOutletMounted,
  publishContextualSidebar,
  subscribeContextualSidebar,
} from "./contextualSidebarStore";

/**
 * 页面把自身侧栏节点发布到 AppSidebar 的上下文槽位。
 *
 * 返回槽位是否已挂载；未挂载（组件测试单页渲染）时页面保留内联侧栏回退。
 */
export function useContextualSidebar(
  owner: string,
  node: ReactNode,
): boolean {
  const outletMounted = useSyncExternalStore(
    subscribeContextualSidebar,
    getContextualSidebarOutletMounted,
    getContextualSidebarOutletMounted,
  );

  useLayoutEffect(() => {
    publishContextualSidebar(owner, node);
    return () => clearContextualSidebar(owner);
  }, [owner, node]);

  return outletMounted;
}
