import TurndownService from "turndown";
import { marked } from "marked";

// --- Markdown → HTML ---

export function markdownToHtml(md: string): string {
  if (!md.trim()) return "";
  return marked.parse(md, { async: false }) as string;
}

// --- HTML → Markdown ---

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
  bulletListMarker: "-",
  emDelimiter: "*",
  strongDelimiter: "**",
});

// 任务列表规则
turndown.addRule("taskListItem", {
  filter: (node) =>
    node.nodeName === "LI" &&
    node.parentElement?.getAttribute("data-type") === "taskList",
  replacement: (_content, node) => {
    const el = node as HTMLElement;
    const checkbox = el.querySelector('input[type="checkbox"]');
    const checked = checkbox?.hasAttribute("checked") ?? false;
    const text = _content.replace(/^\n+/, "").replace(/\n+$/, "");
    return `- [${checked ? "x" : " "}] ${text}\n`;
  },
});

// 高亮文本规则
turndown.addRule("highlight", {
  filter: "mark",
  replacement: (content) => `==${content}==`,
});

// 删除线规则
turndown.addRule("strikethrough", {
  filter: "s",
  replacement: (content) => `~~${content}~~`,
});

export function htmlToMarkdown(html: string): string {
  if (!html.trim()) return "";
  return turndown.turndown(html);
}
