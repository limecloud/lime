import { describe, expect, it } from "vitest";
import type { AgentThreadItem, AgentThreadTurn } from "@/lib/api/agentProtocol";
import { collectThreadOutputs, type ThreadOutputsInput } from "./threadOutputs";
import { outputPathKey, resolveOutputPath } from "./threadOutputPaths";

const timestamp = "2026-10-20T02:00:00Z";
const turn = (
  id: string,
  status: AgentThreadTurn["status"] = "completed",
): AgentThreadTurn => ({
  id,
  thread_id: "thread",
  prompt_text: "",
  status,
  started_at: timestamp,
  created_at: timestamp,
  updated_at: timestamp,
});
const base = {
  thread_id: "thread",
  status: "completed" as const,
  started_at: timestamp,
  updated_at: timestamp,
};
function message(turnId: string, text: string, sequence = 1): AgentThreadItem {
  return {
    ...base,
    id: `message:${turnId}:${sequence}`,
    turn_id: turnId,
    sequence,
    type: "agent_message",
    text,
  };
}
function file(turnId: string, path: string, sequence = 0): AgentThreadItem {
  return {
    ...base,
    id: `file:${turnId}:${sequence}`,
    turn_id: turnId,
    sequence,
    type: "file_artifact",
    path,
    source: "tool",
  };
}
function collect(
  turns: AgentThreadTurn[],
  items: AgentThreadItem[],
  extra: Partial<ThreadOutputsInput> = {},
) {
  return collectThreadOutputs({
    threadId: "thread",
    turns,
    items,
    cwd: "/project",
    ...extra,
  });
}

