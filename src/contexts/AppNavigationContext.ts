import { createContext, useContext } from "react";
import type { Page, PageParams } from "@/types/page";

/** 深层宿主工具委托应用已有导航，保留离开页面的草稿守卫。 */
export const AppNavigationContext = createContext<
  ((page: Page, params?: PageParams) => void) | null
>(null);
export const useAppNavigationRequest = () => useContext(AppNavigationContext);
