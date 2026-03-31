/**
 * @file A2UI 解析器
 * @description 从 AI 响应中提取和解析 A2UI JSON
 * @module components/workspace/a2ui/parser
 */

import type { A2UIResponse, ParseResult, ParsedMessageContent } from "./types";
import { isDataBindingValue, resolveDataAtPath } from "./dataModel";
import { convertProtocolToA2UIResponse } from "./protocol";

/** A2UI 标签正则 - 支持 <a2ui> 和 ```a2ui 代码块 */
const A2UI_TAG_REGEX = /<a2ui>([\s\S]*?)<\/a2ui>/g;

/** 文档标签正则 */
const DOCUMENT_REGEX = /<document>([\s\S]*?)<\/document>/g;

/** 文件写入标签正则 - 用于实时写入画布，支持 path 属性 */
const WRITE_FILE_REGEX =
  /<write_file(?:\s+path=["']([^"']+)["'])?\s*>([\s\S]*?)<\/write_file>/g;
const WRITE_FILE_PENDING_REGEX =
  /<write_file(?:\s+path=["']([^"']+)["'])?\s*>([\s\S]*)$/i;

/** 简化表单格式 - 用于 AI 更容易生成 */
export interface SimpleFormField {
  id: string;
  type: "choice" | "text" | "slider" | "checkbox";
  label: string;
  description?: string;
  options?: { value: string; label: string; description?: string }[];
  default?: string | number | boolean | string[];
  min?: number;
  max?: number;
  placeholder?: string;
  variant?: "single" | "multiple";
}

export interface SimpleFormResponse {
  type: "form";
  title: string;
  description?: string;
  fields: SimpleFormField[];
  submitLabel?: string;
}

/** 检查是否为简化表单格式 */
function isSimpleForm(obj: unknown): obj is SimpleFormResponse {
  return (
    typeof obj === "object" &&
    obj !== null &&
    (obj as SimpleFormResponse).type === "form" &&
    Array.isArray((obj as SimpleFormResponse).fields)
  );
}

/** 将简化表单转换为 A2UI 响应格式 */
function convertSimpleFormToA2UI(form: SimpleFormResponse): A2UIResponse {
  const components: A2UIResponse["components"] = [];
  const childIds: string[] = [];

  // 添加标题
  if (form.title) {
    const titleId = "title";
    components.push({
      id: titleId,
      component: "Text",
      text: form.title,
      variant: "h3",
    });
    childIds.push(titleId);
  }

  // 添加描述
  if (form.description) {
    const descId = "description";
    components.push({
      id: descId,
      component: "Text",
      text: form.description,
      variant: "caption",
    });
    childIds.push(descId);
  }

  // 转换字段
  for (const field of form.fields) {
    switch (field.type) {
      case "choice": {
        const options = (field.options || []).map((opt) => ({
          label: opt.label,
          value: opt.value,
          description: opt.description,
        }));

        components.push({
          id: field.id,
          component: "ChoicePicker",
          label: field.label,
          options,
          value: field.default
            ? Array.isArray(field.default)
              ? field.default
              : [field.default as string]
            : [],
          // 兼容 "multiple" 和 "multipleSelection" 两种格式
          variant:
            field.variant === "multiple" ||
            field.variant === ("multipleSelection" as any)
              ? "multipleSelection"
              : "mutuallyExclusive",
          layout: "wrap",
        });
        childIds.push(field.id);
        break;
      }
      case "text": {
        components.push({
          id: field.id,
          component: "TextField",
          label: field.label,
          value: (field.default as string) || "",
          placeholder: field.placeholder,
          helperText: field.description,
        });
        childIds.push(field.id);
        break;
      }
      case "slider": {
        components.push({
          id: field.id,
          component: "Slider",
          label: field.label,
          min: field.min || 0,
          max: field.max || 100,
          value: (field.default as number) || field.min || 0,
          showValue: true,
        });
        childIds.push(field.id);
        break;
      }
      case "checkbox": {
        components.push({
          id: field.id,
          component: "CheckBox",
          label: field.label,
          value: (field.default as boolean) || false,
        });
        childIds.push(field.id);
        break;
      }
    }
  }

  // 创建根布局
  const rootId = "root";
  components.push({
    id: rootId,
    component: "Column",
    children: childIds,
    gap: 16,
    align: "stretch",
  });

  return {
    id: `form-${Date.now()}`,
    components,
    root: rootId,
    data: {},
    submitAction: {
      label: form.submitLabel || "提交",
      action: { name: "submit" },
    },
  };
}

