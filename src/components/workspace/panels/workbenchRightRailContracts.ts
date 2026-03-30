import type { CreationMode } from "@/lib/workspace/workbenchContract";
import type { WorkspaceTheme } from "@/types/page";

export interface WorkbenchRightRailProps {
  shouldRender: boolean;
  isCreateWorkspaceView: boolean;
  projectId?: string | null;
  contentId?: string | null;
  theme?: WorkspaceTheme;
  creationMode?: CreationMode;
  creationType?: string;
  onBackToCreateView: () => void;
  onCreateContentFromPrompt?: (prompt: string) => Promise<void> | void;
}
