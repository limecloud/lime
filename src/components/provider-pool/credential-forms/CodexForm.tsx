/**
 * Codex 凭证添加表单
 * 支持 OpenAI OAuth 登录和文件导入两种模式
 */

import { useState, useEffect } from "react";
import { onCodexAuthUrl } from "@/lib/api/providerAuthEvents";
import { providerPoolApi } from "@/lib/api/providerPool";
import { ModeSelector } from "./ModeSelector";
import { FileImportForm } from "./FileImportForm";
import { OAuthUrlDisplay } from "./OAuthUrlDisplay";

interface CodexFormProps {
  name: string;
  credsFilePath: string;
  setCredsFilePath: (path: string) => void;
  apiBaseUrl: string;
  setApiBaseUrl: (url: string) => void;
  onSelectFile: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
}

export function CodexForm({
  name,
  credsFilePath,
  setCredsFilePath,
  apiBaseUrl,
  setApiBaseUrl,
  onSelectFile,
  loading: _loading,
  setLoading,
  setError,
  onSuccess,
}: CodexFormProps) {
  const [mode, setMode] = useState<"login" | "file">("login");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [waitingForCallback, setWaitingForCallback] = useState(false);

  // 监听后端发送的授权 URL 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await onCodexAuthUrl((payload) => {
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
      await providerPoolApi.getCodexAuthUrlAndWait(trimmedName);
      onSuccess();
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      setError(errorMsg);
      setWaitingForCallback(false);
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
      const trimmedUrl = apiBaseUrl.trim() || undefined;
      await providerPoolApi.addCodexOAuth(
        credsFilePath,
        trimmedUrl,
        trimmedName,
      );
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return {
    mode,
    authUrl,
    waitingForCallback,
    handleGetAuthUrl,
    handleFileSubmit,
    render: () => (
      <>
        <ModeSelector
          mode={mode}
          setMode={setMode}
          loginLabel="OpenAI 登录"
          fileLabel="导入文件"
        />

        {mode === "login" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-green-200 bg-green-50 p-4">
              <p className="text-sm text-green-700">
                点击下方按钮获取授权 URL，然后复制到浏览器（支持指纹浏览器）完成
                OpenAI 登录。
              </p>
              <p className="mt-2 text-xs text-green-600">
                授权成功后，凭证将自动保存并添加到凭证池。
              </p>
            </div>

            <OAuthUrlDisplay
              authUrl={authUrl}
              waitingForCallback={waitingForCallback}
              colorScheme="green"
            />
          </div>
        ) : (
          <div className="space-y-4">
            <FileImportForm
              credsFilePath={credsFilePath}
              setCredsFilePath={setCredsFilePath}
              onSelectFile={onSelectFile}
              placeholder="选择 auth.json 或 oauth.json..."
              hint="默认路径: ~/.codex/auth.json 或 Codex CLI 的凭证文件"
            />

            {/* API Base URL 输入框 */}
            <div>
              <label className="mb-1 block text-sm font-medium">
                API Base URL
              </label>
              <input
                type="text"
                value={apiBaseUrl}
                onChange={(e) => setApiBaseUrl(e.target.value)}
                placeholder="https://yunyi.cfd/codex"
                className="w-full rounded-md border bg-background px-3 py-2 text-sm"
              />
              <p className="mt-1 text-xs text-muted-foreground">
                云驿代理默认:
                https://yunyi.cfd/codex（留空则使用凭证文件中的配置）
              </p>
            </div>
          </div>
        )}
      </>
    ),
  };
}