/**
 * 解析 AI 响应，提取 A2UI 组件和普通文本
 * 支持检测流式输出中未完成的代码块
 */
export function parseAIResponse(
  content: string,
  _isStreaming: boolean = false,
): ParseResult {
  const parts: ParsedMessageContent[] = [];
  let hasA2UI = false;
  let hasWriteFile = false;
  let hasPending = false;
  let lastIndex = 0;

  // 合并所有标签的位置
  const matches: {
    start: number;
    end: number;
    type:
      | "a2ui"
      | "document"
      | "write_file"
      | "pending_a2ui"
      | "pending_write_file";
    content: string;
    filePath?: string;
  }[] = [];

  // 查找 <a2ui> 标签
  let match: RegExpExecArray | null;
  const a2uiTagRegex = new RegExp(A2UI_TAG_REGEX.source, "g");
  while ((match = a2uiTagRegex.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "a2ui",
      content: match[1].trim(),
    });
  }

  // 查找 ```a2ui 代码块 - 使用更宽松的正则
  // 支持 ```a2ui, ```A2UI, ``` a2ui 等变体
  const a2uiCodeRegex = /```\s*a2ui\s*\n?([\s\S]*?)```/gi;
  while ((match = a2uiCodeRegex.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "a2ui",
      content: match[1].trim(),
    });
  }

  // 检测未闭合的 ```a2ui 代码块（流式输出中）
  const pendingA2UIMatch = content.match(/```\s*a2ui\s*\n?([\s\S]*)$/i);
  if (pendingA2UIMatch && !content.match(/```\s*a2ui\s*\n?[\s\S]*?```/i)) {
    // 有开始标记但没有结束标记
    const startIndex = content.lastIndexOf(pendingA2UIMatch[0]);
    matches.push({
      start: startIndex,
      end: content.length,
      type: "pending_a2ui",
      content: pendingA2UIMatch[1] || "",
    });
    hasPending = true;
  }

  // 查找 <write_file> 标签 - 用于实时写入画布，支持 path 属性
  const writeFileRegex = new RegExp(WRITE_FILE_REGEX.source, "g");
  while ((match = writeFileRegex.exec(content)) !== null) {
    const filePath = match[1] || "文档.md"; // 默认文件名
    const fileContent = match[2].trim();
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "write_file",
      content: fileContent,
      filePath,
    });
    hasWriteFile = true;
  }

  // 检测未闭合的 <write_file> 标签
  const pendingWriteMatch = content.match(WRITE_FILE_PENDING_REGEX);
  if (
    pendingWriteMatch &&
    !content.match(
      /<write_file(?:\s+path=["'][^"']+["'])?\s*>[\s\S]*?<\/write_file>/i,
    )
  ) {
    const startIndex = content.lastIndexOf(pendingWriteMatch[0]);
    const filePath = pendingWriteMatch[1] || "文档.md";
    matches.push({
      start: startIndex,
      end: content.length,
      type: "pending_write_file",
      content: pendingWriteMatch[2] || "",
      filePath,
    });
    hasPending = true;
    hasWriteFile = true;
  }

  // 查找文档标签（兼容旧格式）
  const docRegex = new RegExp(DOCUMENT_REGEX.source, "g");
  while ((match = docRegex.exec(content)) !== null) {
    matches.push({
      start: match.index,
      end: match.index + match[0].length,
      type: "document",
      content: match[1].trim(),
    });
  }

  // 按位置排序
  matches.sort((a, b) => a.start - b.start);

  // 处理每个匹配
  for (const m of matches) {
    // 添加匹配前的文本
    if (m.start > lastIndex) {
      const textBefore = content.slice(lastIndex, m.start).trim();
      if (textBefore) {
        parts.push({ type: "text", content: textBefore });
      }
    }

    if (m.type === "a2ui") {
      // 解析 A2UI JSON
      const a2ui = parseA2UIJson(m.content);
      if (a2ui) {
        parts.push({ type: "a2ui", content: a2ui });
        hasA2UI = true;
      } else {
        // 解析失败，作为文本处理
        parts.push({ type: "text", content: m.content });
      }
    } else if (m.type === "pending_a2ui") {
      // 未完成的 A2UI 代码块 - 显示加载状态
      parts.push({ type: "pending_a2ui", content: m.content });
    } else if (m.type === "write_file") {
      // 文件写入内容 - 发送到画布，包含文件路径
      parts.push({
        type: "write_file",
        content: m.content,
        filePath: m.filePath,
      });
    } else if (m.type === "pending_write_file") {
      // 未完成的文件写入 - 显示加载状态，包含文件路径
      parts.push({
        type: "pending_write_file",
        content: m.content,
        filePath: m.filePath,
      });
    } else {
      // 文档内容（兼容旧格式）
      parts.push({ type: "document", content: m.content });
    }

    lastIndex = m.end;
  }

  // 添加剩余文本
  if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex).trim();
    if (remaining) {
      parts.push({ type: "text", content: remaining });
    }
  }

  // 如果没有找到任何标签，整个内容作为文本
  if (parts.length === 0) {
    parts.push({ type: "text", content: content.trim() });
  }

  return { parts, hasA2UI, hasWriteFile, hasPending };
}

function parseJsonLines(jsonStr: string): unknown[] | null {
  const lines = jsonStr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length <= 1) {
    return null;
  }

  const messages: unknown[] = [];

  for (const line of lines) {
    messages.push(JSON.parse(line));
  }

  return messages;
}

/**
 * 解析 A2UI JSON 字符串
 * 支持三类格式：
 * 1. 完整 A2UI 响应
 * 2. 简化表单格式（type: 'form'）
 * 3. 官方/aster-rust 的 JSON / JSONL 消息流
 */
export function parseA2UIJson(jsonStr: string): A2UIResponse | null {
  try {
    // 清理 JSON 字符串 - 处理可能存在的 ``` 标记
    let cleaned = jsonStr
      .replace(/^```(?:json|a2ui)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = (() => {
      try {
        return JSON.parse(cleaned);
      } catch {
        return parseJsonLines(cleaned);
      }
    })();

    if (parsed === null) {
      return null;
    }

    // 检查是否为简化表单格式
    if (isSimpleForm(parsed)) {
      return convertSimpleFormToA2UI(parsed);
    }

    const response = convertProtocolToA2UIResponse(parsed);
    if (response) {
      return response;
    }

    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "id" in parsed &&
      "components" in parsed &&
      "root" in parsed
    ) {
      if (!Array.isArray((parsed as A2UIResponse).components)) {
        console.warn("[A2UI Parser] components 不是数组");
        return null;
      }
      return parsed as A2UIResponse;
    }

    console.warn(
      "[A2UI Parser] 无法识别的格式:",
      typeof parsed === "object" && parsed !== null
        ? Object.keys(parsed)
        : parsed,
    );
    return null;
  } catch (e) {
    // 只在内容足够长时打印警告（可能是完整但格式错误的 JSON）
    if (jsonStr.length > 100) {
      console.warn(
        "[A2UI Parser] JSON 解析失败 (内容长度:",
        jsonStr.length,
        "):",
        e,
      );
    }
    return null;
  }
}

/**
 * 从组件列表中获取组件
 */
export function getComponentById(
  components: A2UIResponse["components"],
  id: string,
): A2UIResponse["components"][number] | undefined {
  return components.find((c) => c.id === id);
}

/**
 * 解析动态值
 */
export function resolveDynamicValue<T>(
  value: T | { path: string } | undefined,
  data: Record<string, unknown>,
  defaultValue: T,
  scopePath: string = "/",
): T {
  if (value === undefined) {
    return defaultValue;
  }

  if (isDataBindingValue(value)) {
    const resolved = resolveDataAtPath(data, value.path, scopePath);
    return (resolved as T) ?? defaultValue;
  }

  return value as T;
}

/**
 * 收集表单数据
 */
export function collectFormData(
  components: A2UIResponse["components"],
  data: Record<string, unknown>,
): Record<string, unknown> {
  const formData: Record<string, unknown> = {};

  for (const component of components) {
    // 只收集表单组件的值
    if ("value" in component) {
      const value = resolveDynamicValue(
        (component as { value?: unknown }).value,
        data,
        undefined,
      );
      if (value !== undefined) {
        formData[component.id] = value;
      }
    }
  }

  return formData;
}
