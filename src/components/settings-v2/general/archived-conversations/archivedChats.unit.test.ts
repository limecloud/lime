import { describe, expect, it } from "vitest";
import type { AgentSessionInfo } from "@/lib/api/agentRuntime/sessionTypes";
import {
  buildArchivedChats,
  groupArchivedChats,
  type ArchivedChatSort,
} from "./archivedChats";

const projects = [
  { id: "a", name: "Alpha", roots: [{ path: "/repo/alpha" }] },
  {
    id: "b",
    name: "Beta",
    roots: [{ path: "/repo/beta" }, { path: "/repo/other-beta" }],
  },
];
function session(
  id: string,
  values: Partial<AgentSessionInfo> = {},
): AgentSessionInfo {
  return {
    id,
    name: id,
    created_at: 10,
    updated_at: 20,
    archived_at: 30,
    ...values,
  };
}
function groups(
  sessions: AgentSessionInfo[],
  sort: ArchivedChatSort = "updated",
  query = "",
  projectFilter = "all",
) {
  return groupArchivedChats({
    entries: buildArchivedChats(sessions, projects, "Untitled"),
    sort,
    query,
    projectFilter,
  });
}

describe("归档聊天投影", () => {
  it("显式项目分配优先于目录，唯一目录回退可归组，歧义不猜测", () => {
    const rows = buildArchivedChats(
      [
        session("explicit", { workspace_id: "b", working_dir: "/repo/alpha" }),
        session("cwd", { working_dir: "/repo/alpha/" }),
        session("orphan", { workspace_id: "deleted-project" }),
        session("second-root", { working_dir: "/repo/other-beta" }),
      ],
      projects,
      "Untitled",
    );
    expect(rows.map((row) => row.projectId)).toEqual(["b", "a", null, "b"]);
    const ambiguous = buildArchivedChats(
      [session("same", { working_dir: "/same" })],
      projects.map((p) => ({ ...p, roots: [{ path: "/same" }] })),
      "Untitled",
    );
    expect(ambiguous[0].projectId).toBeNull();
  });

  it("保留第80条之后的归档并去重，过滤活跃聊天", () => {
    const rows = Array.from({ length: 125 }, (_, i) => session(`chat-${i}`));
    const result = buildArchivedChats(
      [...rows, rows[0], session("active", { archived_at: null })],
      [],
      "Untitled",
    );
    expect(result).toHaveLength(125);
    expect(result.at(-1)?.session.id).toBe("chat-124");
  });

  it("标题容错、项目名和目录均可搜索，空白查询保留全部", () => {
    const rows = [
      session("Implementation notes", {
        workspace_id: "a",
        working_dir: "/repo/alpha",
      }),
      session("Unrelated"),
    ];
    for (const query of ["Implementaton", "Alpha", "/repo/alpha"]) {
      expect(
        groups(rows, "updated", query).flatMap((g) =>
          g.entries.map((e) => e.session.id),
        ),
      ).toEqual(["Implementation notes"]);
    }
    expect(
      groups(rows, "updated", "   ").flatMap((g) => g.entries),
    ).toHaveLength(2);
    expect(groups(rows, "updated", "zzzzzzzzzzzzz")).toEqual([]);
  });

  it("更新时间同时决定组和组内顺序，时间相同按标题排序", () => {
    const result = groups([
      session("Zeta", { workspace_id: "a", updated_at: 50 }),
      session("Alpha", { workspace_id: "a", updated_at: 50 }),
      session("New", { workspace_id: "b", updated_at: 100 }),
    ]);
    expect(result.map((g) => g.projectLabel)).toEqual(["Beta", "Alpha"]);
    expect(result[1].entries.map((e) => e.title)).toEqual(["Alpha", "Zeta"]);
  });

  it("创建时间不受归档时间或更新时间干扰，字母顺序按组及标题排列", () => {
    const rows = [
      session("Zulu", { workspace_id: "a", created_at: 90, updated_at: 1 }),
      session("Apple", { workspace_id: "b", created_at: 10, updated_at: 100 }),
    ];
    expect(groups(rows, "created").map((g) => g.projectLabel)).toEqual([
      "Alpha",
      "Beta",
    ]);
    expect(groups(rows, "alphabetical").map((g) => g.projectLabel)).toEqual([
      "Alpha",
      "Beta",
    ]);
  });

  it("项目筛选投影为单列表，普通聊天与保留字项目ID不冲突", () => {
    const rows = [session("Project", { workspace_id: "a" }), session("Chat")];
    expect(
      groups(rows, "updated", "", "project:a")[0].entries.map((e) => e.title),
    ).toEqual(["Project"]);
    expect(
      groups(rows, "updated", "", "none")[0].entries.map((e) => e.title),
    ).toEqual(["Chat"]);
    const entries = buildArchivedChats(
      [session("Reserved", { workspace_id: "none" }), session("Standalone")],
      [{ id: "none", name: "Named project", roots: [{ path: "/none" }] }],
      "Untitled",
    );
    expect(
      groupArchivedChats({
        entries,
        sort: "updated",
        query: "",
        projectFilter: "all",
      }),
    ).toHaveLength(2);
  });
});
