import { createContext } from "react";

/** 标签导航身份不改变格式编辑器或批注草稿的生命周期。 */
export const ArtifactNavigationContext = createContext<{
  tabId: string;
  active: boolean;
} | null>(null);
