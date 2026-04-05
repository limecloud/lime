import { useCallback, useState } from "react";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { Page, PageParams } from "@/types/page";

export interface UseAppNavigationResult {
  currentPage: Page;
  pageParams: PageParams;
  handleNavigate: (page: Page, params?: PageParams) => void;
}

export function useAppNavigation(): UseAppNavigationResult {
  const [currentPage, setCurrentPage] = useState<Page>("agent");
  const [pageParams, setPageParams] = useState<PageParams>(() =>
    buildHomeAgentParams(),
  );

  const handleNavigate = useCallback((page: Page, params?: PageParams) => {
    setCurrentPage(page);
    setPageParams(params ? { ...params } : {});
  }, []);

  return {
    currentPage,
    pageParams,
    handleNavigate,
  };
}
