/**
 * @file 文档编辑器组件
 * @description Markdown 源码编辑器
 * @module components/content-creator/canvas/document/DocumentEditor
 */

import React, { memo, useRef, useEffect } from "react";
import styled from "styled-components";
import type { DocumentEditorProps } from "./types";
import { resolveDocumentEditorHotkeyAction } from "./documentEditorHotkeys";

const Container = styled.div`
  display: flex;
  flex-direction: column;
  flex: 1;
  overflow: hidden;
`;

const TextArea = styled.textarea`
  flex: 1;
  padding: 16px;
  border: none;
  background: hsl(var(--background));
  color: hsl(var(--foreground));
  font-family: "SF Mono", Consolas, "Liberation Mono", Menlo, monospace;
  font-size: 14px;
  line-height: 1.6;
  resize: none;
  outline: none;

  &::placeholder {
    color: hsl(var(--muted-foreground));
  }

  &:focus {
    outline: none;
  }
`;

/**
 * 文档编辑器组件
 */
export const DocumentEditor: React.FC<DocumentEditorProps> = memo(
  ({ content, onChange, onSave, onCancel }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // 自动聚焦
    useEffect(() => {
      if (textareaRef.current) {
        textareaRef.current.focus();
        // 将光标移到末尾
        const len = textareaRef.current.value.length;
        textareaRef.current.setSelectionRange(len, len);
      }
    }, []);

    // 处理快捷键
    const handleKeyDown = (e: React.KeyboardEvent) => {
      const action = resolveDocumentEditorHotkeyAction(e.nativeEvent);
      if (!action) {
        return;
      }

      e.preventDefault();
      if (action === "save") {
        onSave();
        return;
      }

      onCancel();
    };

    return (
      <Container>
        <TextArea
          ref={textareaRef}
          value={content}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="在这里编辑 Markdown 内容..."
        />
      </Container>
    );
  },
);

DocumentEditor.displayName = "DocumentEditor";
