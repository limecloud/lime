import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  CheckSquare,
  Quote,
  Code,
  Minus,
  ImageIcon,
  Table,
} from "lucide-react";
import type { Editor, Range } from "@tiptap/core";

// --- 命令项定义 ---

export interface CommandItemDef {
  title: string;
  description: string;
  searchTerms?: string[];
  icon: React.ReactNode;
  command: (p: { editor: Editor; range: Range }) => void;
}

const SLASH_ITEMS: CommandItemDef[] = [
  {
    title: "标题 1",
    description: "大标题",
    searchTerms: ["h1", "heading"],
    icon: <Heading1 className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 1 })
        .run(),
  },
  {
    title: "标题 2",
    description: "中标题",
    searchTerms: ["h2", "heading"],
    icon: <Heading2 className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 2 })
        .run(),
  },
  {
    title: "标题 3",
    description: "小标题",
    searchTerms: ["h3", "heading"],
    icon: <Heading3 className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .setNode("heading", { level: 3 })
        .run(),
  },
  {
    title: "待办列表",
    description: "任务清单",
    searchTerms: ["todo", "task", "checkbox"],
    icon: <CheckSquare className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleTaskList().run(),
  },
  {
    title: "无序列表",
    description: "项目符号列表",
    searchTerms: ["bullet", "unordered", "list"],
    icon: <List className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleBulletList().run(),
  },
  {
    title: "有序列表",
    description: "编号列表",
    searchTerms: ["ordered", "number", "list"],
    icon: <ListOrdered className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleOrderedList().run(),
  },
  {
    title: "引用",
    description: "引用块",
    searchTerms: ["blockquote", "quote"],
    icon: <Quote className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .toggleNode("paragraph", "paragraph")
        .toggleBlockquote()
        .run(),
  },
  {
    title: "代码块",
    description: "代码片段",
    searchTerms: ["code", "codeblock"],
    icon: <Code className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).toggleCodeBlock().run(),
  },
  {
    title: "分割线",
    description: "水平分隔线",
    searchTerms: ["hr", "divider", "separator"],
    icon: <Minus className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor.chain().focus().deleteRange(range).setHorizontalRule().run(),
  },
  {
    title: "图片",
    description: "插入图片链接",
    searchTerms: ["image", "photo", "picture"],
    icon: <ImageIcon className="w-4 h-4" />,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      const url = window.prompt("输入图片 URL");
      if (url) editor.chain().focus().setImage({ src: url }).run();
    },
  },
  {
    title: "表格",
    description: "插入表格",
    searchTerms: ["table", "grid"],
    icon: <Table className="w-4 h-4" />,
    command: ({ editor, range }) =>
      editor
        .chain()
        .focus()
        .deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run(),
  },
];

function filterItems(query: string): CommandItemDef[] {
  const q = query.toLowerCase();
  return SLASH_ITEMS.filter(
    (item) =>
      item.title.toLowerCase().includes(q) ||
      item.description.toLowerCase().includes(q) ||
      item.searchTerms?.some((t) => t.toLowerCase().includes(q)),
  );
}

// --- 状态类型 ---

export interface SlashMenuState {
  isOpen: boolean;
  items: CommandItemDef[];
  range: Range | null;
  clientRect: DOMRect | null;
}

export type SlashMenuKeyHandler = (event: KeyboardEvent) => boolean;

// --- ProseMirror Plugin 实现 ---

const slashPluginKey = new PluginKey("slashCommand");

interface SlashCommandOptions {
  onStateChange: (state: SlashMenuState) => void;
  onKeyDownRef: React.MutableRefObject<SlashMenuKeyHandler | null>;
}

