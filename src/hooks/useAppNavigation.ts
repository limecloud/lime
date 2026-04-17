import { useCallback, useLayoutEffect, useState } from "react";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { Page, PageParams } from "@/types/page";

export interface UseAppNavigationResult {
  currentPage: Page;
  pageParams: PageParams;
  requestedPage: Page;
  requestedPageParams: PageParams;
  navigationRequestId: number;
  isNavigating: boolean;
  handleNavigate: (page: Page, params?: PageParams) => void;
}

function normalizePageParams(params?: PageParams): PageParams {
  return params ? { ...params } : {};
}

function serializePageParams(params: PageParams): string {
  return JSON.stringify(params);
}

export function useAppNavigation(): UseAppNavigationResult {
  const [navigationState, setNavigationState] = useState<{
    currentPage: Page;
    currentPageParams: PageParams;
    currentPageParamsKey: string;
    requestedPage: Page;
    requestedPageParams: PageParams;
    requestedPageParamsKey: string;
    navigationRequestId: number;
  }>(() => {
    const initialPageParams = buildHomeAgentParams();
    const initialPageParamsKey = serializePageParams(initialPageParams);
    return {
      currentPage: "agent",
      currentPageParams: initialPageParams,
      currentPageParamsKey: initialPageParamsKey,
      requestedPage: "agent",
      requestedPageParams: initialPageParams,
      requestedPageParamsKey: initialPageParamsKey,
      navigationRequestId: 0,
    };
  });

  const handleNavigate = useCallback((page: Page, params?: PageParams) => {
    const nextPageParams = normalizePageParams(params);
    const nextPageParamsKey = serializePageParams(nextPageParams);

    setNavigationState((current) => {
      if (
        current.requestedPage === page &&
        current.requestedPageParamsKey === nextPageParamsKey
      ) {
        return current;
      }

      return {
        ...current,
        requestedPage: page,
        requestedPageParams: nextPageParams,
        requestedPageParamsKey: nextPageParamsKey,
        navigationRequestId: current.navigationRequestId + 1,
      };
    });
  }, []);

  useLayoutEffect(() => {
    setNavigationState((current) => {
      if (
        current.currentPage === current.requestedPage &&
        current.currentPageParamsKey === current.requestedPageParamsKey
      ) {
        return current;
      }

      return {
        ...current,
        currentPage: current.requestedPage,
        currentPageParams: current.requestedPageParams,
        currentPageParamsKey: current.requestedPageParamsKey,
      };
    });
  }, [
    navigationState.requestedPage,
    navigationState.requestedPageParamsKey,
  ]);

  const isNavigating =
    navigationState.currentPage !== navigationState.requestedPage ||
    navigationState.currentPageParamsKey !==
      navigationState.requestedPageParamsKey;

  return {
    currentPage: navigationState.currentPage,
    pageParams: navigationState.currentPageParams,
    requestedPage: navigationState.requestedPage,
    requestedPageParams: navigationState.requestedPageParams,
    navigationRequestId: navigationState.navigationRequestId,
    isNavigating,
    handleNavigate,
  };
}
