import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import { getAgentRuntimeSession } from "@/lib/api/agentRuntime/sessionClient";
import {
  closeBrowserTab,
  isBrowserTabHostAvailable,
} from "@/lib/api/browserTab";
import {
  createBrowserWorkspaceLinkTab,
  type BrowserWorkspaceIdentity,
} from "@/lib/api/browserWorkspace";
import { getProject } from "@/lib/api/project";
import {
  consumeWorkspaceRightSurfacePending,
  requestWorkspaceRightSurface,
} from "@/lib/api/workspaceRightSurface";
import { buildConversationParams } from "@/lib/workspace/navigation";
import { areWorkspacePathsIdentical } from "@/lib/workspace/pathIdentity";
import type {
  AgentLocation,
  Page,
  PageParams,
  SettingsPageParams,
} from "@/types/page";

interface Params {
  page: Page;
  pageParams: PageParams;
  navigationRequestId: number;
  agentLocation: AgentLocation | null;
  settingsReturnLocation: Readonly<AgentLocation> | null;
  navigate: (page: Page, params?: PageParams) => void;
  tryNavigate: (page: Page, params?: PageParams) => boolean;
}

export function useBrowserHistoryNavigation({
  page,
  pageParams,
  navigationRequestId,
  agentLocation,
  settingsReturnLocation,
  navigate,
  tryNavigate,
}: Params) {
  const target = (pageParams as SettingsPageParams).browserReturnOwner;
  const owner = useMemo(
    () =>
      page === "settings" &&
      target?.runtimeSessionId.trim() &&
      target.threadId.trim()
        ? {
            runtimeSessionId: target.runtimeSessionId,
            threadId: target.threadId,
            workspaceId: target.workspaceId ?? null,
          }
        : null,
    [page, target?.runtimeSessionId, target?.threadId, target?.workspaceId],
  );
  const returnLocation = useMemo(
    () =>
      page === "settings" &&
      !target &&
      settingsReturnLocation?.sessionId?.trim()
        ? {
            sessionId: settingsReturnLocation.sessionId.trim(),
            workspaceId: settingsReturnLocation.workspaceId?.trim() || null,
          }
        : null,
    [
      page,
      target,
      settingsReturnLocation?.sessionId,
      settingsReturnLocation?.workspaceId,
    ],
  );
  const lifetime = useMemo(
    () => ({ alive: false, navigationRequestId, owner, returnLocation }),
    [navigationRequestId, owner, returnLocation],
  );
  const current = useRef(lifetime);
  current.current = lifetime;
  const pending = useRef<symbol | null>(null);
  useLayoutEffect(() => {
    lifetime.alive = true;
    return () => {
      lifetime.alive = false;
    };
  }, [lifetime]);

  const navigateFromBrowser = useCallback(
    (nextPage: Page, params?: PageParams) => {
      const settings = params as SettingsPageParams | undefined;
      if (page === "settings" && nextPage === "settings") {
        const next = { ...settings };
        if (owner) next.browserReturnOwner = owner;
        else delete next.browserReturnOwner;
        navigate("settings", next);
        return;
      }
      if (nextPage !== "settings" || !settings?.browserReturnOwner) {
        navigate(nextPage, params);
        return;
      }
      const { browserReturnOwner, ...rest } = settings;
      const matchesLocation =
        page === "agent" &&
        agentLocation?.sessionId === browserReturnOwner.runtimeSessionId &&
        Boolean(browserReturnOwner.threadId.trim());
      navigate("settings", {
        ...rest,
        ...(matchesLocation
          ? {
              browserReturnOwner: {
                ...browserReturnOwner,
                workspaceId: agentLocation.workspaceId,
              },
            }
          : {}),
      });
    },
    [agentLocation, navigate, owner, page],
  );

  const openHistoryUrl = useCallback(
    async (url: string) => {
      const isCurrent = () => current.current === lifetime && lifetime.alive;
      if ((!owner && !returnLocation) || !isCurrent()) return;
      const address = new URL(url);
      if (address.protocol !== "http:" && address.protocol !== "https:")
        throw new Error("Browser history requires an HTTP or HTTPS address");
      if (pending.current)
        throw new Error("A browser history page is already opening");
      const operation = Symbol();
      pending.current = operation;
      let next: BrowserWorkspaceIdentity | null = null;
      let requestId: string | null = null;
      let transferred = false;
      let failed = false;
      let failure: unknown;
      try {
        let resolvedOwner = owner;
        if (!resolvedOwner && returnLocation) {
          const detail = await getAgentRuntimeSession(
            returnLocation.sessionId,
            {
              source: "browserHistory",
              historyLimit: 1,
            },
          );
          if (isCurrent()) {
            const runtimeSessionId = detail.id?.trim();
            const threadId = detail.thread_id?.trim();
            const canonicalWorkspaceId = detail.workspace_id?.trim() || null;
            const workspaceId = returnLocation.workspaceId;
            if (
              runtimeSessionId !== returnLocation.sessionId ||
              !threadId ||
              (detail.thread_read != null &&
                detail.thread_read.thread_id?.trim() !== threadId) ||
              (canonicalWorkspaceId !== null &&
                canonicalWorkspaceId !== workspaceId)
            )
              throw new Error(
                "Browser history canonical return owner mismatch",
              );
            if (workspaceId !== null) {
              const workspace = await getProject(workspaceId);
              if (
                isCurrent() &&
                (workspace?.id !== workspaceId ||
                  !areWorkspacePathsIdentical(
                    workspace.rootPath,
                    detail.working_dir,
                  ))
              )
                throw new Error(
                  "Browser history canonical return owner mismatch",
                );
            }
            if (isCurrent())
              resolvedOwner = { runtimeSessionId, threadId, workspaceId };
          }
        }
        if (resolvedOwner && isCurrent()) {
          next = await createBrowserWorkspaceLinkTab({
            owner: {
              runtimeSessionId: resolvedOwner.runtimeSessionId,
              threadId: resolvedOwner.threadId,
            },
            url,
            background: false,
            isCurrent,
          });
          if (isCurrent()) {
            if (!next) throw new Error("Browser history did not create a tab");
            const response = await requestWorkspaceRightSurface({
              surfaceKind: "browser",
              origin: "user",
              priority: "foreground",
              reason: "open_browser_history",
              sessionId: resolvedOwner.runtimeSessionId,
              workspaceId: resolvedOwner.workspaceId,
              workspaceRoot: null,
              candidateId: url,
              metadata: { browser: { launchUrl: url, tabId: next.tabId } },
            });
            requestId = response.requestId;
            if (isCurrent()) {
              if (
                !tryNavigate(
                  "agent",
                  buildConversationParams({
                    initialSessionId: resolvedOwner.runtimeSessionId,
                    projectId: resolvedOwner.workspaceId ?? undefined,
                  }),
                )
              )
                throw new Error("Browser history navigation was blocked");
              transferred = true;
            }
          }
        }
      } catch (error) {
        failed = isCurrent();
        failure = error;
      }
      try {
        if (!transferred && next) {
          const results = await Promise.allSettled([
            ...(requestId
              ? [consumeWorkspaceRightSurfacePending({ requestId })]
              : []),
            closeBrowserTab(next.tabId),
          ]);
          const errors = results.flatMap((result) =>
            result.status === "rejected" ? [result.reason] : [],
          );
          if (errors.length)
            throw new AggregateError(
              [...(failed ? [failure] : []), ...errors],
              "Browser history tab cleanup failed",
            );
        }
        if (failed) throw failure;
      } finally {
        if (pending.current === operation) pending.current = null;
      }
    },
    [lifetime, owner, returnLocation, tryNavigate],
  );

  return {
    navigateFromBrowser,
    openHistoryUrl:
      (owner || returnLocation) && isBrowserTabHostAvailable()
        ? openHistoryUrl
        : null,
  };
}
