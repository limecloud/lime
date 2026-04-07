import type { ComponentProps, ReactNode } from "react";
import { StepProgress } from "@/lib/workspace/workbenchUi";
import { WorkspaceConversationScene } from "./WorkspaceConversationScene";
import { MessageList } from "../components/MessageList";
import { TeamWorkspaceDock } from "../components/TeamWorkspaceDock";
import {
  buildStepProgressProps,
  buildTeamWorkspaceDockProps,
} from "./chatSurfaceProps";
import type { TeamWorkbenchSurfaceProps } from "./teamWorkbenchPresentation";

type WorkspaceConversationSceneProps = ComponentProps<
  typeof WorkspaceConversationScene
>;
type CanvasWorkbenchLayoutProps = NonNullable<
  WorkspaceConversationSceneProps["canvasWorkbenchLayoutProps"]
>;

interface UseWorkspaceConversationScenePresentationParams {
  scene: Omit<
    WorkspaceConversationSceneProps,
    | "workspaceAlertVisible"
    | "projectId"
    | "canvasWorkbenchLayoutProps"
    | "stepProgressProps"
    | "teamWorkspaceDockProps"
    | "messageListProps"
  > & {
    projectId: string | null | undefined;
  };
  stepProgress: {
    hidden: boolean;
    isSpecializedThemeMode: boolean;
    hasMessages: boolean;
    steps: ComponentProps<typeof StepProgress>["steps"];
    currentIndex: ComponentProps<typeof StepProgress>["currentIndex"];
    onStepClick: NonNullable<
      ComponentProps<typeof StepProgress>["onStepClick"]
    >;
  };
  messageList: ComponentProps<typeof MessageList>;
  teamWorkspaceDock: {
    enabled: boolean;
    shouldShowFloatingInputOverlay: boolean;
    layoutMode: "chat" | "chat-canvas";
    onActivateWorkbench: NonNullable<
      ComponentProps<typeof TeamWorkspaceDock>["onActivateWorkbench"]
    >;
    withBottomOverlay: boolean;
    surfaceProps: TeamWorkbenchSurfaceProps;
  };
  workspaceAlert: {
    workspacePathMissing: boolean;
    workspaceHealthError: boolean;
  };
  canvasWorkbenchLayout: Omit<
    CanvasWorkbenchLayoutProps,
    "workspaceUnavailable"
  >;
}

interface WorkspaceConversationScenePresentationResult {
  workspaceAlertVisible: boolean;
  mainAreaNode: ReactNode;
}

export function useWorkspaceConversationScenePresentation({
  scene,
  stepProgress,
  messageList,
  teamWorkspaceDock,
  workspaceAlert,
  canvasWorkbenchLayout,
}: UseWorkspaceConversationScenePresentationParams): WorkspaceConversationScenePresentationResult {
  const stepProgressProps = buildStepProgressProps(stepProgress);
  const teamWorkspaceDockProps = buildTeamWorkspaceDockProps(teamWorkspaceDock);
  const workspaceAlertVisible = Boolean(
    workspaceAlert.workspacePathMissing || workspaceAlert.workspaceHealthError,
  );

  const canvasWorkbenchLayoutProps: CanvasWorkbenchLayoutProps = {
    ...canvasWorkbenchLayout,
    workspaceUnavailable: workspaceAlertVisible,
  };

  return {
    workspaceAlertVisible,
    mainAreaNode: (
      <WorkspaceConversationScene
        {...scene}
        stepProgressProps={stepProgressProps}
        messageListProps={messageList}
        teamWorkspaceDockProps={teamWorkspaceDockProps}
        workspaceAlertVisible={workspaceAlertVisible}
        projectId={scene.projectId ?? null}
        canvasWorkbenchLayoutProps={canvasWorkbenchLayoutProps}
      />
    ),
  };
}
