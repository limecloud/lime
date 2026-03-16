/**
 * @file 图片生成页面
 * @description 插图功能 - 包含图片搜索、AI生图、本地图片、我的图片库四个 Tab
 * @module components/image-gen/ImageGenPage
 */

import { useEffect, useMemo, useState } from "react";
import styled, { keyframes } from "styled-components";
import { ChevronDown } from "lucide-react";
import { CanvasBreadcrumbHeader } from "@/components/content-creator/canvas/shared/CanvasBreadcrumbHeader";
import { useProjects } from "@/hooks/useProjects";
import {
  getStoredResourceProjectId,
  onResourceProjectChange,
  setStoredResourceProjectId,
} from "@/lib/resourceProjectSelection";
import { buildHomeAgentParams } from "@/lib/workspace/navigation";
import type { Page, PageParams } from "@/types/page";
import { AiImageGenTab } from "./tabs/AiImageGenTab";
import { ImageSearchTab } from "./tabs/ImageSearchTab";
import { LocalImageTab } from "./tabs/LocalImageTab";
import { MyGalleryTab } from "./tabs/MyGalleryTab";

type PageNavigate = (page: Page, params?: PageParams) => void;

interface ImageGenPageProps {
  onNavigate?: PageNavigate;
}

const PageLayout = styled.div`
  position: relative;
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background: linear-gradient(180deg, hsl(210 40% 98%) 0%, hsl(0 0% 100%) 100%);
`;

const PageChrome = styled.div`
  position: relative;
  z-index: 1;
  display: flex;
  flex-direction: column;
  padding: 8px 10px 0;
  flex-shrink: 0;

  @media (max-width: 960px) {
    padding: 8px 8px 0;
  }
`;

const HeaderBar = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 10px;
  border-radius: 18px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--background) / 0.82);
  box-shadow:
    0 12px 28px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.74);
  backdrop-filter: blur(16px);

  @media (max-width: 960px) {
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
  }
`;

const HeaderLead = styled.div`
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;

  @media (max-width: 960px) {
    width: 100%;
  }
`;

const ProjectSelectorWrapper = styled.div`
  position: relative;
  display: inline-flex;
  align-items: center;
  min-width: 180px;

  @media (max-width: 960px) {
    width: 100%;
  }
`;

const ProjectSelector = styled.select`
  appearance: none;
  width: 100%;
  height: 36px;
  padding: 0 34px 0 12px;
  border: 1px solid hsl(var(--border));
  border-radius: 12px;
  background: linear-gradient(
    180deg,
    hsl(var(--background)),
    hsl(var(--muted) / 0.12)
  );
  font-size: 12px;
  font-weight: 600;
  color: hsl(var(--foreground));
  cursor: pointer;
  transition:
    border-color 0.2s ease,
    box-shadow 0.2s ease,
    transform 0.2s ease;

  &:hover {
    border-color: hsl(214 68% 38% / 0.32);
    transform: translateY(-1px);
  }

  &:focus {
    outline: none;
    border-color: hsl(214 68% 38% / 0.34);
    box-shadow: 0 0 0 4px hsl(211 100% 96%);
  }
`;

const SelectorIcon = styled.div`
  position: absolute;
  right: 12px;
  pointer-events: none;
  color: hsl(var(--muted-foreground));
`;

const MainContainer = styled.div`
  position: relative;
  z-index: 1;
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  padding: 0 10px 10px;

  @media (max-width: 960px) {
    padding: 0 8px 8px;
  }
`;

const TabsBar = styled.div`
  display: flex;
  align-items: center;
  flex: 1;
  min-width: 0;
  gap: 4px;
  padding: 4px;
  border-radius: 14px;
  border: 1px solid hsl(var(--border) / 0.78);
  background: hsl(var(--muted) / 0.18);
  overflow-x: auto;
`;

const pulseIn = keyframes`
  from {
    opacity: 0.4;
    transform: scale(0.96);
  }

  to {
    opacity: 1;
    transform: scale(1);
  }
`;

const TabButton = styled.button<{ $active: boolean }>`
  position: relative;
  flex-shrink: 0;
  height: 32px;
  padding: 0 12px;
  border: 1px solid
    ${({ $active }) => ($active ? "hsl(214 68% 38% / 0.18)" : "transparent")};
  border-radius: 10px;
  background: ${({ $active }) =>
    $active
      ? "linear-gradient(180deg, hsl(var(--background)), hsl(203 100% 97%))"
      : "transparent"};
  font-size: 13px;
  font-weight: ${({ $active }) => ($active ? 700 : 500)};
  color: ${({ $active }) =>
    $active ? "hsl(var(--foreground))" : "hsl(var(--muted-foreground))"};
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    transform 0.2s ease;
  animation: ${({ $active }) => ($active ? pulseIn : "none")} 0.24s ease;

  &:hover {
    color: hsl(var(--foreground));
    background: hsl(var(--muted) / 0.18);
  }
