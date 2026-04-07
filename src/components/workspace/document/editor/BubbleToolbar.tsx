import React, { useState, useEffect, useRef } from "react";
import { type Editor } from "@tiptap/react";
import {
  Bold,
  Italic,
  Strikethrough,
  Code,
  Highlighter,
  Heading1,
  Heading2,
  Heading3,
} from "lucide-react";

interface BubbleToolbarProps {
  editor: Editor;
}

interface ToolbarButtonProps {
  onClick: () => void;
  isActive?: boolean;
  children: React.ReactNode;
  title: string;
}

const ToolbarButton: React.FC<ToolbarButtonProps> = ({
  onClick,
  isActive,
  children,
  title,
}) => (
  <button
    type="button"
    onMouseDown={(e) => {
      e.preventDefault();
      onClick();
    }}
    title={title}
    className={`pointer-events-auto p-1.5 rounded transition-colors ${
      isActive
        ? "bg-accent text-accent-foreground"
        : "text-muted-foreground hover:bg-accent/50 hover:text-foreground"
    }`}
  >
    {children}
  </button>
);

export const BubbleToolbar: React.FC<BubbleToolbarProps> = ({ editor }) => {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const toolbarRef = useRef<HTMLDivElement>(null);
  const isPointerSelectingRef = useRef(false);
  const visibleRef = useRef(false);
  const updateFrameRef = useRef<number | null>(null);

  useEffect(() => {
    visibleRef.current = visible;
  }, [visible]);

  useEffect(() => {
    const EDGE_PADDING = 8;
    const VERTICAL_GAP = 8;

    const setToolbarVisible = (nextVisible: boolean) => {
      if (visibleRef.current === nextVisible) {
        return;
      }
      visibleRef.current = nextVisible;
      setVisible(nextVisible);
    };

    const clearUpdateFrame = () => {
      if (updateFrameRef.current !== null) {
        window.cancelAnimationFrame(updateFrameRef.current);
        updateFrameRef.current = null;
      }
    };

    const updateToolbarNow = () => {
      if (isPointerSelectingRef.current) {
        setToolbarVisible(false);
        return;
      }

      const { from, to, empty } = editor.state.selection;
      if (empty || from === to) {
        setToolbarVisible(false);
        return;
      }

      const { view } = editor;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      const wrapper = view.dom.closest(".notion-editor-wrapper");
      if (!(wrapper instanceof HTMLElement)) {
        setToolbarVisible(false);
        return;
      }

      const wrapperRect = wrapper.getBoundingClientRect();
      const toolbarWidth = toolbarRef.current?.offsetWidth ?? 300;
      const toolbarHeight = toolbarRef.current?.offsetHeight ?? 34;
      const wrapperWidth = wrapper.clientWidth;
      const wrapperHeight = wrapper.clientHeight;

      const centeredLeft =
        (start.left + end.left) / 2 - wrapperRect.left - toolbarWidth / 2;
      const clampedLeft = Math.max(
        EDGE_PADDING,
        Math.min(
          centeredLeft,
          Math.max(EDGE_PADDING, wrapperWidth - toolbarWidth - EDGE_PADDING),
        ),
      );

      const preferredTop =
        start.top - wrapperRect.top - toolbarHeight - VERTICAL_GAP;
      const fallbackTop = start.bottom - wrapperRect.top + VERTICAL_GAP;
      const resolvedTop =
        preferredTop >= EDGE_PADDING ? preferredTop : fallbackTop;
      const clampedTop = Math.max(
        EDGE_PADDING,
        Math.min(
          resolvedTop,
          Math.max(EDGE_PADDING, wrapperHeight - toolbarHeight - EDGE_PADDING),
        ),
      );

      setPosition((prev) => {
        if (prev.top === clampedTop && prev.left === clampedLeft) {
          return prev;
        }
        return {
          top: clampedTop,
          left: clampedLeft,
        };
      });
      setToolbarVisible(true);
    };

    const scheduleToolbarUpdate = () => {
      clearUpdateFrame();
      updateFrameRef.current = window.requestAnimationFrame(() => {
        updateFrameRef.current = null;
        updateToolbarNow();
      });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      isPointerSelectingRef.current = true;
      clearUpdateFrame();
      setToolbarVisible(false);
    };

    const handlePointerUp = () => {
      if (!isPointerSelectingRef.current) {
        return;
      }
      isPointerSelectingRef.current = false;
      scheduleToolbarUpdate();
    };

    const handlePointerCancel = () => {
      isPointerSelectingRef.current = false;
      clearUpdateFrame();
    };

    const handleSelectionUpdate = () => {
      if (isPointerSelectingRef.current) {
        return;
      }
      scheduleToolbarUpdate();
    };

    const editorElement = editor.view.dom as HTMLElement;
    editorElement.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    editor.on("selectionUpdate", handleSelectionUpdate);
    const handleBlur = () => {
      // 延迟隐藏，允许点击工具栏按钮
      clearUpdateFrame();
      setTimeout(() => setToolbarVisible(false), 200);
    };
    editor.on("blur", handleBlur);

    return () => {
      editorElement.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
      editor.off("selectionUpdate", handleSelectionUpdate);
      editor.off("blur", handleBlur);
      clearUpdateFrame();
    };
  }, [editor]);

  if (!visible) return null;

  return (
    <div
      ref={toolbarRef}
      className="pointer-events-none absolute z-50 flex items-center gap-0.5 rounded-lg border border-border px-1 py-0.5 shadow-lg"
      style={{
        top: position.top,
        left: position.left,
        background: "hsl(var(--background))",
      }}
    >
      <ToolbarButton
        onClick={() => editor.chain().focus().toggleBold().run()}
        isActive={editor.isActive("bold")}
        title="粗体"
      >
        <Bold className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleItalic().run()}
        isActive={editor.isActive("italic")}
        title="斜体"
      >
        <Italic className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleStrike().run()}
        isActive={editor.isActive("strike")}
        title="删除线"
      >
        <Strikethrough className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleCode().run()}
        isActive={editor.isActive("code")}
        title="行内代码"
      >
        <Code className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHighlight().run()}
        isActive={editor.isActive("highlight")}
        title="高亮"
      >
        <Highlighter className="w-4 h-4" />
      </ToolbarButton>

      <div className="w-px h-5 bg-border mx-0.5" />

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}
        isActive={editor.isActive("heading", { level: 1 })}
        title="标题 1"
      >
        <Heading1 className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        isActive={editor.isActive("heading", { level: 2 })}
        title="标题 2"
      >
        <Heading2 className="w-4 h-4" />
      </ToolbarButton>

      <ToolbarButton
        onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        isActive={editor.isActive("heading", { level: 3 })}
        title="标题 3"
      >
        <Heading3 className="w-4 h-4" />
      </ToolbarButton>
    </div>
  );
};
