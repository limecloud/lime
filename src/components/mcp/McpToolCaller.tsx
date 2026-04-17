/**
 * MCP 工具调用组件
 *
 * 基于 JSON Schema 生成参数输入表单，执行工具调用并展示结果。
 *
 * @module components/mcp/McpToolCaller
 */

import { useState } from "react";
import { Play, X, AlertCircle, CheckCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  getMcpInnerToolName,
  McpToolDefinition,
  McpToolResult,
  McpContent,
} from "@/lib/api/mcp";

interface McpToolCallerProps {
  tool: McpToolDefinition;
  onCallTool: (
    toolName: string,
    args: Record<string, unknown>,
  ) => Promise<McpToolResult>;
  onClose: () => void;
}

/** 从 JSON Schema 提取参数字段 */
function extractFields(
  schema: Record<string, unknown>,
): { name: string; type: string; description: string; required: boolean }[] {
  const properties = (schema.properties || {}) as Record<
    string,
    Record<string, unknown>
  >;
  const required = (schema.required || []) as string[];
  return Object.entries(properties).map(([name, prop]) => ({
    name,
    type: (prop.type as string) || "string",
    description: (prop.description as string) || "",
    required: required.includes(name),
  }));
}

/** 渲染 MCP 内容 */
function renderContent(content: McpContent) {
  if (content.type === "text") {
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-all">
        {content.text}
      </pre>
    );
  }
  if (content.type === "image") {
    return (
      <img
        src={`data:${content.mime_type};base64,${content.data}`}
        alt="工具返回图片"
        className="max-w-full rounded"
      />
    );
  }
  if (content.type === "resource") {
    return (
      <div className="text-xs">
        <span className="font-mono text-muted-foreground">{content.uri}</span>
        {content.text && (
          <pre className="mt-1 whitespace-pre-wrap break-all">
            {content.text}
          </pre>
        )}
      </div>
    );
  }
  return null;
}

export function McpToolCaller({
  tool,
  onCallTool,
  onClose,
}: McpToolCallerProps) {
  const displayName = getMcpInnerToolName(tool.name, tool.server_name);
  const fields = extractFields(tool.input_schema);
  const [args, setArgs] = useState<Record<string, string>>({});
  const [jsonMode, setJsonMode] = useState(false);
  const [jsonInput, setJsonInput] = useState("{}");
  const [result, setResult] = useState<McpToolResult | null>(null);
  const [calling, setCalling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCall = async () => {
    setCalling(true);
    setError(null);
    setResult(null);
    try {
      let callArgs: Record<string, unknown>;
      if (jsonMode) {
        callArgs = JSON.parse(jsonInput);
      } else {
        callArgs = {};
        fields.forEach((field) => {
          const val = args[field.name];
          if (val !== undefined && val !== "") {
            // 尝试解析为 JSON 值（支持数字、布尔等）
            try {
              callArgs[field.name] = JSON.parse(val);
            } catch {
              callArgs[field.name] = val;
            }
          }
        });
      }
      const res = await onCallTool(tool.name, callArgs);
      setResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="border rounded-lg bg-background">
      {/* 标题 */}
      <div className="p-3 border-b flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Play className="h-4 w-4 text-sky-600 dark:text-sky-400" />
          <span className="font-mono text-sm font-medium" title={tool.name}>
            {displayName}
          </span>
          <span className="text-xs text-muted-foreground">
            ({tool.server_name})
          </span>
        </div>
        <button onClick={onClose} className="p-1 rounded hover:bg-muted">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {tool.description && (
          <p className="text-xs text-muted-foreground">{tool.description}</p>
        )}

        {/* 模式切换 */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setJsonMode(false)}
            className={cn(
              "rounded border px-2 py-1 text-xs transition-colors",
              !jsonMode
                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            表单模式
          </button>
          <button
            onClick={() => setJsonMode(true)}
            className={cn(
              "rounded border px-2 py-1 text-xs transition-colors",
              jsonMode
                ? "border-emerald-200 bg-emerald-100 text-emerald-700"
                : "border-border bg-muted text-muted-foreground hover:bg-muted/80",
            )}
          >
            JSON 模式
          </button>
        </div>

        {/* 参数输入 */}
        {jsonMode ? (
          <textarea
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
            className="w-full h-32 px-3 py-2 rounded border bg-muted/50 font-mono text-sm resize-none focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
            placeholder='{"key": "value"}'
          />
        ) : fields.length > 0 ? (
          <div className="space-y-2">
            {fields.map((field) => (
              <div key={field.name}>
                <label className="block text-xs font-medium text-muted-foreground mb-1">
                  {field.name}
                  {field.required && (
                    <span className="text-destructive ml-0.5">*</span>
                  )}
                  <span className="font-normal text-muted-foreground/70 ml-1">
                    ({field.type})
                  </span>
                  {field.description && (
                    <span className="font-normal ml-1">
                      {field.description}
                    </span>
                  )}
                </label>
                <input
                  type="text"
                  value={args[field.name] || ""}
                  onChange={(e) =>
                    setArgs((prev) => ({
                      ...prev,
                      [field.name]: e.target.value,
                    }))
                  }
                  className="w-full px-2.5 py-1.5 rounded border bg-background text-sm focus:ring-2 focus:ring-primary/20 focus:border-primary outline-none"
                  placeholder={field.description || `输入 ${field.name}`}
                />
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">此工具无需参数</p>
        )}

        {/* 调用按钮 */}
        <button
          onClick={handleCall}
          disabled={calling}
          className="rounded border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-3 py-1.5 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95 disabled:opacity-50"
        >
          {calling ? "调用中..." : "调用工具"}
        </button>

        {/* 错误 */}
        {error && (
          <div className="flex items-start gap-2 p-2 rounded bg-destructive/10 text-destructive text-xs">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* 结果 */}
        {result && (
          <div
            className={cn(
              "rounded-lg border p-3 space-y-2",
              result.is_error
                ? "border-destructive/30 bg-destructive/5"
                : "border-green-500/30 bg-green-500/5",
            )}
          >
            <div className="flex items-center gap-2">
              {result.is_error ? (
                <AlertCircle className="h-4 w-4 text-destructive" />
              ) : (
                <CheckCircle className="h-4 w-4 text-green-600" />
              )}
              <span className="text-xs font-medium">
                {result.is_error ? "调用失败" : "调用成功"}
              </span>
            </div>
            <div className="space-y-1">
              {result.content.map((c, i) => (
                <div key={i} className="bg-background p-2 rounded border">
                  {renderContent(c)}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
