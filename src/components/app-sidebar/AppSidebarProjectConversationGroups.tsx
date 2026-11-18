import { useState, type MouseEvent, type ReactNode } from "react";
import styled from "styled-components";
import { FolderOpen, MoreHorizontal, MessageSquarePlus } from "lucide-react";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import type { SidebarOpenedProjectSummary } from "@/components/app-sidebar/sidebarConversationGroups";
import { buildVisibleSidebarSessions } from "./sidebarSessions";
import { ConversationListMoreButton } from "./AppSidebarConversationShelf.styles";
import { resolveProjectDisplayName } from "@/components/app-sidebar/sidebarProjectDisplayName";

interface SidebarProjectConversationSection {
  project: SidebarOpenedProjectSummary;
  sessions: AgentSessionInfo[];
}

interface AppSidebarProjectConversationGroupsProps {
  projectSections: SidebarProjectConversationSection[];
  collapsedProjectIds: ReadonlySet<string>;
  newProjectConversationLabel: string;
  projectMoreActionsLabel: string;
  currentSessionId?: string | null;
  showMoreLabel: string;
  showLessLabel: string;
  formatNewProjectConversationForLabel: (projectName: string) => string;
  formatOpenProjectMenuLabel: (projectName: string) => string;
  renderConversationRow: (session: AgentSessionInfo) => ReactNode;
  onCreateConversation: (project: SidebarOpenedProjectSummary) => void;
  onToggleProjectCollapsed: (projectId: string) => void;
  onOpenProjectMenu: (
    event: MouseEvent<HTMLButtonElement>,
    project: SidebarOpenedProjectSummary,
  ) => void;
}

const ProjectGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const ProjectHeader = styled.div`
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
`;

const ProjectButton = styled.button<{ $active: boolean }>`
  min-height: 30px;
  min-width: 0;
  flex: 1;
  border: none;
  border-radius: 10px;
  background: ${({ $active }) =>
    $active ? "var(--sidebar-active)" : "transparent"};
  color: var(--sidebar-foreground);
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  cursor: pointer;
  text-align: left;
  transition:
    background-color 0.16s ease,
    color 0.16s ease;

  &:hover {
    background: var(--sidebar-hover);
    padding-right: 52px;
  }

  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
    color: var(--sidebar-muted);
  }
`;

const ProjectName = styled.span`
  min-width: 0;
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 14px;
  font-weight: 430;
  line-height: 21px;
`;

const ProjectMenuButton = styled.button`
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 7px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  color: var(--sidebar-muted);
  cursor: pointer;
  opacity: 0;
  pointer-events: none;

  ${ProjectHeader}:hover &,
  ${ProjectHeader}:focus-within & {
    opacity: 1;
    pointer-events: auto;
  }
  transition:
    background-color 0.16s ease,
    color 0.16s ease,
    opacity 0.16s ease;

  &:hover {
    background: var(--sidebar-hover);
    color: var(--sidebar-foreground);
    opacity: 1;
  }

  svg {
    width: 14px;
    height: 14px;
  }
`;

const ProjectConversationList = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-left: 18px;
`;

const ProjectActions = styled.div`
  position: absolute;
  right: 0;
  display: flex;
  align-items: center;
`;

export function AppSidebarProjectConversationGroups({
  projectSections,
  collapsedProjectIds,
  newProjectConversationLabel,
  projectMoreActionsLabel,
  currentSessionId,
  showMoreLabel,
  showLessLabel,
  formatNewProjectConversationForLabel,
  formatOpenProjectMenuLabel,
  renderConversationRow,
  onCreateConversation,
  onToggleProjectCollapsed,
  onOpenProjectMenu,
}: AppSidebarProjectConversationGroupsProps) {
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(
    () => new Set(),
  );
  const toggleExpanded = (projectId: string) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };
  const visibleProjectSections = showAllProjects
    ? projectSections
    : projectSections.slice(0, 5);
  const activeProjectSection = projectSections.find((section) =>
    section.sessions.some((session) => session.id === currentSessionId),
  );
  if (
    !showAllProjects &&
    activeProjectSection &&
    !visibleProjectSections.includes(activeProjectSection)
  ) {
    visibleProjectSections.push(activeProjectSection);
  }
  if (projectSections.length - visibleProjectSections.length === 1) {
    visibleProjectSections.push(
      ...projectSections.filter(
        (section) => !visibleProjectSections.includes(section),
      ),
    );
  }
  return (
    <>
      {visibleProjectSections.map((section) => {
        const projectName = resolveProjectDisplayName(section.project);
        const collapsed = collapsedProjectIds.has(section.project.id);
        const expanded = expandedProjectIds.has(section.project.id);
        const visibleSessions = expanded
          ? section.sessions
          : buildVisibleSidebarSessions({
              sessions: section.sessions,
              currentSessionId,
              limit: 5,
            });
        const active = section.sessions.some(
          (session) => session.id === currentSessionId,
        );

        return (
          <ProjectGroup
            key={section.project.id}
            data-testid="app-sidebar-project-conversation-group"
          >
            <ProjectHeader>
              <ProjectButton
                $active={active}
                type="button"
                title={projectName}
                aria-expanded={!collapsed}
                onClick={() => onToggleProjectCollapsed(section.project.id)}
              >
                <FolderOpen />
                <ProjectName>{projectName}</ProjectName>
              </ProjectButton>
              <ProjectActions>
                <ProjectMenuButton
                  type="button"
                  aria-label={formatNewProjectConversationForLabel(projectName)}
                  title={newProjectConversationLabel}
                  data-testid="app-sidebar-project-new-conversation"
                  onClick={() => onCreateConversation(section.project)}
                >
                  <MessageSquarePlus />
                </ProjectMenuButton>
                <ProjectMenuButton
                  type="button"
                  aria-label={formatOpenProjectMenuLabel(projectName)}
                  title={projectMoreActionsLabel}
                  data-testid="app-sidebar-project-menu-button"
                  onClick={(event) => onOpenProjectMenu(event, section.project)}
                >
                  <MoreHorizontal />
                </ProjectMenuButton>
              </ProjectActions>
            </ProjectHeader>
            {!collapsed ? (
              <ProjectConversationList>
                {visibleSessions.length > 0
                  ? visibleSessions.map((session) =>
                      renderConversationRow(session),
                    )
                  : null}
                {section.sessions.length > 5 ? (
                  <ConversationListMoreButton
                    type="button"
                    onClick={() => toggleExpanded(section.project.id)}
                    aria-expanded={expanded}
                    data-testid="app-sidebar-project-show-more"
                  >
                    {expanded ? showLessLabel : showMoreLabel}
                  </ConversationListMoreButton>
                ) : null}
              </ProjectConversationList>
            ) : null}
          </ProjectGroup>
        );
      })}
      {projectSections.length > visibleProjectSections.length ? (
        <ConversationListMoreButton
          type="button"
          aria-expanded={showAllProjects}
          data-testid="app-sidebar-projects-show-more"
          onClick={() => setShowAllProjects(true)}
        >
          {showMoreLabel}
        </ConversationListMoreButton>
      ) : null}
    </>
  );
}
