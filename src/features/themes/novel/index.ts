import type { ThemeModule } from "@/features/themes/types";
import {
  DefaultMaterialPanel,
  DefaultSettingsPanel,
} from "@/features/themes/shared/panelRenderers";
import {
  NovelPublishPanel,
  NovelWorkflowPanel,
} from "@/features/themes/novel/panelRenderers";
import { NovelThemeWorkspace } from "./NovelThemeWorkspace";

export const novelThemeModule: ThemeModule = {
  theme: "novel",
  capabilities: {
    workspaceKind: "agent-chat",
    workspaceNotice: {
      message: "可在工作区内切换到「流程」视图执行大纲、角色、章节与一致性检查",
      actionLabel: "打开流程视图",
    },
  },
  navigation: {
    defaultView: "create",
    items: [
      { key: "create", label: "创作" },
      { key: "workflow", label: "流程" },
      { key: "material", label: "素材" },
      { key: "publish", label: "发布" },
      { key: "settings", label: "设置" },
    ],
  },
  primaryWorkspaceRenderer: NovelThemeWorkspace,
  panelRenderers: {
    workflow: NovelWorkflowPanel,
    material: DefaultMaterialPanel,
    publish: NovelPublishPanel,
    settings: DefaultSettingsPanel,
  },
};
