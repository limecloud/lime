/**
 * @file ProjectDetailPage.tsx
 * @description 项目详情页组件，Tab 化展示各功能模块
 * @module components/projects/ProjectDetailPage
 * @requirements 5.1, 5.2
 */

import { useState } from "react";
import { useProject } from "@/hooks/useProject";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { ArrowLeftIcon, FolderIcon } from "lucide-react";
import {
  ContentTab,
  PersonaTab,
  MaterialTab,
  PublishTab,
  SettingsTab,
} from "./tabs";

export type ProjectTab =
  | "content"
  | "persona"
  | "material"
  | "publish"
  | "settings";

export interface ProjectDetailPageProps {
  /** 项目 ID */
  projectId: string;
  /** 返回回调 */
  onBack?: () => void;
  /** 导航到聊天页面 */
  onNavigateToChat?: (projectId: string) => void;
}

/**
 * 项目详情页组件
 *
 * 显示项目的各个功能模块，通过 Tab 切换。
 */
export function ProjectDetailPage({
  projectId,
  onBack,
  onNavigateToChat,
}: ProjectDetailPageProps) {
  const { project, loading, error } = useProject(projectId);
  const [activeTab, setActiveTab] = useState<ProjectTab>("content");

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">加载中...</div>
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <div className="text-destructive">{error || "项目不存在"}</div>
        <Button variant="outline" onClick={onBack}>
          返回
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* 头部 */}
      <div className="flex items-center gap-4 p-4 border-b">
        <Button variant="ghost" size="icon" onClick={onBack}>
          <ArrowLeftIcon className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-2">
          {project.icon ? (
            <span className="text-2xl">{project.icon}</span>
          ) : (
            <FolderIcon className="h-6 w-6 text-muted-foreground" />
          )}
          <h1 className="text-xl font-semibold">{project.name}</h1>
        </div>
      </div>

      {/* Tab 内容 */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => setActiveTab(v as ProjectTab)}
        className="flex-1 min-h-0 flex flex-col"
      >
        <TabsList className="mx-4 mt-4 justify-start">
          <TabsTrigger value="content">内容</TabsTrigger>
          <TabsTrigger value="persona">人设</TabsTrigger>
          <TabsTrigger value="material">素材</TabsTrigger>
          <TabsTrigger value="publish">发布</TabsTrigger>
          <TabsTrigger value="settings">设置</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 overflow-hidden">
          <TabsContent value="content" className="h-full m-0 overflow-y-auto">
            <ContentTab
              projectId={projectId}
              projectName={project.name}
              workspaceType={project.workspaceType}
              onNewTopic={() => onNavigateToChat?.(projectId)}
            />
          </TabsContent>
          <TabsContent value="persona" className="h-full m-0 overflow-y-auto">
            <PersonaTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="material" className="h-full m-0 overflow-y-auto">
            <MaterialTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="publish" className="h-full m-0 overflow-y-auto">
            <PublishTab projectId={projectId} />
          </TabsContent>
          <TabsContent value="settings" className="h-full m-0 overflow-y-auto">
            <SettingsTab projectId={projectId} workspaceType={project.workspaceType} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

export default ProjectDetailPage;
