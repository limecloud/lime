/**
 * 添加凭证模态框
 * 根据 Provider 类型显示不同的表单
 */

import { useState } from "react";
import { Key, FolderOpen } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import { Modal } from "@/components/Modal";
import { providerPoolApi, PoolProviderType } from "@/lib/api/providerPool";
import { AntigravityForm } from "./credential-forms/AntigravityForm";
import { CodexForm } from "./credential-forms/CodexForm";
import { ClaudeOAuthForm } from "./credential-forms/ClaudeOAuthForm";
import { GeminiForm } from "./credential-forms/GeminiForm";
import { KiroForm } from "./credential-forms/KiroForm";
import { defaultCredsPath, providerLabels } from "./credential-forms/types";

interface AddCredentialModalProps {
  providerType: PoolProviderType;
  onClose: () => void;
  onSuccess: () => void;
}

export function AddCredentialModal({
  providerType,
  onClose,
  onSuccess,
}: AddCredentialModalProps) {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // OAuth 字段
  const [credsFilePath, setCredsFilePath] = useState(
    defaultCredsPath[providerType] || "",
  );
  const [projectId, setProjectId] = useState("");
  const [apiBaseUrl, setApiBaseUrl] = useState("");

  // API Key 字段
  const [apiKey, setApiKey] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [excludedModels, setExcludedModels] = useState<string[]>([]);

  // 判断是否为 OAuth 类型（不包括有特殊表单的 antigravity、codex、claude_oauth、qwen、iflow、gemini、kiro）
  const isSimpleOAuth: string[] = []; // Kiro 现在有自己的表单
  const isApiKey = ["openai", "claude", "gemini_api_key"].includes(
    providerType,
  );
  const primaryActionButtonClassName =
    "rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95 disabled:opacity-50";

  const handleSelectFile = async () => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (selected) {
        setCredsFilePath(selected as string);
      }
    } catch (e) {
      console.error("Failed to open file dialog:", e);
    }
  };

  // Antigravity 表单
  const antigravityForm = AntigravityForm({
    name,
    credsFilePath,
    setCredsFilePath,
    projectId,
    setProjectId,
    onSelectFile: handleSelectFile,
    loading,
    setLoading,
    setError,
    onSuccess,
  });

  // Codex 表单
  const codexForm = CodexForm({
    name,
    credsFilePath,
    setCredsFilePath,
    apiBaseUrl,
    setApiBaseUrl,
    onSelectFile: handleSelectFile,
    loading,
    setLoading,
    setError,
    onSuccess,
  });

  // Claude OAuth 表单
  const claudeOAuthForm = ClaudeOAuthForm({
    name,
    credsFilePath,
    setCredsFilePath,
    onSelectFile: handleSelectFile,
    loading,
    setLoading,
    setError,
    onSuccess,
  });

  // Gemini 表单
  const geminiForm = GeminiForm({
    name,
    credsFilePath,
    setCredsFilePath,
    projectId,
    setProjectId,
    onSelectFile: handleSelectFile,
    loading,
    setLoading,
    setError,
    onSuccess,
  });

  // Kiro 表单
  const kiroForm = KiroForm({
    name,
    credsFilePath,
    setCredsFilePath,
    onSelectFile: handleSelectFile,
    loading,
    setLoading,
    setError,
    onSuccess,
  });

  // 简单 OAuth 和 API Key 的提交处理
  const handleSubmit = async () => {
    setLoading(true);
    setError(null);

    try {
      const trimmedName = name.trim() || undefined;

      if (isSimpleOAuth.includes(providerType)) {
        if (!credsFilePath) {
          setError("请选择凭证文件");
          setLoading(false);
          return;
        }

        switch (providerType) {
          case "gemini":
            await providerPoolApi.addGeminiOAuth(
              credsFilePath,
              projectId.trim() || undefined,
              trimmedName,
            );
            break;
        }
      } else if (isApiKey) {
        if (!apiKey) {
          setError("请输入 API Key");
          setLoading(false);
          return;
        }

        switch (providerType) {
          case "openai":
            await providerPoolApi.addOpenAIKey(
              apiKey,
              baseUrl.trim() || undefined,
              trimmedName,
            );
            break;
          case "claude":
            await providerPoolApi.addClaudeKey(
              apiKey,
              baseUrl.trim() || undefined,
              trimmedName,
            );
            break;
          case "gemini_api_key":
            await providerPoolApi.addGeminiApiKey(
              apiKey,
              baseUrl.trim() || undefined,
              excludedModels.length > 0 ? excludedModels : undefined,
              trimmedName,
            );
            break;
        }
      }

      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 渲染简单 OAuth 表单
  const renderSimpleOAuthForm = () => (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium">
          凭证文件路径 <span className="text-red-500">*</span>
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={credsFilePath}
            onChange={(e) => setCredsFilePath(e.target.value)}
            placeholder="输入凭证文件的完整路径..."
            className="flex-1 rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={handleSelectFile}
            className="flex items-center gap-1 rounded-lg border px-3 py-2 text-sm hover:bg-muted"
          >
            <FolderOpen className="h-4 w-4" />
            浏览
          </button>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {providerType === "gemini" && "默认路径: ~/.gemini/oauth_creds.json"}
        </p>
      </div>

      {providerType === "gemini" && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            Project ID (可选)
          </label>
          <input
            type="text"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            placeholder="Google Cloud Project ID..."
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
        </div>
      )}
    </>
  );

  // 渲染 API Key 表单
  const renderApiKeyForm = () => (
    <>
      <div>
        <label className="mb-1 block text-sm font-medium">
          API Key <span className="text-red-500">*</span>
        </label>
        <div className="relative">
          <Key className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-..."
            className="w-full rounded-lg border bg-background pl-10 pr-3 py-2 text-sm"
          />
        </div>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          Base URL (可选)
        </label>
        <input
          type="text"
          value={baseUrl}
          onChange={(e) => setBaseUrl(e.target.value)}
          placeholder={
            providerType === "openai"
              ? "https://api.openai.com/v1"
              : providerType === "claude"
                ? "https://api.anthropic.com/v1"
                : "https://generativelanguage.googleapis.com"
          }
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
        />
        <p className="mt-1 text-xs text-muted-foreground">
          留空使用默认 URL，或输入自定义代理地址
        </p>
      </div>

      {providerType === "gemini_api_key" && (
        <div>
          <label className="mb-1 block text-sm font-medium">
            排除模型 (可选)
          </label>
          <input
            type="text"
            value={excludedModels.join(", ")}
            onChange={(e) =>
              setExcludedModels(
                e.target.value
                  .split(",")
                  .map((s) => s.trim())
                  .filter((s) => s),
              )
            }
            placeholder="gemini-1.5-pro, gemini-1.5-flash..."
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            用逗号分隔多个模型名称，支持通配符（如 *-preview）
          </p>
        </div>
      )}
    </>
  );

  // 渲染底部按钮
  const renderFooterButton = () => {
    // Antigravity 登录模式
    if (providerType === "antigravity" && antigravityForm.mode === "login") {
      if (!antigravityForm.authUrl) {
        return (
          <button
            onClick={antigravityForm.handleGetAuthUrl}
            disabled={loading}
            className={primaryActionButtonClassName}
          >
            {loading ? "获取中..." : "获取授权 URL"}
          </button>
        );
      }
      return null;
    }

    // Antigravity 文件模式
    if (providerType === "antigravity" && antigravityForm.mode === "file") {
      return (
        <button
          onClick={antigravityForm.handleFileSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // Codex 登录模式
    if (providerType === "codex" && codexForm.mode === "login") {
      if (!codexForm.authUrl) {
        return (
          <button
            onClick={codexForm.handleGetAuthUrl}
            disabled={loading}
            className={primaryActionButtonClassName}
          >
            {loading ? "获取中..." : "获取授权 URL"}
          </button>
        );
      }
      return null;
    }

    // Codex 文件模式
    if (providerType === "codex" && codexForm.mode === "file") {
      return (
        <button
          onClick={codexForm.handleFileSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // Claude OAuth Cookie 模式
    if (providerType === "claude_oauth" && claudeOAuthForm.mode === "cookie") {
      return (
        <button
          onClick={claudeOAuthForm.handleCookieSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "授权中..." : "Cookie 授权"}
        </button>
      );
    }

    // Claude OAuth 登录模式
    if (providerType === "claude_oauth" && claudeOAuthForm.mode === "login") {
      if (!claudeOAuthForm.authUrl) {
        return (
          <button
            onClick={claudeOAuthForm.handleGetAuthUrl}
            disabled={loading}
            className={primaryActionButtonClassName}
          >
            {loading ? "获取中..." : "获取授权 URL"}
          </button>
        );
      }
      return null;
    }

    // Claude OAuth 文件模式
    if (providerType === "claude_oauth" && claudeOAuthForm.mode === "file") {
      return (
        <button
          onClick={claudeOAuthForm.handleFileSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // Gemini 登录模式
    if (providerType === "gemini" && geminiForm.mode === "login") {
      if (!geminiForm.authUrl) {
        return (
          <button
            onClick={geminiForm.handleGetAuthUrl}
            disabled={loading}
            className={primaryActionButtonClassName}
          >
            {loading ? "获取中..." : "获取授权 URL"}
          </button>
        );
      }
      return null;
    }

    // Gemini 文件模式
    if (providerType === "gemini" && geminiForm.mode === "file") {
      return (
        <button
          onClick={geminiForm.handleFileSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // Kiro JSON 模式
    if (providerType === "kiro" && kiroForm.mode === "json") {
      return (
        <button
          onClick={kiroForm.handleJsonSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // Kiro 文件模式
    if (providerType === "kiro" && kiroForm.mode === "file") {
      return (
        <button
          onClick={kiroForm.handleFileSubmit}
          disabled={loading}
          className={primaryActionButtonClassName}
        >
          {loading ? "添加中..." : "添加凭证"}
        </button>
      );
    }

    // 其他类型
    return (
      <button
        onClick={handleSubmit}
        disabled={loading}
        className={primaryActionButtonClassName}
      >
        {loading ? "添加中..." : "添加凭证"}
      </button>
    );
  };

  return (
    <Modal isOpen={true} onClose={onClose} maxWidth="max-w-md">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-6 py-4">
        <h3 className="text-lg font-semibold">
          添加 {providerLabels[providerType]} 凭证
        </h3>
      </div>

      {/* Content */}
      <div className="space-y-4 px-6 py-4">
        {/* 名称字段 */}
        <div>
          <label className="mb-1 block text-sm font-medium">名称 (可选)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="给这个凭证起个名字..."
            className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
          />
        </div>

        {/* 根据类型渲染不同表单 */}
        {providerType === "antigravity" && antigravityForm.render()}
        {providerType === "codex" && codexForm.render()}
        {providerType === "claude_oauth" && claudeOAuthForm.render()}
        {providerType === "gemini" && geminiForm.render()}
        {providerType === "kiro" && kiroForm.render()}
        {isSimpleOAuth.includes(providerType) && renderSimpleOAuthForm()}
        {isApiKey && renderApiKeyForm()}

        {/* 错误提示 */}
        {error && (
          <div className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="flex justify-end gap-2 border-t px-6 py-4">
        <button
          onClick={onClose}
          className="rounded-lg border px-4 py-2 text-sm hover:bg-muted"
        >
          取消
        </button>
        {renderFooterButton()}
      </div>
    </Modal>
  );
}
