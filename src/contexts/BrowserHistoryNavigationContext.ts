import { createContext } from "react";

/** 历史页只委托当前会话导航，不自行分配 Browser 或 Thread identity。 */
export const BrowserHistoryNavigationContext = createContext<
  ((url: string) => Promise<void>) | null
>(null);
