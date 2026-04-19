/**
 * Kiro 凭证添加表单
 *
 * 支持两种模式：
 * 1. 粘贴 JSON（直接粘贴凭证内容）
 * 2. 导入文件
 *
 * @module components/provider-pool/credential-forms/KiroForm
 */

import { useState } from "react";
import { providerPoolApi } from "@/lib/api/providerPool";
import { FileImportForm } from "./FileImportForm";
import { FileText, FolderOpen } from "lucide-react";

interface KiroFormProps {
  name: string;
  credsFilePath: string;
  setCredsFilePath: (path: string) => void;
  onSelectFile: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
}

type KiroMode = "json" | "file";

export function KiroForm({
  name,
  credsFilePath,
  setCredsFilePath,
  onSelectFile,
  loading: _loading,
  setLoading,
  setError,
  onSuccess,
}: KiroFormProps) {
  const [mode, setMode] = useState<KiroMode>("json");
  const [jsonContent, setJsonContent] = useState("");

  // JSON 粘贴提交
  const handleJsonSubmit = async () => {
    if (!jsonContent.trim()) {
      setError("请粘贴凭证 JSON 内容");
      return;
    }

    // 验证 JSON 格式
    try {
      JSON.parse(jsonContent);
    } catch {
      setError("JSON 格式无效，请检查内容");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trimmedName = name.trim() || undefined;
      await providerPoolApi.addKiroFromJson(jsonContent, trimmedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 文件导入提交
  const handleFileSubmit = async () => {
    if (!credsFilePath) {
      setError("请选择凭证文件");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trimmedName = name.trim() || undefined;
      await providerPoolApi.addKiroOAuth(credsFilePath, trimmedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 模式选择器
  const renderModeSelector = () => (
    <div className="grid grid-cols-2 gap-1 p-1 bg-muted/50 rounded-xl border mb-4">
      <button
        type="button"
        onClick={() => {
          setMode("json");
          setError(null);
        }}
        className={`py-2 px-3 text-sm rounded-lg transition-all duration-200 font-medium ${
          mode === "json"
            ? "bg-background text-foreground shadow-sm ring-1 ring-black/5"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        }`}
      >
        <FileText className="inline h-4 w-4 mr-1" />
        粘贴 JSON
      </button>
      <button
        type="button"
        onClick={() => {
          setMode("file");
          setError(null);
        }}
        className={`py-2 px-3 text-sm rounded-lg transition-all duration-200 font-medium ${
          mode === "file"
            ? "bg-background text-foreground shadow-sm ring-1 ring-black/5"
            : "text-muted-foreground hover:text-foreground hover:bg-background/50"
        }`}
      >
        <FolderOpen className="inline h-4 w-4 mr-1" />
        导入文件
      </button>
    </div>
  );

  // JSON 粘贴表单
  const renderJsonForm = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
        <p className="text-sm text-emerald-700">
          直接粘贴 Kiro 凭证 JSON 内容，无需选择文件。
        </p>
        <p className="mt-2 text-xs text-emerald-600">
          凭证 JSON 通常包含 accessToken、refreshToken 等字段。
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          凭证 JSON <span className="text-red-500">*</span>
        </label>
        <textarea
          value={jsonContent}
          onChange={(e) => setJsonContent(e.target.value)}
          placeholder={`粘贴凭证 JSON 内容，例如：
{
  "accessToken": "...",
  "refreshToken": "...",
  "region": "us-east-1",
  ...
}`}
          className="w-full h-48 rounded-lg border bg-background px-3 py-2 text-sm font-mono resize-none"
        />
      </div>
    </div>
  );

  return {
    mode,
    handleJsonSubmit,
    handleFileSubmit,
    handleLoginSubmit: () => {}, // 保持接口兼容
    render: () => (
      <>
        {renderModeSelector()}

        {mode === "json" && renderJsonForm()}
        {mode === "file" && (
          <FileImportForm
            credsFilePath={credsFilePath}
            setCredsFilePath={setCredsFilePath}
            onSelectFile={onSelectFile}
            placeholder="选择 kiro-auth-token.json..."
            hint="默认路径: ~/.aws/sso/cache/kiro-auth-token.json"
          />
        )}
      </>
    ),
  };
}
