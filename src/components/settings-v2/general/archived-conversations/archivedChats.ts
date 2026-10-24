import Fuse from "fuse.js";
import type { Project } from "@limecloud/app-server-client";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import { sessionBelongsToProject } from "@/components/app-sidebar/sidebarConversationGroups";
import { resolveSidebarSessionTitle } from "@/components/app-sidebar/sidebarSessionFormatting";

export type ArchivedChatSort = "updated" | "created" | "alphabetical";
export type ArchiveProject = Pick<Project, "id" | "name" | "roots">;
export interface ArchivedChat {
  session: AgentSessionInfo;
  title: string;
  projectId: string | null;
  projectLabel: string | null;
  searchValues: string[];
}
export interface ArchivedChatGroup {
  id: string;
  projectLabel: string | null;
  entries: ArchivedChat[];
}

export function buildArchivedChats(
  sessions: AgentSessionInfo[],
  projects: ArchiveProject[],
  untitled: string,
): ArchivedChat[] {
  const seen = new Set<string>();
  return sessions.flatMap((session) => {
    if (!session.archived_at || seen.has(session.id)) return [];
    seen.add(session.id);
    const assigned = projects.find(
      (project) => project.id === session.workspace_id,
    );
    const candidates = projects.filter((project) =>
      project.roots.some((root) =>
        sessionBelongsToProject(session, { ...project, rootPath: root.path }),
      ),
    );
    const project =
      assigned ?? (candidates.length === 1 ? candidates[0] : null);
    const title = resolveSidebarSessionTitle(session, untitled);
    return [
      {
        session,
        title,
        projectId: project?.id ?? null,
        projectLabel: project?.name.trim() || project?.id || null,
        searchValues: [title, project?.name ?? "", session.working_dir ?? ""],
      },
    ];
  });
}

function time(entry: ArchivedChat, sort: ArchivedChatSort) {
  const value =
    sort === "created" ? entry.session.created_at : entry.session.updated_at;
  return Number.isFinite(value) ? value : entry.session.created_at || 0;
}

export function groupArchivedChats({
  entries,
  projectFilter,
  query,
  sort,
}: {
  entries: ArchivedChat[];
  projectFilter: string;
  query: string;
  sort: ArchivedChatSort;
}): ArchivedChatGroup[] {
  let visible = entries.filter(
    (entry) =>
      projectFilter === "all" ||
      (entry.projectId ? `project:${entry.projectId}` : "none") ===
        projectFilter,
  );
  if (query.trim()) {
    visible = new Fuse(visible, {
      ignoreLocation: true,
      keys: ["searchValues"],
      threshold: 0.4,
    })
      .search(query.trim())
      .map(({ item }) => item);
  }
  const compare = (left: ArchivedChat, right: ArchivedChat) =>
    sort === "alphabetical"
      ? left.title.localeCompare(right.title) ||
        time(right, "updated") - time(left, "updated")
      : time(right, sort) - time(left, sort) ||
        left.title.localeCompare(right.title);
  if (projectFilter !== "all")
    return visible.length
      ? [
          {
            id: projectFilter,
            projectLabel: null,
            entries: visible.sort(compare),
          },
        ]
      : [];
  const groups = new Map<string, ArchivedChatGroup>();
  for (const entry of visible) {
    const id = entry.projectId ? `project:${entry.projectId}` : "none";
    const group = groups.get(id) ?? {
      id,
      projectLabel: entry.projectLabel,
      entries: [],
    };
    group.entries.push(entry);
    groups.set(id, group);
  }
  const result = [...groups.values()];
  for (const group of result) group.entries.sort(compare);
  const latest = (group: ArchivedChatGroup) =>
    group.entries.reduce(
      (value, entry) => Math.max(value, time(entry, sort)),
      0,
    );
  return result.sort(
    (left, right) =>
      (sort === "alphabetical" ? 0 : latest(right) - latest(left)) ||
      (left.projectLabel ?? "").localeCompare(right.projectLabel ?? "") ||
      left.id.localeCompare(right.id),
  );
}
