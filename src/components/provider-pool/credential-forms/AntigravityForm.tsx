/**
 * Antigravity 凭证添加表单
 * 支持 Google OAuth 登录和文件导入两种模式
 */

import { useState, useEffect } from "react";
import { onAntigravityAuthUrl } from "@/lib/api/providerAuthEvents";
import { providerPoolApi } from "@/lib/api/providerPool";
import { ModeSelector } from "./ModeSelector";
import { FileImportForm } from "./FileImportForm";
import { OAuthUrlDisplay } from "./OAuthUrlDisplay";

interface AntigravityFormProps {
  name: string;
  credsFilePath: string;
  setCredsFilePath: (path: string) => void;
  projectId: string;
  setProjectId: (id: string) => void;
  onSelectFile: () => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  onSuccess: () => void;
}

export function AntigravityForm({
  name,
  credsFilePath,
  setCredsFilePath,
  projectId,
  setProjectId,
  onSelectFile,
  loading: _loading,
  setLoading,
  setError,
  onSuccess,
}: AntigravityFormProps) {
  const [mode, setMode] = useState<"login" | "file">("login");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [waitingForCallback, setWaitingForCallback] = useState(false);

  // 监听后端发送的授权 URL 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await onAntigravityAuthUrl((payload) => {
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
      await providerPoolApi.getAntigravityAuthUrlAndWait(trimmedName, false);
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
      await providerPoolApi.addAntigravityOAuth(
        credsFilePath,
        projectId.trim() || undefined,
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
          loginLabel="Google 登录"
          fileLabel="导入文件"
        />

        {mode === "login" ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
              <p className="text-sm text-emerald-700">
                点击下方按钮获取授权
                URL，然后复制到浏览器（支持指纹浏览器）完成登录。
              </p>
              <p className="mt-2 text-xs text-emerald-600">
                授权成功后，凭证将自动保存并添加到凭证池。
              </p>
            </div>

            <OAuthUrlDisplay
              authUrl={authUrl}
              waitingForCallback={waitingForCallback}
              colorScheme="blue"
            />
          </div>
        ) : (
          <FileImportForm
            credsFilePath={credsFilePath}
            setCredsFilePath={setCredsFilePath}
            onSelectFile={onSelectFile}
            placeholder="选择 accounts.json 或 oauth_creds.json..."
            hint="支持 antigravity2api-nodejs 的 data/accounts.json 格式"
            projectId={projectId}
            setProjectId={setProjectId}
            showProjectId
          />
        )}
      </>
    ),
  };
}