`;

const TabContent = styled.div`
  flex: 1;
  min-height: 0;
  overflow: hidden;
  margin-top: 8px;
  border-radius: 22px;
  border: 1px solid hsl(var(--border) / 0.72);
  background: hsl(var(--background) / 0.52);
  box-shadow:
    0 12px 30px hsl(215 32% 12% / 0.05),
    inset 0 1px 0 hsl(0 0% 100% / 0.64);
  backdrop-filter: blur(10px);
`;

const TABS = [
  { key: "ai-gen", label: "AI生图" },
  { key: "search", label: "图片搜索" },
  { key: "local", label: "本地图片" },
  { key: "gallery", label: "我的图片库" },
] as const;

export function ImageGenPage({ onNavigate }: ImageGenPageProps) {
  const [activeTab, setActiveTab] = useState("ai-gen");
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );

  const { projects, defaultProject, loading: projectsLoading } = useProjects();

  const handleBackHome = () => {
    onNavigate?.("agent", buildHomeAgentParams());
  };

  const availableProjects = useMemo(
    () => projects.filter((project) => !project.isArchived),
    [projects],
  );

  useEffect(() => {
    if (projectsLoading) {
      return;
    }

    setSelectedProjectId((current) => {
      if (
        current &&
        availableProjects.some((project) => project.id === current)
      ) {
        return current;
      }

      const storedProjectId = getStoredResourceProjectId({
        includeLegacy: true,
      });
      if (
        storedProjectId &&
        availableProjects.some((project) => project.id === storedProjectId)
      ) {
        return storedProjectId;
      }

      const preferredProject =
        (defaultProject && !defaultProject.isArchived
          ? defaultProject
          : null) ?? availableProjects[0];

      return preferredProject?.id || null;
    });
  }, [projectsLoading, availableProjects, defaultProject]);

  useEffect(() => {
    if (selectedProjectId) {
      setStoredResourceProjectId(selectedProjectId, {
        source: "image-gen-target",
        syncLegacy: true,
        emitEvent: true,
      });
    }
  }, [selectedProjectId]);

  useEffect(() => {
    return onResourceProjectChange((detail) => {
      if (detail.source !== "resources") {
        return;
      }

      const nextProjectId = detail.projectId;
      if (!nextProjectId || nextProjectId === selectedProjectId) {
        return;
      }

      if (!availableProjects.some((project) => project.id === nextProjectId)) {
        return;
      }

      setSelectedProjectId(nextProjectId);
    });
  }, [availableProjects, selectedProjectId]);

  return (
    <PageLayout>
      <PageChrome>
        <HeaderBar>
          <HeaderLead>
            <CanvasBreadcrumbHeader label="插图" onBackHome={handleBackHome} />
            <TabsBar>
              {TABS.map((tab) => (
                <TabButton
                  key={tab.key}
                  $active={activeTab === tab.key}
                  onClick={() => setActiveTab(tab.key)}
                >
                  {tab.label}
                </TabButton>
              ))}
            </TabsBar>
          </HeaderLead>
          <ProjectSelectorWrapper>
            <ProjectSelector
              value={selectedProjectId || ""}
              onChange={(e) => setSelectedProjectId(e.target.value || null)}
              disabled={projectsLoading}
            >
              <option value="">选择项目</option>
              {availableProjects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </ProjectSelector>
            <SelectorIcon>
              <ChevronDown size={14} />
            </SelectorIcon>
          </ProjectSelectorWrapper>
        </HeaderBar>
      </PageChrome>

      <MainContainer>
        <TabContent>
          {activeTab === "search" && (
            <ImageSearchTab
              projectId={selectedProjectId}
              onNavigate={onNavigate}
            />
          )}
          {activeTab === "ai-gen" && (
            <AiImageGenTab
              projectId={selectedProjectId}
              onNavigate={onNavigate}
            />
          )}
          {activeTab === "local" && (
            <LocalImageTab projectId={selectedProjectId} />
          )}
          {activeTab === "gallery" && (
            <MyGalleryTab
              projectId={selectedProjectId}
              onNavigate={onNavigate}
            />
          )}
        </TabContent>
      </MainContainer>
    </PageLayout>
  );
}

export default ImageGenPage;