function createSlashPlugin(editor: Editor, options: SlashCommandOptions) {
  let wasActive = false;

  return new Plugin({
    key: slashPluginKey,
    state: {
      init() {
        return {
          active: false as boolean,
          slashPos: -1,
          query: "",
          items: [] as CommandItemDef[],
        };
      },
      apply(tr, prev) {
        if (!tr.docChanged) return prev;

        const { $from } = tr.selection;
        const textBefore = $from.parent.textBetween(
          Math.max(0, $from.parentOffset - 20),
          $from.parentOffset,
          "\0",
        );

        const slashIdx = textBefore.lastIndexOf("/");
        if (slashIdx === -1) {
          return { active: false, slashPos: -1, query: "", items: [] };
        }

        const query = textBefore.slice(slashIdx + 1);
        if (query.includes(" ") || query.includes("\0")) {
          return { active: false, slashPos: -1, query: "", items: [] };
        }

        const items = filterItems(query);
        const docSlashPos = $from.pos - (textBefore.length - slashIdx);

        return { active: true, slashPos: docSlashPos, query, items };
      },
    },
    props: {
      handleKeyDown(view, event) {
        const state = slashPluginKey.getState(view.state);
        if (state?.active) {
          return options.onKeyDownRef.current?.(event) ?? false;
        }
        return false;
      },
    },
    view() {
      return {
        update: (view) => {
          const state = slashPluginKey.getState(view.state);
          const isActive = state?.active ?? false;

          if (isActive) {
            const { from } = view.state.selection;
            const coords = view.coordsAtPos(from);
            options.onStateChange({
              isOpen: true,
              items: state.items,
              range: { from: state.slashPos, to: from },
              clientRect: new DOMRect(
                coords.left,
                coords.top,
                0,
                coords.bottom - coords.top,
              ),
            });
            wasActive = true;
          } else if (wasActive) {
            options.onStateChange({
              isOpen: false,
              items: [],
              range: null,
              clientRect: null,
            });
            wasActive = false;
          }
        },
        destroy: () => {
          wasActive = false;
        },
      };
    },
  });
}

export const SlashCommand = Extension.create<SlashCommandOptions>({
  name: "slashCommand",

  addOptions() {
    return {
      onStateChange: () => {},
      onKeyDownRef: { current: null },
    };
  },

  addProseMirrorPlugins() {
    return [createSlashPlugin(this.editor, this.options)];
  },
});

// --- 命令列表 UI 组件 ---

interface CommandListProps {
  editor: Editor;
  items: CommandItemDef[];
  range: Range;
  clientRect: DOMRect | null;
  onKeyDownRef: React.MutableRefObject<SlashMenuKeyHandler | null>;
  onClose: () => void;
}

export const CommandList: React.FC<CommandListProps> = ({
  editor,
  items,
  range,
  clientRect,
  onKeyDownRef,
  onClose,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  useEffect(() => {
    setSelectedIndex(0);
  }, [items]);

  const executeCommand = (item: CommandItemDef) => {
    item.command({ editor, range });
    onClose();
  };

  // 注册键盘处理
  useEffect(() => {
    onKeyDownRef.current = (event: KeyboardEvent) => {
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setSelectedIndex((i) =>
          items.length > 0 ? (i - 1 + items.length) % items.length : 0,
        );
        return true;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setSelectedIndex((i) =>
          items.length > 0 ? (i + 1) % items.length : 0,
        );
        return true;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        if (items[selectedIndex]) {
          executeCommand(items[selectedIndex]);
        }
        return true;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return true;
      }
      return false;
    };
    return () => {
      onKeyDownRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, selectedIndex, onClose]);

  if (items.length === 0) return null;

  const top = clientRect ? clientRect.bottom + 4 : 0;
  const left = clientRect ? clientRect.left : 0;
  const maxLeft = Math.max(window.innerWidth - 280, 8);
  const popupLeft = Math.min(Math.max(left, 8), maxLeft);

  const popup = (
    <div
      className="fixed z-[9999] w-64 max-h-72 overflow-y-auto rounded-lg border border-border shadow-lg"
      style={{
        top,
        left: popupLeft,
        background: "hsl(var(--background))",
      }}
    >
      {items.map((item, index) => (
        <button
          key={item.title}
          className={`flex items-center gap-3 w-full px-3 py-2 text-left text-sm transition-colors ${
            index === selectedIndex
              ? "bg-accent text-accent-foreground"
              : "text-foreground hover:bg-accent/50"
          }`}
          onMouseDown={(e) => {
            e.preventDefault();
            executeCommand(item);
          }}
          onMouseEnter={() => setSelectedIndex(index)}
        >
          <span
            className="flex items-center justify-center w-8 h-8 rounded-md border border-border"
            style={{ background: "hsl(var(--background))" }}
          >
            {item.icon}
          </span>
          <div>
            <div className="font-medium">{item.title}</div>
            <div className="text-xs text-muted-foreground">
              {item.description}
            </div>
          </div>
        </button>
      ))}
    </div>
  );

  return createPortal(popup, document.body);
};
