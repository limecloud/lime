import {
  Code2,
  Edit3,
  Eye,
  FilePlus,
  FileText,
  FolderOpen,
  Globe,
  Search,
  Settings,
  Terminal,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import type { AgentToolCallState as ToolCallState } from "@/lib/api/agentProtocol";
import { extractArtifactProtocolPathsFromValue } from "@/lib/artifact-protocol";
import {
  containsAssistantProtocolResidue,
  stripAssistantProtocolResidue,
} from "./protocolResidue";

export type ToolCallStatus = ToolCallState["status"];
export type ToolCallFamily =
  | "subagent"
  | "task"
  | "plan"
  | "skill"
  | "write"
  | "read"
  | "edit"
  | "command"
  | "search"
  | "list"
  | "browser"
  | "fetch"
  | "vision"
  | "generic";

export type ToolCallArgumentValue =
  | string
  | number
  | boolean
  | null
  | ToolCallArgumentValue[]
  | { [key: string]: ToolCallArgumentValue };

export interface ToolDisplayDescriptor {
  family: ToolCallFamily;
  label: string;
  action: string;
  verb: string;
  icon: LucideIcon;
  groupTitle: string;
}

interface ToolDisplayConfig {
  family: ToolCallFamily;
  label: string;
  verb: string;
  icon: LucideIcon;
  groupTitle: string;
  actionKey: ToolStatusActionKey;
  actions?: {
    failed: string;
    completed: string;
    running: string;
  };
}

const TOOL_STATUS_ACTIONS = {
  generic: {
    failed: "执行失败",
    completed: "已完成",
    running: "执行中",
  },
  browser: {
    failed: "操作失败",
    completed: "已完成",
    running: "操作中",
  },
  fetch: {
    failed: "获取失败",
    completed: "已获取",
    running: "获取中",
  },
  search: {
    failed: "搜索失败",
    completed: "已搜索",
    running: "搜索中",
  },
  read: {
    failed: "查看失败",
    completed: "已查看",
    running: "查看中",
  },
  list: {
    failed: "查看失败",
    completed: "已查看",
    running: "查看中",
  },
  write: {
    failed: "保存失败",
    completed: "已保存",
    running: "保存中",
  },
  edit: {
    failed: "编辑失败",
    completed: "已编辑",
    running: "编辑中",
  },
  command: {
    failed: "运行失败",
    completed: "已运行",
    running: "运行中",
  },
  plan: {
    failed: "更新失败",
    completed: "规划已更新",
    running: "规划中",
  },
  skill: {
    failed: "执行失败",
    completed: "已执行技能",
    running: "执行技能中",
  },
  task: {
    failed: "创建失败",
    completed: "已创建任务",
    running: "创建任务中",
  },
  subagent: {
    failed: "子任务失败",
    completed: "子任务完成",
    running: "子任务处理中",
  },
  vision: {
    failed: "分析失败",
    completed: "已分析",
    running: "分析中",
  },
} as const;

type ToolStatusActionKey = keyof typeof TOOL_STATUS_ACTIONS;

const EXACT_TOOL_CONFIGS = new Map<string, ToolDisplayConfig>([
  [
    "read",
    {
      family: "read",
      label: "文件读取",
      verb: "查看",
      icon: Eye,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "readfile",
    {
      family: "read",
      label: "文件读取",
      verb: "查看",
      icon: Eye,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "readdocs",
    {
      family: "read",
      label: "文档读取",
      verb: "查看",
      icon: FileText,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "readmcpresource",
    {
      family: "read",
      label: "资源读取",
      verb: "查看",
      icon: FileText,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "write",
    {
      family: "write",
      label: "文件写入",
      verb: "保存",
      icon: FilePlus,
      groupTitle: "写入",
      actionKey: "write",
    },
  ],
  [
    "writefile",
    {
      family: "write",
      label: "文件写入",
      verb: "保存",
      icon: FilePlus,
      groupTitle: "写入",
      actionKey: "write",
    },
  ],
  [
    "createfile",
    {
      family: "write",
      label: "文件创建",
      verb: "保存",
      icon: FilePlus,
      groupTitle: "写入",
      actionKey: "write",
    },
  ],
  [
    "edit",
    {
      family: "edit",
      label: "文件编辑",
      verb: "修改",
      icon: Edit3,
      groupTitle: "编辑",
      actionKey: "edit",
    },
  ],
  [
    "editfile",
    {
      family: "edit",
      label: "文件编辑",
      verb: "修改",
      icon: Edit3,
      groupTitle: "编辑",
      actionKey: "edit",
    },
  ],
  [
    "multiedit",
    {
      family: "edit",
      label: "批量编辑",
      verb: "批量修改",
      icon: Edit3,
      groupTitle: "编辑",
      actionKey: "edit",
    },
  ],
  [
    "notebookedit",
    {
      family: "edit",
      label: "笔记本编辑",
      verb: "修改",
      icon: Edit3,
      groupTitle: "编辑",
      actionKey: "edit",
    },
  ],
  [
    "applypatch",
    {
      family: "edit",
      label: "补丁应用",
      verb: "应用",
      icon: Edit3,
      groupTitle: "编辑",
      actionKey: "edit",
    },
  ],
  [
    "glob",
    {
      family: "list",
      label: "文件匹配",
      verb: "查找",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
      actions: {
        failed: "查找失败",
        completed: "已找到",
        running: "查找中",
      },
    },
  ],
  [
    "ls",
    {
      family: "list",
      label: "目录浏览",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "list",
    {
      family: "list",
      label: "目录浏览",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "listdir",
    {
      family: "list",
      label: "目录浏览",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "listdirectory",
    {
      family: "list",
      label: "目录浏览",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "listmcpresources",
    {
      family: "list",
      label: "资源列表",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "listmcpresourcetemplates",
    {
      family: "list",
      label: "资源模板列表",
      verb: "查看",
      icon: FolderOpen,
      groupTitle: "探索",
      actionKey: "list",
    },
  ],
  [
    "grep",
    {
      family: "search",
      label: "内容检索",
      verb: "搜索",
      icon: Search,
      groupTitle: "探索",
      actionKey: "search",
    },
  ],
  [
    "websearch",
    {
      family: "search",
      label: "网络搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "searchquery",
    {
      family: "search",
      label: "网络搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "imagequery",
    {
      family: "search",
      label: "图片搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "limesearchwebimages",
    {
      family: "search",
      label: "联网搜图",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "toolsearch",
    {
      family: "search",
      label: "工具搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "searchdocs",
    {
      family: "search",
      label: "文档搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "resolvelibraryid",
    {
      family: "search",
      label: "库解析",
      verb: "解析",
      icon: Search,
      groupTitle: "搜索",
      actionKey: "search",
    },
  ],
  [
    "querydocs",
    {
      family: "read",
      label: "文档查询",
      verb: "查询",
      icon: FileText,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "webfetch",
    {
      family: "fetch",
      label: "网页抓取",
      verb: "抓取",
      icon: Globe,
      groupTitle: "获取",
      actionKey: "fetch",
    },
  ],
  [
    "finance",
    {
      family: "fetch",
      label: "行情查询",
      verb: "查询",
      icon: Globe,
      groupTitle: "获取",
      actionKey: "fetch",
    },
  ],
  [
    "weather",
    {
      family: "fetch",
      label: "天气查询",
      verb: "查询",
      icon: Globe,
      groupTitle: "获取",
      actionKey: "fetch",
    },
  ],
  [
    "sports",
    {
      family: "fetch",
      label: "体育查询",
      verb: "查询",
      icon: Globe,
      groupTitle: "获取",
      actionKey: "fetch",
    },
  ],
  [
    "time",
    {
      family: "fetch",
      label: "时间查询",
      verb: "查询",
      icon: Globe,
      groupTitle: "获取",
      actionKey: "fetch",
    },
  ],
  [
    "bash",
    {
      family: "command",
      label: "命令执行",
      verb: "运行",
      icon: Terminal,
      groupTitle: "命令",
      actionKey: "command",
    },
  ],
  [
    "killshell",
    {
      family: "command",
      label: "终止命令",
      verb: "终止",
      icon: Terminal,
      groupTitle: "命令",
      actionKey: "command",
    },
  ],
  [
    "lsp",
    {
      family: "read",
      label: "代码分析",
      verb: "分析",
      icon: Code2,
      groupTitle: "探索",
      actionKey: "read",
    },
  ],
  [
    "skill",
    {
      family: "skill",
      label: "技能执行",
      verb: "执行技能",
      icon: Settings,
      groupTitle: "技能",
      actionKey: "skill",
    },
  ],
  [
    "listskills",
    {
      family: "skill",
      label: "技能列表",
      verb: "列出",
      icon: Settings,
      groupTitle: "技能",
      actionKey: "skill",
      actions: {
        failed: "获取失败",
        completed: "已获取技能列表",
        running: "获取中",
      },
    },
  ],
  [
    "loadskill",
    {
      family: "skill",
      label: "技能加载",
      verb: "加载",
      icon: Settings,
      groupTitle: "技能",
      actionKey: "skill",
      actions: {
        failed: "加载失败",
        completed: "已加载技能",
        running: "加载中",
      },
    },
  ],
  [
    "taskcreate",
    {
      family: "plan",
      label: "任务创建",
      verb: "创建",
      icon: FilePlus,
      groupTitle: "计划",
      actionKey: "plan",
      actions: {
        failed: "创建失败",
        completed: "已创建任务",
        running: "创建中",
      },
    },
  ],
  [
    "tasklist",
    {
      family: "plan",
      label: "任务列表",
      verb: "查看",
      icon: FileText,
      groupTitle: "计划",
      actionKey: "plan",
      actions: {
        failed: "获取失败",
        completed: "已获取任务列表",
        running: "获取中",
      },
    },
  ],
  [
    "taskget",
    {
      family: "plan",
      label: "任务详情",
      verb: "查看",
      icon: FileText,
      groupTitle: "计划",
      actionKey: "plan",
      actions: {
        failed: "获取失败",
        completed: "已获取任务详情",
        running: "获取中",
      },
    },
  ],
  [
    "taskupdate",
    {
      family: "plan",
      label: "任务更新",
      verb: "更新",
      icon: Edit3,
      groupTitle: "计划",
      actionKey: "plan",
      actions: {
        failed: "更新失败",
        completed: "已更新任务",
        running: "更新中",
      },
    },
  ],
  [
    "taskoutput",
    {
      family: "task",
      label: "任务输出",
      verb: "查看结果",
      icon: FileText,
      groupTitle: "任务",
      actionKey: "task",
      actions: {
        failed: "查看结果失败",
        completed: "已查看结果",
        running: "查看结果中",
      },
    },
  ],
  [
    "taskstop",
    {
      family: "task",
      label: "终止任务",
      verb: "终止",
      icon: Terminal,
      groupTitle: "任务",
      actionKey: "task",
      actions: {
        failed: "终止失败",
        completed: "已终止任务",
        running: "终止中",
      },
    },
  ],
  [
    "enterplanmode",
    {
      family: "plan",
      label: "进入计划模式",
      verb: "进入",
      icon: FileText,
      groupTitle: "计划",
      actionKey: "plan",
    },
  ],
  [
    "exitplanmode",
    {
      family: "plan",
      label: "退出计划模式",
      verb: "退出",
      icon: FileText,
      groupTitle: "计划",
      actionKey: "plan",
    },
  ],
  [
    "analyzeimage",
    {
      family: "vision",
      label: "图像分析",
      verb: "分析",
      icon: Eye,
      groupTitle: "图像",
      actionKey: "vision",
    },
  ],
  [
    "viewimage",
    {
      family: "vision",
      label: "图片查看",
      verb: "查看",
      icon: Eye,
      groupTitle: "图像",
      actionKey: "vision",
    },
  ],
  [
    "generateimage",
    {
      family: "task",
      label: "图片生成",
      verb: "生成",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
      actions: {
        failed: "生成失败",
        completed: "已生成",
        running: "生成中",
      },
    },
  ],
  [
    "askuserquestion",
    {
      family: "generic",
      label: "用户确认",
      verb: "收集",
      icon: Wrench,
      groupTitle: "交互",
      actionKey: "generic",
      actions: {
        failed: "收集失败",
        completed: "已收集",
        running: "等待输入",
      },
    },
  ],
  [
    "sendusermessage",
    {
      family: "generic",
      label: "用户消息",
      verb: "发送",
      icon: FileText,
      groupTitle: "用户消息",
      actionKey: "generic",
      actions: {
        failed: "发送失败",
        completed: "已发送",
        running: "发送中",
      },
    },
  ],
  [
    "structuredoutput",
    {
      family: "generic",
      label: "最终答复",
      verb: "整理",
      icon: FileText,
      groupTitle: "回复",
      actionKey: "generic",
      actions: {
        failed: "整理失败",
        completed: "已整理最终答复",
        running: "整理最终答复中",
      },
    },
  ],
  [
    "brief",
    {
      family: "generic",
      label: "用户消息",
      verb: "发送",
      icon: FileText,
      groupTitle: "用户消息",
      actionKey: "generic",
      actions: {
        failed: "发送失败",
        completed: "已发送",
        running: "发送中",
      },
    },
  ],
  [
    "agent",
    {
      family: "subagent",
      label: "创建子任务",
      verb: "创建",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "subagent",
    },
  ],
  [
    "sendmessage",
    {
      family: "subagent",
      label: "补充说明",
      verb: "发送",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "subagent",
    },
  ],
  [
    "teamcreate",
    {
      family: "subagent",
      label: "创建团队",
      verb: "创建",
      icon: Globe,
      groupTitle: "创建团队",
      actionKey: "subagent",
      actions: {
        failed: "创建失败",
        completed: "已创建",
        running: "创建中",
      },
    },
  ],
  [
    "teamdelete",
    {
      family: "subagent",
      label: "删除团队",
      verb: "删除",
      icon: Globe,
      groupTitle: "删除团队",
      actionKey: "subagent",
      actions: {
        failed: "删除失败",
        completed: "已删除",
        running: "删除中",
      },
    },
  ],
  [
    "listpeers",
    {
      family: "list",
      label: "子任务",
      verb: "查看",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "list",
    },
  ],
  [
    "waitagent",
    {
      family: "subagent",
      label: "查看任务进展",
      verb: "查看",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "subagent",
    },
  ],
  [
    "resumeagent",
    {
      family: "subagent",
      label: "继续处理",
      verb: "继续",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "subagent",
    },
  ],
  [
    "closeagent",
    {
      family: "subagent",
      label: "暂停处理",
      verb: "暂停",
      icon: Globe,
      groupTitle: "子任务",
      actionKey: "subagent",
    },
  ],
  [
    "croncreate",
    {
      family: "task",
      label: "定时触发器",
      verb: "创建",
      icon: Settings,
      groupTitle: "定时触发",
      actionKey: "generic",
      actions: {
        failed: "创建失败",
        completed: "已创建",
        running: "创建中",
      },
    },
  ],
  [
    "cronlist",
    {
      family: "list",
      label: "定时触发器",
      verb: "查看",
      icon: Settings,
      groupTitle: "定时触发",
      actionKey: "list",
    },
  ],
  [
    "crondelete",
    {
      family: "task",
      label: "定时触发器",
      verb: "删除",
      icon: Settings,
      groupTitle: "定时触发",
      actionKey: "generic",
      actions: {
        failed: "删除失败",
        completed: "已删除",
        running: "删除中",
      },
    },
  ],
  [
    "remotetrigger",
    {
      family: "command",
      label: "远程触发器",
      verb: "处理",
      icon: Globe,
      groupTitle: "远程触发",
      actionKey: "generic",
      actions: {
        failed: "处理失败",
        completed: "已处理",
        running: "处理中",
      },
    },
  ],
  [
    "socialgeneratecoverimage",
    {
      family: "task",
      label: "封面图生成",
      verb: "生成",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
      actions: {
        failed: "生成失败",
        completed: "已生成",
        running: "生成中",
      },
    },
  ],
  [
    "limecreatevideogenerationtask",
    {
      family: "task",
      label: "视频生成任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreatebroadcastgenerationtask",
    {
      family: "task",
      label: "口播生成任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreatecovergenerationtask",
    {
      family: "task",
      label: "封面生成任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreateresourcesearchtask",
    {
      family: "task",
      label: "素材检索任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreateimagegenerationtask",
    {
      family: "task",
      label: "图片生成任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreateurlparsetask",
    {
      family: "task",
      label: "链接解析任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limecreatetypesettingtask",
    {
      family: "task",
      label: "排版任务",
      verb: "创建任务",
      icon: FilePlus,
      groupTitle: "任务",
      actionKey: "task",
    },
  ],
  [
    "limesitelist",
    {
      family: "list",
      label: "站点能力目录",
      verb: "浏览",
      icon: Globe,
      groupTitle: "站点",
      actionKey: "list",
      actions: {
        failed: "浏览失败",
        completed: "已浏览",
        running: "浏览中",
      },
    },
  ],
  [
    "limesitesearch",
    {
      family: "search",
      label: "站点能力搜索",
      verb: "搜索",
      icon: Search,
      groupTitle: "站点",
      actionKey: "search",
      actions: {
        failed: "搜索失败",
        completed: "已搜索",
        running: "搜索中",
      },
    },
  ],
  [
    "limesiteinfo",
    {
      family: "read",
      label: "站点能力详情",
      verb: "查看",
      icon: Globe,
      groupTitle: "站点",
      actionKey: "read",
      actions: {
        failed: "查看失败",
        completed: "已查看",
        running: "查看中",
      },
    },
  ],
  [
    "limesiterun",
    {
      family: "generic",
      label: "站点能力执行",
      verb: "执行",
      icon: Globe,
      groupTitle: "站点",
      actionKey: "generic",
      actions: {
        failed: "执行失败",
        completed: "已执行",
        running: "执行中",
      },
    },
  ],
]);

const BROWSER_TOOL_MATCHERS: Array<{
  match: (name: string) => boolean;
  config: ToolDisplayConfig;
}> = [
  {
    match: (name) => name === "open",
    config: {
      family: "browser",
      label: "页面打开",
      verb: "打开",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "打开失败",
        completed: "已打开",
        running: "打开中",
      },
    },
  },
  {
    match: (name) => name.includes("navigateback"),
    config: {
      family: "browser",
      label: "页面返回",
      verb: "返回",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "返回失败",
        completed: "已返回",
        running: "返回中",
      },
    },
  },
  {
    match: (name) => name.includes("navigate") || name.includes("goto"),
    config: {
      family: "browser",
      label: "页面打开",
      verb: "打开",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "打开失败",
        completed: "已打开",
        running: "打开中",
      },
    },
  },
  {
    match: (name) => name.includes("click"),
    config: {
      family: "browser",
      label: "页面点击",
      verb: "点击",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "点击失败",
        completed: "已点击",
        running: "点击中",
      },
    },
  },
  {
    match: (name) => name.includes("hover"),
    config: {
      family: "browser",
      label: "页面定位",
      verb: "定位",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "定位失败",
        completed: "已定位",
        running: "定位中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("type") ||
      name.includes("fillform") ||
      name.includes("presskey") ||
      name.includes("selectoption") ||
      name.includes("handledialog"),
    config: {
      family: "browser",
      label: "页面输入",
      verb: "填写",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "填写失败",
        completed: "已填写",
        running: "填写中",
      },
    },
  },
  {
    match: (name) => name.includes("drag"),
    config: {
      family: "browser",
      label: "页面拖拽",
      verb: "拖拽",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "拖拽失败",
        completed: "已拖拽",
        running: "拖拽中",
      },
    },
  },
  {
    match: (name) => name.includes("screenshot") || name.includes("snapshot"),
    config: {
      family: "browser",
      label: "页面截图",
      verb: "截图",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "截图失败",
        completed: "已截图",
        running: "截图中",
      },
    },
  },
  {
    match: (name) => name.includes("evaluate") || name.includes("runcode"),
    config: {
      family: "browser",
      label: "页面脚本",
      verb: "执行脚本",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "脚本执行失败",
        completed: "已执行脚本",
        running: "执行脚本中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("consolemessages") || name.includes("networkrequests"),
    config: {
      family: "browser",
      label: "页面日志",
      verb: "获取日志",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
      actions: {
        failed: "获取日志失败",
        completed: "已获取日志",
        running: "获取日志中",
      },
    },
  },
  {
    match: (name) =>
      name.includes("waitfor") ||
      name.includes("tabs") ||
      name.includes("resize") ||
      name.includes("install") ||
      name.includes("fileupload") ||
      name.includes("close"),
    config: {
      family: "browser",
      label: "浏览器操作",
      verb: "操作",
      icon: Globe,
      groupTitle: "浏览器",
      actionKey: "browser",
    },
  },
];

const PLANNING_TOOL_KEYS = new Set([
  "taskcreate",
  "tasklist",
  "taskget",
  "taskupdate",
  "enterplanmode",
  "exitplanmode",
]);

const getToolIcon = (toolName: string): LucideIcon => {
  const name = normalizeToolNameKey(toolName);
  if (name.includes("subagent")) {
    return Globe;
  }
  if (isBrowserToolName(name)) {
    return Globe;
  }
  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    return Terminal;
  }
  if (name.includes("read")) {
    return Eye;
  }
  if (name.includes("write") || name.includes("create")) {
    return FilePlus;
  }
  if (
    name.includes("edit") ||
    name.includes("replace") ||
    name.includes("patch")
  ) {
    return Edit3;
  }
  if (name.includes("list") || name.includes("dir")) {
    return FolderOpen;
  }
  if (
    name.includes("search") ||
    name.includes("find") ||
    name.includes("grep")
  ) {
    return Search;
  }
  if (name.includes("web") || name.includes("fetch") || name.includes("http")) {
    return Globe;
  }
  if (name.includes("code") || name.includes("eval")) {
    return Code2;
  }
  if (name.includes("config") || name.includes("setting")) {
    return Settings;
  }
  if (name.includes("file")) {
    return FileText;
  }
  return Wrench;
};

const selectToolAction = (
  actionKey: ToolStatusActionKey,
  status: ToolCallStatus,
): string => {
  const actions = TOOL_STATUS_ACTIONS[actionKey];
  if (status === "failed") {
    return actions.failed;
  }
  if (status === "completed") {
    return actions.completed;
  }
  return actions.running;
};

const toToolDisplayDescriptor = (
  config: ToolDisplayConfig,
  status: ToolCallStatus,
): ToolDisplayDescriptor => ({
  family: config.family,
  label: config.label,
  verb: config.verb,
  icon: config.icon,
  groupTitle: config.groupTitle,
  action: config.actions
    ? status === "failed"
      ? config.actions.failed
      : status === "completed"
        ? config.actions.completed
        : config.actions.running
    : selectToolAction(config.actionKey, status),
});

const stringifyToolArgumentValue = (
  value: ToolCallArgumentValue | unknown,
): string | null => {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((item) => stringifyToolArgumentValue(item))
      .filter((item): item is string => Boolean(item));
    return parts.length > 0 ? parts.join(", ") : null;
  }
  return null;
};

const truncatePreviewText = (value: string, max = 48): string =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const resolveToolArgumentPreview = (
  args: Record<string, ToolCallArgumentValue>,
  keys: string[],
): string | null => {
  for (const key of keys) {
    const value = stringifyToolArgumentValue(args[key]);
    if (value) {
      return truncatePreviewText(value);
    }
  }
  return null;
};

const getFileName = (filePath: string): string => {
  const parts = filePath.split(/[/\\]/);
  return parts[parts.length - 1] || filePath;
};

const TOOL_NAME_KEY_ALIASES: Record<string, string> = {
  ask: "askuserquestion",
  requestuserinput: "askuserquestion",
  requestuserinputtool: "askuserquestion",
  askuserquestiontool: "askuserquestion",
  brief: "sendusermessage",
  brieftool: "sendusermessage",
  sendusermessage: "sendusermessage",
  sendusermessagetool: "sendusermessage",
  spawnagent: "agent",
  subagenttask: "agent",
  agenttool: "agent",
  sendinput: "sendmessage",
  sendmessagetool: "sendmessage",
  bashtool: "bash",
  configtool: "config",
  enterplanmodetool: "enterplanmode",
  exitplanmodetool: "exitplanmode",
  enterworktreetool: "enterworktree",
  exitworktreetool: "exitworktree",
  filereadtool: "read",
  readfiletool: "read",
  filewritetool: "write",
  writefiletool: "write",
  createfiletool: "write",
  fileedittool: "edit",
  globtool: "glob",
  greptool: "grep",
  lsptool: "lsp",
  listmcpresourcestool: "listmcpresources",
  readmcpresourcetool: "readmcpresource",
  notebookedittool: "notebookedit",
  powershelltool: "powershell",
  remotetriggertool: "remotetrigger",
  schedulecrontool: "croncreate",
  croncreatetool: "croncreate",
  cronlisttool: "cronlist",
  crondeletetool: "crondelete",
  skilltool: "skill",
  sleeptool: "sleep",
  syntheticoutputtool: "structuredoutput",
  taskcreatetool: "taskcreate",
  taskgettool: "taskget",
  tasklisttool: "tasklist",
  taskoutputtool: "taskoutput",
  agentoutputtool: "taskoutput",
  bashoutputtool: "taskoutput",
  taskstoptool: "taskstop",
  taskupdatetool: "taskupdate",
  teamcreatetool: "teamcreate",
  teamdeletetool: "teamdelete",
  toolsearchtool: "toolsearch",
  webfetchtool: "webfetch",
  websearchtool: "websearch",
  task: "bash",
  killshell: "taskstop",
  todowrite: "taskupdate",
  writetodos: "taskupdate",
};

const USER_FACING_TOOL_LABELS: Record<string, string> = {
  文件读取: "查看文件",
  文档读取: "查看文档",
  资源读取: "查看内容",
  文件写入: "保存文件",
  文件创建: "保存文件",
  文件编辑: "修改文件",
  批量编辑: "修改文件",
  笔记本编辑: "修改文件",
  补丁应用: "修改文件",
  文件匹配: "查找文件",
  目录浏览: "查看文件夹",
  资源列表: "查看资源",
  资源模板列表: "查看资源模板",
  内容检索: "查找内容",
  工具搜索: "查找工具",
  文档搜索: "查找文档",
  文档查询: "查看文档",
  网络搜索: "搜索网页",
  图片搜索: "搜索图片",
  联网搜图: "搜索图片",
  命令执行: "运行命令",
  技能执行: "使用技能",
  技能列表: "查看技能",
  技能加载: "加载技能",
  任务输出: "查看任务结果",
  工作区同步: "同步内容",
  图像分析: "分析图片",
  图片查看: "查看图片",
  站点能力目录: "查看站点能力",
  站点能力搜索: "搜索站点能力",
  站点能力详情: "查看站点能力",
  站点能力执行: "运行站点能力",
};

export const normalizeToolNameKey = (value: string): string => {
  const normalized = value
    .replace(/[\s_-]+/g, "")
    .trim()
    .toLowerCase();
  return TOOL_NAME_KEY_ALIASES[normalized] || normalized;
};

export const humanizeToolName = (toolName: string): string =>
  toolName
    .replace(/^mcp__/, "")
    .replace(/__/g, " / ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim() || "工具调用";

export const parseToolCallArguments = (
  value?: string,
): Record<string, ToolCallArgumentValue> => {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, ToolCallArgumentValue>;
    }
  } catch {
    // ignore parse failure
  }
  return {};
};

export const resolveToolFilePath = (
  args: Record<string, ToolCallArgumentValue>,
): string | null => {
  return extractArtifactProtocolPathsFromValue(args)[0] ?? null;
};

export const isBrowserToolName = (name: string): boolean =>
  [
    "browser",
    "page",
    "runtime",
    "dom",
    "cdp",
    "playwright",
    "navigate",
    "screenshot",
    "snapshot",
    "click",
    "hover",
    "upload",
    "waitfor",
    "tabs",
    "open",
    "presskey",
    "type",
    "selectoption",
    "drag",
    "evaluate",
    "goto",
  ].some((marker) => name.includes(marker));

export const resolveToolPrimarySubject = (
  toolName: string,
  args: Record<string, ToolCallArgumentValue>,
  filePath?: string | null,
): string | null => {
  const normalizedName = normalizeToolNameKey(toolName);
  const searchQueryPreview = resolveToolArgumentPreview(args, [
    "query",
    "q",
    "search_query",
  ]);

  if (filePath) return getFileName(filePath);

  if (normalizedName === "bash" || normalizedName.includes("shell")) {
    return resolveToolArgumentPreview(args, ["command", "cmd", "cwd"]);
  }

  if (normalizedName === "agent") {
    return resolveToolArgumentPreview(args, [
      "description",
      "task",
      "taskType",
      "role",
      "agent_type",
      "model",
    ]);
  }

  if (normalizedName === "sendmessage") {
    return (
      resolveToolArgumentPreview(args, ["message", "id", "agent_id"]) ||
      "目标子任务"
    );
  }

  if (normalizedName === "sendusermessage" || normalizedName === "brief") {
    return resolveToolArgumentPreview(args, ["message"]) || "用户";
  }

  if (normalizedName === "teamcreate" || normalizedName === "teamdelete") {
    return (
      resolveToolArgumentPreview(args, ["team_name", "teamName"]) || "当前团队"
    );
  }

  if (normalizedName === "listpeers") {
    return (
      resolveToolArgumentPreview(args, ["team_name", "teamName"]) || "当前团队"
    );
  }

  if (
    normalizedName === "waitagent" ||
    normalizedName === "resumeagent" ||
    normalizedName === "closeagent"
  ) {
    return resolveToolArgumentPreview(args, ["id", "ids", "session_id"]);
  }

  if (
    normalizedName === "skill" ||
    normalizedName === "listskills" ||
    normalizedName === "loadskill"
  ) {
    return resolveToolArgumentPreview(args, [
      "name",
      "skill",
      "path",
      "query",
      "command",
    ]);
  }

  if (normalizedName === "analyzeimage" || normalizedName === "viewimage") {
    return resolveToolArgumentPreview(args, [
      "path",
      "image_path",
      "imagePath",
      "image_url",
      "url",
    ]);
  }

  if (isBrowserToolName(normalizedName)) {
    return (
      resolveToolArgumentPreview(args, [
        "url",
        "text",
        "textGone",
        "element",
        "name",
        "label",
        "ref",
        "key",
        "values",
        "value",
        "filename",
        "index",
        "id",
      ]) || "页面"
    );
  }

  if (
    normalizedName === "webfetch" ||
    normalizedName === "open" ||
    normalizedName === "finance" ||
    normalizedName === "weather" ||
    normalizedName === "sports" ||
    normalizedName === "time"
  ) {
    return resolveToolArgumentPreview(args, [
      "url",
      "location",
      "ticker",
      "team",
      "league",
      "utc_offset",
      "ref_id",
    ]);
  }

  if (
    normalizedName === "taskcreate" ||
    normalizedName === "tasklist" ||
    normalizedName === "taskget" ||
    normalizedName === "taskupdate" ||
    normalizedName === "taskoutput" ||
    normalizedName === "taskstop" ||
    normalizedName.startsWith("limecreate") ||
    normalizedName === "socialgeneratecoverimage" ||
    normalizedName === "generateimage"
  ) {
    return resolveToolArgumentPreview(args, [
      "subject",
      "taskId",
      "title",
      "topic",
      "keyword",
      "prompt",
      "description",
      "task_id",
      "url",
    ]);
  }

  if (normalizedName === "limesiterun" || normalizedName === "limesiteinfo") {
    return (
      resolveToolArgumentPreview(args, [
        "skill_title",
        "skillTitle",
        "adapter_name",
        "name",
        "query",
        "repo",
        "url",
      ]) || "站点适配器"
    );
  }

  if (normalizedName === "limesitesearch") {
    return resolveToolArgumentPreview(args, ["query", "q"]) || "站点能力";
  }

  if (normalizedName === "toolsearch") {
    if (
      searchQueryPreview &&
      !/^(?:select|tool|tools|name|tag):/i.test(searchQueryPreview)
    ) {
      return searchQueryPreview;
    }
    return "可用工具";
  }

  if (normalizedName === "askuserquestion") {
    return resolveToolArgumentPreview(args, [
      "question",
      "header",
      "prompt",
      "request_id",
    ]);
  }

  if (normalizedName === "remotetrigger") {
    return (
      resolveToolArgumentPreview(args, [
        "trigger_id",
        "triggerId",
        "action",
        "organization_uuid",
      ]) || "远程触发器"
    );
  }

  if (
    normalizedName === "croncreate" ||
    normalizedName === "cronlist" ||
    normalizedName === "crondelete"
  ) {
    return (
      resolveToolArgumentPreview(args, ["id", "cron", "schedule", "prompt"]) ||
      "定时触发器"
    );
  }

  return (
    resolveToolArgumentPreview(args, [
      "pattern",
      "query",
      "q",
      "search_query",
      "libraryName",
      "request_id",
      "path",
      "url",
      "command",
    ]) || null
  );
};

export const extractSearchQueryLabel = (toolCall: ToolCallState): string => {
  const record = parseToolCallArguments(toolCall.arguments) as Record<
    string,
    unknown
  >;
  for (const key of ["query", "q", "pattern", "search", "url"]) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      const sanitized = stripAssistantProtocolResidue(value).trim();
      if (sanitized) {
        return sanitized;
      }

      if (containsAssistantProtocolResidue(value)) {
        return "内部流程";
      }

      return value.trim();
    }
  }

  return toolCall.name;
};

export const getToolDisplayInfo = (
  toolName: string,
  status: ToolCallStatus,
): ToolDisplayDescriptor => {
  const name = normalizeToolNameKey(toolName);
  const exactMatch = EXACT_TOOL_CONFIGS.get(name);
  if (exactMatch) {
    return toToolDisplayDescriptor(exactMatch, status);
  }

  if (isBrowserToolName(name)) {
    const browserMatcher = BROWSER_TOOL_MATCHERS.find((item) =>
      item.match(name),
    );
    if (browserMatcher) {
      return toToolDisplayDescriptor(browserMatcher.config, status);
    }
  }

  if (
    name.includes("workspace") ||
    name.includes("artifact") ||
    name.includes("snapshot")
  ) {
    return toToolDisplayDescriptor(
      {
        family: "generic",
        label: "工作区同步",
        verb: "同步",
        icon: FileText,
        groupTitle: "工作区",
        actionKey: "generic",
      },
      status,
    );
  }

  if (
    name.includes("patch") ||
    name.includes("replace") ||
    name.includes("edit")
  ) {
    return toToolDisplayDescriptor(
      {
        family: "edit",
        label: "文件编辑",
        verb: "修改",
        icon: Edit3,
        groupTitle: "编辑",
        actionKey: "edit",
      },
      status,
    );
  }

  if (PLANNING_TOOL_KEYS.has(name)) {
    return toToolDisplayDescriptor(
      {
        family: "plan",
        label: "计划",
        verb: "更新计划",
        icon: FileText,
        groupTitle: "计划",
        actionKey: "plan",
      },
      status,
    );
  }

  if (name.includes("write") || name.includes("create")) {
    return toToolDisplayDescriptor(
      {
        family: "write",
        label: "文件写入",
        verb: "保存",
        icon: FilePlus,
        groupTitle: "写入",
        actionKey: "write",
      },
      status,
    );
  }

  if (name.includes("read")) {
    return toToolDisplayDescriptor(
      {
        family: "read",
        label: "文件读取",
        verb: "查看",
        icon: Eye,
        groupTitle: "探索",
        actionKey: "read",
      },
      status,
    );
  }

  if (
    name.includes("bash") ||
    name.includes("shell") ||
    name.includes("exec")
  ) {
    return toToolDisplayDescriptor(
      {
        family: "command",
        label: "命令执行",
        verb: "运行",
        icon: Terminal,
        groupTitle: "命令",
        actionKey: "command",
      },
      status,
    );
  }

  if (
    name.includes("search") ||
    name.includes("grep") ||
    name.includes("find")
  ) {
    return toToolDisplayDescriptor(
      {
        family: "search",
        label: "搜索",
        verb: "搜索",
        icon: Search,
        groupTitle: "搜索",
        actionKey: "search",
      },
      status,
    );
  }

  if (name.includes("list") || name.includes("dir")) {
    return toToolDisplayDescriptor(
      {
        family: "list",
        label: "目录浏览",
        verb: "查看",
        icon: FolderOpen,
        groupTitle: "探索",
        actionKey: "list",
      },
      status,
    );
  }

  return {
    family: "generic",
    label: humanizeToolName(toolName),
    action: selectToolAction("generic", status),
    verb: "处理",
    icon: getToolIcon(toolName),
    groupTitle: "工具",
  };
};

export const buildToolHeadline = (params: {
  toolDisplay: ToolDisplayDescriptor;
  subject?: string | null;
  toolName: string;
}): string => {
  const { toolDisplay, subject, toolName } = params;
  const normalizedSubject = subject?.trim();
  if (normalizedSubject) {
    return `${toolDisplay.action} ${normalizedSubject}`;
  }

  if (toolDisplay.label !== humanizeToolName(toolName)) {
    return toolDisplay.action;
  }

  return toolDisplay.label;
};

export const resolveToolDisplayLabel = (toolName: string): string =>
  getToolDisplayInfo(toolName, "completed").label;

export const toUserFacingToolDisplayLabel = (label: string): string => {
  const normalized = label.trim();
  return USER_FACING_TOOL_LABELS[normalized] || normalized;
};

export const resolveUserFacingToolDisplayLabel = (toolName: string): string =>
  toUserFacingToolDisplayLabel(resolveToolDisplayLabel(toolName).trim() || toolName);

export const buildToolGroupHeadline = (toolCalls: ToolCallState[]): string => {
  const first = toolCalls[0]!;
  const info = getToolDisplayInfo(first.name, first.status);
  const failed = toolCalls.some((item) => item.status === "failed");
  const running = toolCalls.some((item) => item.status === "running");

  if (info.family === "search") {
    if (info.groupTitle === "站点") {
      return running
        ? "站点搜索中"
        : failed
          ? "站点搜索失败"
          : "已搜索站点能力";
    }
    return running ? "搜索中" : failed ? "搜索失败" : "已搜索";
  }

  if (["read", "list"].includes(info.family)) {
    if (info.groupTitle === "站点") {
      return running
        ? "站点浏览中"
        : failed
          ? "站点浏览失败"
          : "已浏览站点能力";
    }
    return running ? "查看中" : failed ? "查看失败" : "已查看";
  }

  if (info.family === "command") {
    return failed
      ? `运行失败 ${toolCalls.length} 条命令`
      : running
        ? `运行中 ${toolCalls.length} 条命令`
        : `已运行 ${toolCalls.length} 条命令`;
  }

  if (info.family === "write") {
    return failed
      ? `保存失败 ${toolCalls.length} 个文件`
      : running
        ? `保存中 ${toolCalls.length} 个文件`
        : `已保存 ${toolCalls.length} 个文件`;
  }

  if (info.family === "edit") {
    return failed
      ? `编辑失败 ${toolCalls.length} 个文件`
      : running
        ? `编辑中 ${toolCalls.length} 个文件`
        : `已编辑 ${toolCalls.length} 个文件`;
  }

  if (info.family === "browser") {
    return failed
      ? `页面操作失败 ${toolCalls.length} 步`
      : running
        ? `页面操作中 ${toolCalls.length} 步`
        : `已完成 ${toolCalls.length} 步页面操作`;
  }

  if (info.family === "subagent") {
    return failed
      ? `子任务失败 ${toolCalls.length} 项`
      : running
        ? `子任务处理中 ${toolCalls.length} 项`
        : `已完成 ${toolCalls.length} 项子任务操作`;
  }

  if (info.family === "task") {
    return failed
      ? `任务失败 ${toolCalls.length} 项`
      : running
        ? `任务进行中 ${toolCalls.length} 项`
        : `已完成 ${toolCalls.length} 项任务`;
  }

  if (info.family === "plan") {
    return failed
      ? `安排处理失败 ${toolCalls.length} 项`
      : running
        ? `安排处理中 ${toolCalls.length} 项`
        : `已处理 ${toolCalls.length} 项安排`;
  }

  if (info.family === "skill") {
    return failed
      ? `技能执行失败 ${toolCalls.length} 项`
      : running
        ? `技能执行中 ${toolCalls.length} 项`
        : `已执行 ${toolCalls.length} 项技能操作`;
  }

  if (info.family === "fetch") {
    return failed
      ? `获取失败 ${toolCalls.length} 项`
      : running
        ? `获取中 ${toolCalls.length} 项`
        : `已获取 ${toolCalls.length} 项数据`;
  }

  if (info.family === "vision") {
    return failed
      ? `图像分析失败 ${toolCalls.length} 项`
      : running
        ? `图像分析中 ${toolCalls.length} 项`
        : `已分析 ${toolCalls.length} 项图像`;
  }

  if (info.groupTitle === "站点") {
    return failed
      ? `站点操作失败 ${toolCalls.length} 项`
      : running
        ? `站点操作中 ${toolCalls.length} 项`
        : `已完成 ${toolCalls.length} 项站点操作`;
  }

  return failed
    ? `失败 ${toolCalls.length} 个步骤`
    : running
      ? `进行中 ${toolCalls.length} 个步骤`
      : `已完成 ${toolCalls.length} 个步骤`;
};

export const buildGroupedChildLine = (toolCall: ToolCallState): string => {
  const info = getToolDisplayInfo(toolCall.name, toolCall.status);
  const args = parseToolCallArguments(toolCall.arguments);
  const filePath = resolveToolFilePath(args);
  const subject =
    resolveToolPrimarySubject(toolCall.name, args, filePath) ||
    humanizeToolName(toolCall.name);
  const normalizedSubject = subject?.trim();
  if (!normalizedSubject) {
    return info.label;
  }

  return `${info.verb} ${normalizedSubject}`;
};
