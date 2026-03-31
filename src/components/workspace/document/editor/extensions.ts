import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import Image from "@tiptap/extension-image";
import Highlight from "@tiptap/extension-highlight";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import { SlashCommand } from "./SlashCommand";
import type { SlashMenuState, SlashMenuKeyHandler } from "./SlashCommand";
import type { Extensions } from "@tiptap/react";
import type { MutableRefObject } from "react";

interface ExtensionConfig {
  onStateChange: (state: SlashMenuState) => void;
  onKeyDownRef: MutableRefObject<SlashMenuKeyHandler | null>;
}

export function createExtensions(config: ExtensionConfig): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      codeBlock: {
        HTMLAttributes: { class: "notion-code-block" },
      },
    }),
    Placeholder.configure({
      placeholder: "输入内容，按 / 打开命令菜单…",
      emptyEditorClass: "is-editor-empty",
    }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Image.configure({ inline: false, allowBase64: true }),
    Highlight.configure({ multicolor: false }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    SlashCommand.configure({
      onStateChange: config.onStateChange,
      onKeyDownRef: config.onKeyDownRef,
    }),
  ];
}
