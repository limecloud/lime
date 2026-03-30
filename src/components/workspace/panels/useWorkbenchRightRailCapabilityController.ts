import { toast } from "sonner";
import { useWorkbenchRightRailAudioTasks } from "./useWorkbenchRightRailAudioTasks";
import { useWorkbenchRightRailActionPanelState } from "./useWorkbenchRightRailActionPanelState";
import { useWorkbenchRightRailGeneratedOutputs } from "./useWorkbenchRightRailGeneratedOutputs";
import { useWorkbenchRightRailImageTasks } from "./useWorkbenchRightRailImageTasks";
import { useWorkbenchRightRailVideoTasks } from "./useWorkbenchRightRailVideoTasks";

interface UseWorkbenchRightRailCapabilityControllerParams {
  projectId?: string | null;
  contentId?: string | null;
  initialExpandedActionKey?: string | null;
  onInitialExpandedActionConsumed?: () => void;
  onCreateContentFromPrompt?: (prompt: string) => Promise<void> | void;
}

export function useWorkbenchRightRailCapabilityController({
  projectId,
  contentId,
  initialExpandedActionKey,
  onInitialExpandedActionConsumed,
  onCreateContentFromPrompt,
}: UseWorkbenchRightRailCapabilityControllerParams) {
  const {
    closeExpandedAction,
    expandedActionKey,
    handleToggleActionPanel: toggleActionPanel,
  } = useWorkbenchRightRailActionPanelState({
    initialExpandedActionKey,
    onInitialExpandedActionConsumed,
  });
  const { appendGeneratedOutput, generatedOutputs } =
    useWorkbenchRightRailGeneratedOutputs();

  const handleSubmitPrompt = async (prompt: string): Promise<boolean> => {
    const normalizedPrompt = prompt.trim();
    if (!normalizedPrompt) {
      return false;
    }

    if (!onCreateContentFromPrompt) {
      toast.error("当前工作区暂不支持该操作");
      return false;
    }

    try {
      await onCreateContentFromPrompt(normalizedPrompt);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      toast.error(`提交失败：${message}`);
      return false;
    }
  };

  const imageTasks = useWorkbenchRightRailImageTasks({
    projectId,
    contentId,
    appendGeneratedOutput,
    handleSubmitPrompt,
  });
  const audioTasks = useWorkbenchRightRailAudioTasks({
    projectId,
    appendGeneratedOutput,
    handleSubmitPrompt,
  });
  const videoTasks = useWorkbenchRightRailVideoTasks({
    projectId,
    appendGeneratedOutput,
  });

  const handleToggleActionPanel = (actionKey: string) => {
    toggleActionPanel(actionKey, () => {
      audioTasks.closeVoiceoverPanel();
      audioTasks.closePodcastPanel();
    });
  };

  const closeSearchMaterialPanel = () => {
    imageTasks.closeSearchMaterialPanel();
    closeExpandedAction();
  };

  const closeVoiceoverPanel = () => {
    audioTasks.closeVoiceoverPanel();
    closeExpandedAction();
  };

  const closePodcastPanel = () => {
    audioTasks.closePodcastPanel();
    closeExpandedAction();
  };

  const handleImportPodcastPrompt = audioTasks.handleImportPodcastPrompt;

  return {
    expandedActionKey,
    generatedOutputs,
    handleSubmitPrompt,
    ...imageTasks,
    ...audioTasks,
    ...videoTasks,
    closeExpandedAction,
    closePodcastPanel,
    closeSearchMaterialPanel,
    closeVoiceoverPanel,
    handleImportPodcastPrompt,
    handleSubmitStoryboardTask: () =>
      videoTasks.handleSubmitStoryboardTask(handleSubmitPrompt),
    handleToggleActionPanel,
  };
}

export type WorkbenchRightRailCapabilityController = ReturnType<
  typeof useWorkbenchRightRailCapabilityController
>;
