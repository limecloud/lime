import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";

export interface InputbarToolStates {
  webSearch: boolean;
  thinking: boolean;
  subagent: boolean;
}

interface UseInputbarToolStateParams {
  toolStates?: Partial<InputbarToolStates>;
  onToolStatesChange?: (states: InputbarToolStates) => void;
  openFileDialog: () => void;
}

const DEFAULT_INPUTBAR_TOOL_STATES: InputbarToolStates = {
  webSearch: false,
  thinking: false,
  subagent: false,
};

export function useInputbarToolState({
  toolStates,
  onToolStatesChange,
  openFileDialog,
}: UseInputbarToolStateParams) {
  const [localToolStates, setLocalToolStates] = useState<InputbarToolStates>(
    DEFAULT_INPUTBAR_TOOL_STATES,
  );
  const [isFullscreen, setIsFullscreen] = useState(false);

  const webSearchEnabled =
    toolStates?.webSearch ?? localToolStates.webSearch;
  const thinkingEnabled = toolStates?.thinking ?? localToolStates.thinking;
  const subagentEnabled = toolStates?.subagent ?? localToolStates.subagent;

  const activeTools = useMemo<Record<string, boolean>>(
    () => ({
      web_search: webSearchEnabled,
      thinking: thinkingEnabled,
      subagent_mode: subagentEnabled,
    }),
    [thinkingEnabled, webSearchEnabled, subagentEnabled],
  );

  const updateToolStates = useCallback(
    (next: InputbarToolStates) => {
      setLocalToolStates((prev) => ({
        webSearch: toolStates?.webSearch ?? next.webSearch ?? prev.webSearch,
        thinking: toolStates?.thinking ?? next.thinking ?? prev.thinking,
        subagent: toolStates?.subagent ?? next.subagent ?? prev.subagent,
      }));
      onToolStatesChange?.(next);
      return next;
    },
    [
      onToolStatesChange,
      toolStates?.subagent,
      toolStates?.thinking,
      toolStates?.webSearch,
    ],
  );

  const handleToolClick = useCallback(
    (tool: string) => {
      switch (tool) {
        case "thinking": {
          const nextThinking = !thinkingEnabled;
          updateToolStates({
            webSearch: webSearchEnabled,
            thinking: nextThinking,
            subagent: subagentEnabled,
          });
          toast.info(`深度思考${nextThinking ? "已开启" : "已关闭"}`);
          break;
        }
        case "web_search": {
          const nextWebSearch = !webSearchEnabled;
          updateToolStates({
            webSearch: nextWebSearch,
            thinking: thinkingEnabled,
            subagent: subagentEnabled,
          });
          toast.info(`联网搜索${nextWebSearch ? "已开启" : "已关闭"}`);
          break;
        }
        case "subagent_mode": {
          const nextSubagent = !subagentEnabled;
          updateToolStates({
            webSearch: webSearchEnabled,
            thinking: thinkingEnabled,
            subagent: nextSubagent,
          });
          toast.info(`多代理${nextSubagent ? "偏好已开启" : "偏好已关闭"}`);
          break;
        }
        case "attach":
          openFileDialog();
          break;
        case "fullscreen":
          setIsFullscreen((prev) => !prev);
          toast.info(isFullscreen ? "已退出全屏" : "已进入全屏编辑");
          break;
        default:
          break;
      }
    },
    [
      isFullscreen,
      openFileDialog,
      thinkingEnabled,
      subagentEnabled,
      updateToolStates,
      webSearchEnabled,
    ],
  );

  const setSubagentEnabled = useCallback(
    (enabled: boolean) => {
      if (enabled === subagentEnabled) {
        return;
      }
      updateToolStates({
        webSearch: webSearchEnabled,
        thinking: thinkingEnabled,
        subagent: enabled,
      });
      toast.info(`多代理${enabled ? "偏好已开启" : "偏好已关闭"}`);
    },
    [
      subagentEnabled,
      thinkingEnabled,
      updateToolStates,
      webSearchEnabled,
    ],
  );

  return {
    activeTools,
    handleToolClick,
    setSubagentEnabled,
    isFullscreen,
    thinkingEnabled,
    subagentEnabled,
    webSearchEnabled,
  };
}
