/**
 * @file Artifact 解析器
 * @description 从 AI 响应中提取 Artifact，支持流式解析和增量更新
 * @module lib/artifact/parser
 * @requirements 2.1, 2.2, 2.4, 2.6
 */

import type { Artifact, ArtifactMeta, ArtifactType } from "./types";
import { normalizeArtifactType } from "./types";

/**
 * 解析结果接口
 */
export interface ParseResult {
  /** 提取的 Artifact 列表 */
  artifacts: Artifact[];
  /** 去除 Artifact 后的纯文本 */
  plainText: string;
  /** 解析是否完成 */
  isComplete: boolean;
}

/**
 * 解析器配置接口
 */
export interface ParserConfig {
  /** 是否启用自动语言检测 */
  autoDetectLanguage?: boolean;
  /** 是否将普通代码块识别为 artifact */
  treatCodeBlockAsArtifact?: boolean;
}

/**
 * Fence 状态接口（内部使用）
 */
interface FenceState {
  id: string;
  type: ArtifactType;
  title: string;
  meta: ArtifactMeta;
  contentStart: number;
  content: string;
  fenceStart: number;
}

/**
 * 解析错误类型
 */
export type ParseErrorType =
  | "MALFORMED_FENCE"
  | "INVALID_TYPE"
  | "MISSING_CONTENT"
  | "UNCLOSED_FENCE";

/**
 * 解析错误接口
 */
export interface ParseError {
  type: ParseErrorType;
  message: string;
  position: { start: number; end: number };
  rawContent: string;
}

/**
 * 生成唯一 ID
 */
function generateId(): string {
  return crypto.randomUUID();
}

/**
 * 语言到 Artifact 类型的映射
 * 只有需要特殊渲染器的类型才映射，其他都作为 code 类型处理
 * HTML 等代码类型使用 CodeRenderer 渲染（带语法高亮）
 */
const LANGUAGE_TO_TYPE: Record<string, ArtifactType> = {
  md: "document",
  markdown: "document",
  txt: "document",
  svg: "svg", // SVG 需要图形渲染
  mermaid: "mermaid", // Mermaid 需要图表渲染
  jsx: "react", // React 组件需要实时预览
  tsx: "react",
};

/**
 * 从语言推断 Artifact 类型
 * 大部分语言（包括 HTML）都作为 code 类型，使用 CodeRenderer 渲染
 */
function inferTypeFromLanguage(language: string): ArtifactType {
  const normalizedLang = language.toLowerCase().trim();
  return LANGUAGE_TO_TYPE[normalizedLang] || "code";
}

/**
 * 解析 artifact fence 的属性
 * 支持格式: ```artifact type="code" language="typescript" title="示例"
 */
