/**
 * Claude OAuth 凭证添加表单
 * 支持三种模式：
 * 1. OAuth 登录 - 通过授权 URL 手动复制授权码
 * 2. Cookie 授权 - 使用 sessionKey 自动完成 OAuth 流程
 * 3. 文件导入 - 导入已有的凭证文件
 */

import { useState, useEffect } from "react";
import { onClaudeOAuthAuthUrl } from "@/lib/api/providerAuthEvents";
import { Cookie, Key, FileJson } from "lucide-react";
import { providerPoolApi } from "@/lib/api/providerPool";
import { FileImportForm } from "./FileImportForm";
import { OAuthUrlDisplay } from "./OAuthUrlDisplay";

interface ClaudeOAuthFormProps {
  name: string;
  credsFilePath: string;
  setCredsFilePath: (path: string) => void;
  onSelectFile: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
}

type AuthMode = "login" | "cookie" | "file";

export function ClaudeOAuthForm({
  name,
  credsFilePath,
  setCredsFilePath,
  onSelectFile,
  loading: _loading,
  setLoading,
  setError,
  onSuccess,
}: ClaudeOAuthFormProps) {
  const [mode, setMode] = useState<AuthMode>("cookie");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [waitingForCallback, setWaitingForCallback] = useState(false);
  const [sessionKey, setSessionKey] = useState("");
  const [isSetupToken, setIsSetupToken] = useState(false);

  // 监听后端发送的授权 URL 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await onClaudeOAuthAuthUrl((payload) => {
        setAuthUrl(payload.auth_url);
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 获取授权 URL 并启动服务器等待回调
  const handleGetAuthUrl = async () => {
    setLoading(true);
    setError(null);
    setAuthUrl(null);
    setWaitingForCallback(true);

    try {
      const trimmedName = name.trim() || undefined;
      await providerPoolApi.getClaudeOAuthAuthUrlAndWait(trimmedName);
      onSuccess();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      setWaitingForCallback(false);
    } finally {
      setLoading(false);
    }
  };

  // Cookie 自动授权
  const handleCookieSubmit = async () => {
    if (!sessionKey.trim()) {
      setError("请输入 sessionKey");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const trimmedName = name.trim() || undefined;
      await providerPoolApi.claudeOAuthWithCookie(
        sessionKey.trim(),
        isSetupToken,
        trimmedName,
      );
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
      await providerPoolApi.addClaudeOAuth(credsFilePath, trimmedName);
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  // 模式选择器
  const renderModeSelector = () => (
    <div className="flex gap-2">
      <button
        type="button"
        onClick={() => setMode("cookie")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          mode === "cookie"
            ? "border-amber-500 bg-amber-50 text-amber-700"
            : "hover:bg-muted"
        }`}
      >
        <Cookie className="h-4 w-4" />
        Cookie 授权
      </button>
      <button
        type="button"
        onClick={() => setMode("login")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          mode === "login"
            ? "border-amber-500 bg-amber-50 text-amber-700"
            : "hover:bg-muted"
        }`}
      >
        <Key className="h-4 w-4" />
        OAuth 登录
      </button>
      <button
        type="button"
        onClick={() => setMode("file")}
        className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
          mode === "file"
            ? "border-amber-500 bg-amber-50 text-amber-700"
            : "hover:bg-muted"
        }`}
      >
        <FileJson className="h-4 w-4" />
        导入文件
      </button>
    </div>
  );

  // Cookie 授权表单
  const renderCookieForm = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-700">
          使用浏览器 Cookie 中的 sessionKey 自动完成 OAuth
          授权，无需手动复制授权码。
        </p>
        <p className="mt-2 text-xs text-amber-600">
          获取方式：在 claude.ai 登录后，打开开发者工具 → Application → Cookies
          → 复制 sessionKey 的值
        </p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium">
          sessionKey <span className="text-red-500">*</span>
        </label>
        <textarea
          value={sessionKey}
          onChange={(e) => setSessionKey(e.target.value)}
          placeholder="粘贴从浏览器 Cookie 中获取的 sessionKey..."
          className="w-full rounded-lg border bg-background px-3 py-2 text-sm font-mono"
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="isSetupToken"
          checked={isSetupToken}
          onChange={(e) => setIsSetupToken(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300"
        />
        <label htmlFor="isSetupToken" className="text-sm text-muted-foreground">
          Setup Token 模式（只需推理权限，无 refresh_token）
        </label>
      </div>
    </div>
  );

  // OAuth 登录表单
  const renderLoginForm = () => (
    <div className="space-y-4">
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
        <p className="text-sm text-amber-700">
          点击下方按钮获取授权 URL，然后复制到浏览器（支持指纹浏览器）完成
          Claude 登录。
        </p>
        <p className="mt-2 text-xs text-amber-600">
          授权成功后，从页面复制授权码粘贴回应用。
        </p>
      </div>

      <OAuthUrlDisplay
        authUrl={authUrl}
        waitingForCallback={waitingForCallback}
        colorScheme="amber"
      />
    </div>
  );

  return {
    mode,
    authUrl,
    waitingForCallback,
    handleGetAuthUrl,
    handleFileSubmit,
    handleCookieSubmit,
    render: () => (
      <>
        {renderModeSelector()}

        <div className="mt-4">
          {mode === "cookie" && renderCookieForm()}
          {mode === "login" && renderLoginForm()}
          {mode === "file" && (
            <FileImportForm
              credsFilePath={credsFilePath}
              setCredsFilePath={setCredsFilePath}
              onSelectFile={onSelectFile}
              placeholder="选择 oauth.json 或 oauth_creds.json..."
              hint="默认路径: ~/.claude/oauth.json 或 Claude CLI 的凭证文件"
            />
          )}
        </div>
      </>
    ),
  };
}
