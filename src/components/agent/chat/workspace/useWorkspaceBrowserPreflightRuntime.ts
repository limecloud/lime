import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";
import { toast } from "sonner";
import type { BrowserTaskPreflight } from "../hooks/handleSendTypes";
import type { ConfirmResponse } from "../types";

type BrowserAssistAttentionLevel = "idle" | "info" | "warning";

type EnsureBrowserAssistCanvasHandler = (
  sourceText: string,
  options?: {
    silent?: boolean;
    navigationMode?: "none" | "explicit-url" | "best-effort";
  },
) => Promise<boolean>;

interface UseWorkspaceBrowserPreflightRuntimeParams {
  browserTaskPreflight: BrowserTaskPreflight | null;
  setBrowserTaskPreflight: Dispatch<
    SetStateAction<BrowserTaskPreflight | null>
  >;
  browserAssistLaunching: boolean;
  isBrowserAssistReady: boolean;
  ensureBrowserAssistCanvas: EnsureBrowserAssistCanvasHandler;
  handlePermissionResponse: (response: ConfirmResponse) => Promise<void>;
}

interface WorkspaceBrowserPreflightRuntimeResult {
  browserAssistEntryLabel: string;
  browserAssistAttentionLevel: BrowserAssistAttentionLevel;
  handlePermissionResponseWithBrowserPreflight: (
    response: ConfirmResponse,
  ) => Promise<void>;
}

function buildAwaitingUserDetail(preflight: BrowserTaskPreflight): string {
  if (preflight.requirement === "required_with_user_step") {
    return `已打开${preflight.platformLabel || "浏览器工作台"}。请先完成登录、扫码、验证码或授权，然后回到当前任务重新发起。`;
  }

  return "浏览器已经准备好。请确认页面可操作后，回到当前任务重新发起。";
}

export function useWorkspaceBrowserPreflightRuntime({
  browserTaskPreflight,
  setBrowserTaskPreflight,
  browserAssistLaunching,
  isBrowserAssistReady,
  ensureBrowserAssistCanvas,
  handlePermissionResponse,
}: UseWorkspaceBrowserPreflightRuntimeParams): WorkspaceBrowserPreflightRuntimeResult {
  const browserTaskPreflightLaunchIdRef = useRef("");

  const browserAssistEntryLabel = useMemo(() => {
    if (browserAssistLaunching || browserTaskPreflight?.phase === "launching") {
      return "浏览器启动中";
    }
    if (isBrowserAssistReady) {
      return "浏览器已就绪";
    }
    if (
      browserTaskPreflight?.phase === "awaiting_user" ||
      browserTaskPreflight?.phase === "ready_to_resume"
    ) {
      return "待浏览器处理";
    }
    if (browserTaskPreflight?.phase === "failed") {
      return "浏览器未连接";
    }
    return "浏览器协助";
  }, [
    browserAssistLaunching,
    browserTaskPreflight?.phase,
    isBrowserAssistReady,
  ]);

  const browserAssistAttentionLevel = useMemo<BrowserAssistAttentionLevel>(
    () => {
      if (browserAssistLaunching || browserTaskPreflight?.phase === "launching") {
        return "info";
      }

      if (!isBrowserAssistReady && browserTaskPreflight) {
        return "warning";
      }

      return "idle";
    },
    [browserAssistLaunching, browserTaskPreflight, isBrowserAssistReady],
  );

  const runBrowserTaskPreflight = useCallback(
    async (preflight: BrowserTaskPreflight) => {
      setBrowserTaskPreflight((current) =>
        current?.requestId === preflight.requestId
          ? {
              ...current,
              phase: "launching",
              detail: "正在准备浏览器上下文，请稍候...",
            }
          : current,
      );

      const launchInput = preflight.launchUrl || preflight.sourceText;
      const navigationMode =
        preflight.launchUrl && preflight.launchUrl !== preflight.sourceText
          ? ("explicit-url" as const)
          : ("best-effort" as const);

      try {
        const launched = await ensureBrowserAssistCanvas(launchInput, {
          silent: false,
          navigationMode,
        });

        if (!launched) {
          const detail = "还没有建立可用的浏览器会话。请确认本机浏览器可用后重试。";
          setBrowserTaskPreflight((current) =>
            current?.requestId === preflight.requestId
              ? {
                  ...current,
                  phase: "failed",
                  detail,
                }
              : current,
          );
          toast.error(detail);
          return;
        }

        const detail = buildAwaitingUserDetail(preflight);
        setBrowserTaskPreflight((current) =>
          current?.requestId === preflight.requestId
            ? {
                ...current,
                phase: "awaiting_user",
                detail,
              }
            : current,
        );
        toast.info(detail);
      } catch (error) {
        const detail =
          error instanceof Error && error.message
            ? error.message
            : "启动浏览器协助失败，请稍后重试。";
        setBrowserTaskPreflight((current) =>
          current?.requestId === preflight.requestId
            ? {
                ...current,
                phase: "failed",
                detail,
              }
            : current,
        );
        toast.error(detail);
      }
    },
    [ensureBrowserAssistCanvas, setBrowserTaskPreflight],
  );

  useEffect(() => {
    if (!browserTaskPreflight) {
      return;
    }

    if (!isBrowserAssistReady) {
      if (
        browserTaskPreflight.phase === "awaiting_user" ||
        browserTaskPreflight.phase === "ready_to_resume"
      ) {
        setBrowserTaskPreflight((current) =>
          current?.requestId === browserTaskPreflight.requestId
            ? {
                ...current,
                phase: "failed",
                detail: "浏览器会话已断开，请重新启动浏览器后再重试。",
              }
            : current,
        );
      }
      return;
    }

    if (
      browserTaskPreflight.phase === "launching" ||
      browserTaskPreflight.phase === "failed"
    ) {
      setBrowserTaskPreflight((current) =>
        current?.requestId === browserTaskPreflight.requestId
          ? {
              ...current,
              phase: "ready_to_resume",
              detail: "浏览器已经连接。完成必要操作后，请回到当前任务重新发起。",
            }
          : current,
      );
    }
  }, [browserTaskPreflight, isBrowserAssistReady, setBrowserTaskPreflight]);

  useEffect(() => {
    if (!browserTaskPreflight || browserTaskPreflight.phase !== "launching") {
      if (!browserTaskPreflight) {
        browserTaskPreflightLaunchIdRef.current = "";
      }
      return;
    }

    if (
      browserTaskPreflightLaunchIdRef.current === browserTaskPreflight.requestId
    ) {
      return;
    }

    browserTaskPreflightLaunchIdRef.current = browserTaskPreflight.requestId;
    void runBrowserTaskPreflight(browserTaskPreflight);
  }, [browserTaskPreflight, runBrowserTaskPreflight]);

  const handlePermissionResponseWithBrowserPreflight = useCallback(
    async (response: ConfirmResponse) => {
      await handlePermissionResponse(response);
    },
    [handlePermissionResponse],
  );

  return {
    browserAssistEntryLabel,
    browserAssistAttentionLevel,
    handlePermissionResponseWithBrowserPreflight,
  };
}