function parseArtifactAttributes(line: string): {
  type: ArtifactType;
  title: string;
  meta: ArtifactMeta;
} | null {
  // 匹配 ```artifact 开头
  const artifactMatch = line.match(/^```artifact\s*(.*)/i);
  if (!artifactMatch) return null;

  const attrString = artifactMatch[1];
  const meta: ArtifactMeta = {};
  let type: ArtifactType = "code";
  let title = "";

  // 解析属性: key="value" 或 key='value'
  const attrRegex = /(\w+)\s*=\s*["']([^"']*)["']/g;
  let match: RegExpExecArray | null;

  while ((match = attrRegex.exec(attrString)) !== null) {
    const [, key, value] = match;
    const normalizedKey = key.toLowerCase();

    switch (normalizedKey) {
      case "type": {
        const normalizedType = normalizeArtifactType(value);
        if (normalizedType) {
          type = normalizedType;
        }
        break;
      }
      case "language":
        meta.language = value;
        break;
      case "title":
        title = value;
        break;
      case "filename":
        meta.filename = value;
        break;
      default:
        // 其他属性存入 meta
        meta[normalizedKey] = value;
    }
  }

  return { type, title, meta };
}

/**
 * 解析标准 code fence
 * 支持格式: ```typescript 或 ```js 或 ```html
 */
function parseCodeFence(line: string): {
  language: string;
} | null {
  // 匹配 ``` 后跟语言标识符（支持行末有空格或其他字符）
  const match = line.match(/^```(\w+)?/);
  if (!match) return null;

  // 确保不是 artifact fence
  if (line.toLowerCase().includes("artifact")) return null;

  return {
    language: match[1] || "",
  };
}

/**
 * 检查是否为 fence 结束标记
 */
function isFenceEnd(line: string): boolean {
  return /^```\s*$/.test(line);
}

/**
 * Artifact 解析器类
 * 支持流式解析和增量更新
 *
 * @requirements 2.1, 2.2, 2.3, 2.4, 2.6
 */
export class ArtifactParser {
  private config: ParserConfig;
  private buffer: string = "";
  private artifacts: Map<string, Artifact> = new Map();
  private currentFence: FenceState | null = null;
  private processedLength: number = 0;
  private plainTextParts: string[] = [];

  constructor(config?: ParserConfig) {
    this.config = {
      autoDetectLanguage: true,
      treatCodeBlockAsArtifact: true,
      ...config,
    };
  }

  /**
   * 追加内容（流式解析）
   * @param chunk - 新增的文本块
   * @returns 当前解析结果
   */
  append(chunk: string): ParseResult {
    this.buffer += chunk;
    this.parseBuffer(false);
    return this.getResult(false);
  }

  /**
   * 完成解析
   * @returns 最终解析结果
   */
  finalize(): ParseResult {
    this.parseBuffer(true);
    return this.getResult(true);
  }

  /**
   * 重置解析器状态
   */
  reset(): void {
    this.buffer = "";
    this.artifacts.clear();
    this.currentFence = null;
    this.processedLength = 0;
    this.plainTextParts = [];
  }

  /**
   * 解析缓冲区内容
   */
  private parseBuffer(isFinal: boolean): void {
    const lines = this.buffer.split("\n");
    const lastLineIndex = lines.length - 1;

    // 如果不是最终解析，保留最后一行（可能不完整）
    const linesToProcess = isFinal ? lines : lines.slice(0, lastLineIndex);
    let currentPosition = 0;

    for (let i = 0; i < linesToProcess.length; i++) {
      const line = linesToProcess[i];
      const lineStart = currentPosition;
      const lineEnd = currentPosition + line.length;

      if (this.currentFence) {
        // 当前在 fence 内部
        if (isFenceEnd(line)) {
          // fence 结束
          this.finalizeFence(lineEnd);
        } else {
          // 继续累积内容
          if (this.currentFence.content) {
            this.currentFence.content += "\n" + line;
          } else {
            this.currentFence.content = line;
          }
        }
      } else {
        // 尝试匹配 fence 开始
        const artifactAttrs = parseArtifactAttributes(line);
        if (artifactAttrs) {
          // artifact fence 开始
          this.startFence(artifactAttrs, lineStart, lineEnd + 1);
        } else {
          const codeFence = parseCodeFence(line);
          if (codeFence && this.config.treatCodeBlockAsArtifact) {
            // 标准 code fence 开始
            const type = this.config.autoDetectLanguage
              ? inferTypeFromLanguage(codeFence.language)
              : "code";
            this.startFence(
              {
                type,
                title: codeFence.language || "Code",
                meta: { language: codeFence.language },
              },
              lineStart,
              lineEnd + 1,
            );
          } else if (!codeFence) {
            // 普通文本
            this.plainTextParts.push(line);
          }
        }
      }

      // 更新位置（+1 是换行符）
      currentPosition = lineEnd + 1;
    }

    // 更新缓冲区，保留未处理的部分
    if (!isFinal && lastLineIndex >= 0) {
      this.buffer = lines[lastLineIndex];
    } else {
      this.buffer = "";
    }
  }

  /**
   * 开始一个新的 fence
   */
  private startFence(
    attrs: { type: ArtifactType; title: string; meta: ArtifactMeta },
    fenceStart: number,
    contentStart: number,
  ): void {
    const id = generateId();
    this.currentFence = {
      id,
      type: attrs.type,
      title: attrs.title || this.generateTitle(attrs.type, attrs.meta),
      meta: attrs.meta,
      fenceStart,
      contentStart,
      content: "",
    };

    // 创建初始 artifact（streaming 状态）
    const now = Date.now();
    this.artifacts.set(id, {
      id,
      type: attrs.type,
      title: this.currentFence.title,
      content: "",
      status: "streaming",
      meta: attrs.meta,
      position: { start: fenceStart, end: contentStart },
      createdAt: now,
      updatedAt: now,
    });
  }

  /**
   * 完成当前 fence
   */
  private finalizeFence(endPosition: number): void {
    if (!this.currentFence) return;

    const artifact = this.artifacts.get(this.currentFence.id);
    if (artifact) {
      artifact.content = this.currentFence.content;
      artifact.status = "complete";
      artifact.position.end = endPosition;
      artifact.updatedAt = Date.now();
    }

    this.currentFence = null;
  }

  /**
   * 生成默认标题
   */
  private generateTitle(type: ArtifactType, meta: ArtifactMeta): string {
    if (meta.filename) return meta.filename;
    if (meta.language) return meta.language;

    const typeNames: Record<ArtifactType, string> = {
      document: "Document",
      code: "Code",
      html: "HTML",
      svg: "SVG",
      mermaid: "Diagram",
      react: "React Component",
      browser_assist: "Browser Assist",
      "canvas:document": "Document",
      "canvas:video": "Video",
    };

    return typeNames[type] || "Artifact";
  }

  /**
   * 获取当前解析结果
   */
  private getResult(isComplete: boolean): ParseResult {
    // 如果有未完成的 fence，更新其内容
    if (this.currentFence) {
      const artifact = this.artifacts.get(this.currentFence.id);
      if (artifact) {
        artifact.content = this.currentFence.content;
        artifact.updatedAt = Date.now();
      }
    }

    return {
      artifacts: Array.from(this.artifacts.values()),
      plainText: this.plainTextParts.join("\n"),
      isComplete: isComplete && !this.currentFence,
    };
  }

  /**
   * 静态方法：解析完整文本
   * @param text - 要解析的完整文本
   * @param config - 解析器配置
   * @returns 解析结果
   */
  static parse(text: string, config?: ParserConfig): ParseResult {
    const parser = new ArtifactParser(config);
    parser.append(text);
    return parser.finalize();
  }
}

/**
 * 将 Artifact 序列化为 artifact fence 格式
 * 用于往返测试
 */
export function serializeArtifact(artifact: Artifact): string {
  const attrs: string[] = [`type="${artifact.type}"`];

  if (artifact.meta.language) {
    attrs.push(`language="${artifact.meta.language}"`);
  }
  if (artifact.title) {
    attrs.push(`title="${artifact.title}"`);
  }
  if (artifact.meta.filename) {
    attrs.push(`filename="${artifact.meta.filename}"`);
  }

  return `\`\`\`artifact ${attrs.join(" ")}\n${artifact.content}\n\`\`\``;
}

/**
 * 比较两个 Artifact 的内容是否等价
 * 用于测试
 */
export function artifactContentEqual(a: Artifact, b: Artifact): boolean {
  return (
    a.type === b.type &&
    a.content === b.content &&
    a.meta.language === b.meta.language
  );
}

/**
 * 比较两个 Artifact 数组是否等价
 * 用于测试
 */
export function artifactsEqual(a: Artifact[], b: Artifact[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((artifact, index) => artifactContentEqual(artifact, b[index]));
}