describe("canonical thread output directory", () => {
  it.each([
    "http://localhost:4317/",
    "https://app.localhost:4317/demo?q=1#part",
    "http://127.0.0.1:4317/",
    "http://0.0.0.0:4317/",
    "http://[::1]:4317/",
  ])("最终正文中的唯一开发网址成为website：%s", (target) => {
    expect(
      collect([turn("t")], [message("t", `Ready: ${target}.`)]),
    ).toMatchObject([{ type: "website", target, itemId: "message:t:1" }]);
  });
  it.each([
    "http://localhost/",
    "http://localhost:80/",
    "https://localhost:443/",
    "http://example.com:4317/",
    "http://localhost.example.com:4317/",
    "ftp://localhost:4317/",
    "http://localhost:4317/a[b]",
    "http://localhost:99999/",
  ])("不将不符合资格的网址收入Recents：%s", (target) => {
    expect(collect([turn("t")], [message("t", target)])).toEqual([]);
  });
  it("网址先规范化去重且保留canonical回合身份；多个不同网址不猜选", () => {
    expect(
      collect(
        [turn("t")],
        [message("t", "http://LOCALHOST:4317 http://localhost:4317/")],
      ),
    ).toMatchObject([
      {
        type: "website",
        target: "http://localhost:4317/",
        turnId: "t",
        threadId: "thread",
        producedAtMs: Date.parse(timestamp),
      },
    ]);
    expect(
      collect(
        [turn("t")],
        [message("t", "http://localhost:4317/a http://localhost:4317/b")],
      ),
    ).toEqual([]);
  });
  it("只从最终助手消息推断website，运行和取消回合不推断", () => {
    expect(
      collect(
        [turn("t")],
        [message("t", "http://localhost:4317", 1), message("t", "Done", 2)],
      ),
    ).toEqual([]);
    for (const status of ["running", "canceled"] as const)
      expect(
        collect([turn("t", status)], [message("t", "http://localhost:4317")]),
      ).toEqual([]);
    expect(
      collect([turn("t", "failed")], [message("t", "http://localhost:4317")]),
    ).toMatchObject([{ type: "website" }]);
  });
  it("同回合已有文件输出时不附加website，其他回合文件不抑制website", () => {
    expect(
      collect(
        [turn("t")],
        [file("t", "report.pdf"), message("t", "http://localhost:4317")],
      ),
    ).toMatchObject([{ type: "file" }]);
    expect(
      collect(
        [turn("old"), turn("new")],
        [file("old", "report.pdf"), message("new", "http://localhost:4317")],
      ),
    ).toMatchObject([{ type: "website" }, { type: "file" }]);
  });
  it("website跨回合按同一规范网址去重，不用展示名或时间替代identity", () => {
    const result = collect(
      [turn("old"), turn("new")],
      [
        message("old", "http://LOCALHOST:4317/"),
        message("new", "http://localhost:4317/"),
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ type: "website", turnId: "new" });
  });
  function patch(paths: string[], status = "completed"): AgentThreadItem {
    return {
      ...base,
      id: "patch",
      turn_id: "t",
      sequence: 0,
      type: "patch",
      text: "",
      file_status: status as "completed",
      changes: paths.map((path) => ({ path, kind: { type: "add" }, diff: "" })),
    };
  }
  it("唯一完成的HTML修改可作为website，网址优先，重复路径只计一次", () => {
    const edited = patch(["index.html", "INDEX.HTML", "main.ts"]);
    expect(collect([turn("t")], [edited])).toMatchObject([
      { type: "website", target: "index.html", itemId: "patch" },
    ]);
    expect(
      collect([turn("t")], [edited, message("t", "http://localhost:4317")]),
    ).toMatchObject([
      {
        type: "website",
        target: "http://localhost:4317/",
        itemId: "message:t:1",
      },
    ]);
    expect(collect([turn("t")], [patch(["index.html", "other.htm"])])).toEqual(
      [],
    );
    expect(collect([turn("t")], [patch(["index.html"], "inProgress")])).toEqual(
      [],
    );
  });
  it("HTML重命名使用move_path并遵循输出目录边界和临时/visualization过滤", () => {
    const edited = patch([]);
    if (edited.type !== "patch") throw new Error("fixture type");
    edited.changes = [
      {
        path: "old.html",
        kind: { type: "update", move_path: "out/new.htm" },
        diff: "",
      },
    ];
    expect(
      collect([turn("t")], [edited], {
        projectlessOutputDirectory: "/project/out",
      }),
    ).toMatchObject([{ target: "out/new.htm" }]);
    expect(
      collect([turn("t")], [edited], {
        projectlessOutputDirectory: "/project/other",
      }),
    ).toEqual([]);
    for (const path of [
      "work/index.html",
      ".lime_scratch/index.html",
      ".lime/visualizations/2026/10/21/thread/vis-1.html",
    ])
      expect(collect([turn("t")], [patch([path])])).toEqual([]);
  });
  it("显式输出引用与source引用分开，代码与转义指令不成为产物", () => {
    const text =
      ':codex-file-citation[Report]{path="report.pdf"}\n:codex-file-citation[Source]{path="source.pdf" purpose="source"}\n` :codex-file-citation[Example]{path="example.pdf"}`\n\\:codex-file-citation[Escaped]{path="escaped.pdf"}\n[source](source.pdf) [other](other.pdf)';
    expect(
      collect([turn("t")], [message("t", text)]).map((item) =>
        "path" in item ? item.path : item.target,
      ),
    ).toEqual(["/project/report.pdf", "/project/other.pdf"]);
  });
  it("行号引用排除被引用文件，visualization文件不进入输出目录", () => {
    const text =
      ':codex-file-citation[Chart]{path="chart.pdf"}\n::codex-inline-vis{path="chart.pdf"}\n【source.pdf†L1-L2】 [source](source.pdf) [out](out.pdf)';
    expect(
      collect([turn("t")], [message("t", text)]).map((item) =>
        "path" in item ? item.path : item.target,
      ),
    ).toEqual(["/project/out.pdf"]);
  });
  it.each([
    [String.raw`\\?\C:\project\chart.pdf`, "C:/project/chart.pdf"],
    [String.raw`\\?\UNC\server\share\chart.pdf`, "//server/share/chart.pdf"],
    ["C:/project/chart.pdf", String.raw`\\?\C:\project\chart.pdf`],
    ["//server/share/chart.pdf", String.raw`\\?\UNC\server\share\chart.pdf`],
  ])(
    "可视化文件不因 Windows extended 路径别名进入 Recents：%s",
    (path, visualPath) => {
      expect(
        collect(
          [turn("t")],
          [
            file("t", path),
            file("t", "other.pdf", 1),
            message("t", `::codex-inline-vis{path="${visualPath}"}`, 2),
          ],
          { cwd: "C:/project" },
        ).map((item) => ("path" in item ? item.path : item.target)),
      ).toEqual(["C:/project/other.pdf"]);
    },
  );
  it("按canonical回合逆序，保留回合内顺序和最新路径身份，不按日期或ID排序", () => {
    const old = turn("z-old"),
      latest = { ...turn("a-new"), started_at: "2025-01-01T00:00:00Z" };
    const result = collect(
      [old, latest],
      [
        file(old.id, "same.pdf"),
        file(old.id, "old.csv", 1),
        file(latest.id, "same.pdf"),
        file(latest.id, "new.xlsx", 1),
      ],
    );
    expect(
      result.map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual(["/project/same.pdf", "/project/new.xlsx", "/project/old.csv"]);
    expect(result[0]).toMatchObject({
      threadId: "thread",
      turnId: "a-new",
      itemId: "file:a-new:0",
      producedAtMs: Date.parse(latest.started_at),
    });
  });
  it("显式输出和最终正文链接使用各自资格，普通源码修改不进入目录", () => {
    const patch: AgentThreadItem = {
      ...base,
      id: "patch",
      turn_id: "t",
      sequence: 0,
      type: "patch",
      text: "",
      file_status: "completed",
      changes: [{ path: "/project/main.ts", kind: { type: "add" }, diff: "" }],
    };
    const result = collect(
      [turn("t")],
      [
        patch,
        file("t", "notes.md", 1),
        file("t", "source.ts", 2),
        message(
          "t",
          "[doc](report.pdf) [source](main.ts) [markdown](readme.md) [tex](report.tex)",
          3,
        ),
      ],
    );
    expect(
      result.map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual([
      "/project/notes.md",
      "/project/report.pdf",
      "/project/report.tex",
    ]);
  });
  it("忽略示例代码、图片、HTML、reference链接与公网链接，支持带空格与编码的文件", () => {
    const text =
      "`[code](code.pdf)`\n\n```md\n[fenced](fenced.pdf)\n```\n\n![image](image.pdf)\n[public](https://example.com/a.pdf)\n[ref][r]\n\n[r]: ref.pdf\n\n[output](<my%20report.pdf>)";
    expect(
      collect([turn("t")], [message("t", text)]).map((item) =>
        "path" in item ? item.path : item.target,
      ),
    ).toEqual(["/project/my report.pdf"]);
  });
  it("只扫描最后一条助手正文，不从用户输入或中间消息猜产物", () => {
    const user: AgentThreadItem = {
      ...base,
      id: "user",
      turn_id: "t",
      sequence: 0,
      type: "user_message",
      content: "[input](input.pdf)",
    };
    expect(
      collect(
        [turn("t")],
        [
          user,
          message("t", "[early](early.pdf)", 1),
          message("t", "[final](final.pdf)", 2),
        ],
      ).map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual(["/project/final.pdf"]);
  });
  it("失败回合可保留输出，取消和未结束回合不扫描最终文件", () => {
    const turns = [
      turn("failed", "failed"),
      turn("canceled", "canceled"),
      turn("live", "running"),
    ];
    expect(
      collect(
        turns,
        turns.map((turn) => file(turn.id, `${turn.id}.pdf`)),
      ).map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual(["/project/failed.pdf"]);
  });
  it("生成图片就绪后无需等待回合结束，同路径文件首次去重", () => {
    const image: AgentThreadItem = {
      ...base,
      id: "image",
      turn_id: "live",
      sequence: 2,
      type: "image_generation",
      generation_status: "completed",
      result: "",
      saved_path: "/project/image.png",
    };
    expect(collect([turn("live", "running")], [image])).toMatchObject([
      { type: "generated-image", path: "/project/image.png", itemId: "image" },
    ]);
  });
  it("较早回合的生成图片升级同路径文件并保留首次位置及图片canonical身份", () => {
    const image: AgentThreadItem = {
      ...base,
      id: "generated-image",
      turn_id: "old",
      sequence: 0,
      type: "image_generation",
      generation_status: "completed",
      result: "",
      saved_path: "/project/Report.PNG",
    };
    const result = collect(
      [turn("old"), turn("new")],
      [
        image,
        file("new", "report.png"),
        file("new", "latest.pdf", 1),
        file("old", "old.pdf", 1),
      ],
    );
    expect(
      result.map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual([
      "/project/Report.PNG",
      "/project/latest.pdf",
      "/project/old.pdf",
    ]);
    expect(result[0]).toMatchObject({
      type: "generated-image",
      threadId: "thread",
      turnId: "old",
      itemId: "generated-image",
    });
  });
  it("生成图片不被后续普通文件或重复图片降级，不就绪图片不能替换文件", () => {
    const image = (id: string, status: string): AgentThreadItem => ({
      ...base,
      id,
      turn_id: id,
      sequence: 0,
      type: "image_generation",
      generation_status: status,
      result: "",
      saved_path: "/project/image.png",
    });
    const result = collect(
      [turn("old"), turn("middle"), turn("new")],
      [
        image("old", "completed"),
        file("middle", "image.png"),
        image("new", "completed"),
      ],
    );
    expect(result).toMatchObject([
      { type: "generated-image", itemId: "new", turnId: "new" },
    ]);
    expect(
      collect(
        [turn("old"), turn("new", "running")],
        [
          image("old", "inProgress"),
          file("old", "image.png"),
          image("new", "inProgress"),
        ],
      ),
    ).toMatchObject([{ type: "file", itemId: "file:old:0" }]);
  });
  it("严格隔离线程与未知回合，invalid开始时间不伪造日期", () => {
    const result = collect(
      [
        { ...turn("t"), started_at: "invalid" },
        { ...turn("other"), thread_id: "other" },
      ],
      [
        file("t", "a.pdf"),
        { ...file("t", "foreign.pdf"), thread_id: "other" },
        file("unknown", "unknown.pdf"),
      ],
    );
    expect(result).toHaveLength(1);
    expect(result[0]).not.toHaveProperty("producedAtMs");
    expect(
      collect([turn("t")], [file("t", "a.pdf")], { threadId: null }),
    ).toEqual([]);
  });
  it("排除临时目录但保留同名前缀目录，输出根按路径边界检查", () => {
    const paths = [
      "work/a.pdf",
      ".lime_scratch/a.pdf",
      "workbench/a.pdf",
      "out/a.pdf",
      "outside/a.pdf",
    ];
    expect(
      collect(
        [turn("t")],
        paths.map((path, index) => file("t", path, index)),
      ).map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual([
      "/project/workbench/a.pdf",
      "/project/out/a.pdf",
      "/project/outside/a.pdf",
    ]);
    expect(
      collect(
        [turn("t")],
        paths.map((path, index) => file("t", path, index)),
        { projectlessOutputDirectory: "/project/out" },
      ).map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual(["/project/out/a.pdf"]);
  });
  it("Windows extended drive/UNC规范化和大小写去重不改展示路径大小写", () => {
    expect(resolveOutputPath("\\\\?\\UNC\\server\\share\\a.pdf", null)).toBe(
      "//server/share/a.pdf",
    );
    expect(resolveOutputPath("\\\\?\\C:\\work\\out\\a.pdf", null)).toBe(
      "C:/work/out/a.pdf",
    );
    expect(outputPathKey(".\\OUT\\..\\Report.PDF", "C:\\project")).toBe(
      "c:/project/report.pdf",
    );
    expect(
      collect(
        [turn("t")],
        [file("t", "Report.PDF"), file("t", "report.pdf", 1)],
      ).map((item) => ("path" in item ? item.path : item.target)),
    ).toEqual(["/project/Report.PDF"]);
  });
});
