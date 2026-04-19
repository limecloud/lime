/**
 * Gemini 凭证添加表单
 * 支持 Google OAuth 登录和文件导入两种模式
 *
 * Gemini OAuth 流程：
 * 1. 生成授权 URL（包含 PKCE）
 * 2. 用户在浏览器中打开 URL 并授权
 * 3. 浏览器跳转到 codeassist.google.com/authcode 显示 code
 * 4. 用户复制 code 回应用
 * 5. 应用用 code 交换 tokens
 */

import { useState, useEffect } from "react";
import { onGeminiAuthUrl } from "@/lib/api/providerAuthEvents";
import { providerPoolApi } from "@/lib/api/providerPool";
import { ModeSelector } from "./ModeSelector";
import { FileImportForm } from "./FileImportForm";
import { Copy, Check, Loader2 } from "lucide-react";

interface GeminiFormProps {
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

export function GeminiForm({
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
}: GeminiFormProps) {
  const [mode, setMode] = useState<"login" | "file">("login");
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [authCode, setAuthCode] = useState("");
  const [copied, setCopied] = useState(false);
  const [exchanging, setExchanging] = useState(false);

  // 监听后端发送的授权 URL 事件
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    const setupListener = async () => {
      unlisten = await onGeminiAuthUrl((payload) => {
        console.log("[Gemini OAuth] 收到授权 URL 事件:", payload);
        setAuthUrl(payload.auth_url);
        setSessionId(payload.session_id);
      });
    };

    setupListener();

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // 获取授权 URL
  const handleGetAuthUrl = async () => {
    setLoading(true);
    setError(null);
    setAuthUrl(null);
    setSessionId(null);
    setAuthCode("");

    try {
      // 调用后端生成授权 URL
      await providerPoolApi.getGeminiAuthUrlAndWait(name.trim() || undefined);
      // URL 会通过事件返回
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      // 检查是否包含 AUTH_URL 前缀（后端返回的授权 URL）
      if (errorMsg.includes("AUTH_URL:")) {
        const urlMatch = errorMsg.match(/AUTH_URL:(.+?)(?:\s|$)/);
        if (urlMatch) {
          setAuthUrl(urlMatch[1]);
        }
      } else {
        setError(errorMsg);
      }
    } finally {
      setLoading(false);
    }
  };

  // 用 code 交换 token
  const handleExchangeCode = async () => {
    if (!authCode.trim()) {
      setError("请输入授权码");
      return;
    }

    setExchanging(true);
    setError(null);

    try {
      const trimmedName = name.trim() || undefined;
      await providerPoolApi.exchangeGeminiCode(
        authCode.trim(),
        sessionId || undefined,
        trimmedName,
      );
      onSuccess();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExchanging(false);
    }
  };

  // 复制 URL
  const handleCopyUrl = async () => {
    if (authUrl) {
      await navigator.clipboard.writeText(authUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
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
      await providerPoolApi.addGeminiOAuth(
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
    sessionId,
    authCode,
    exchanging,
    handleGetAuthUrl,
    handleExchangeCode,
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
                点击下方按钮获取授权 URL，然后复制到浏览器完成 Google 登录。
              </p>
              <p className="mt-2 text-xs text-emerald-600">
                授权成功后，复制页面显示的授权码粘贴到下方输入框。
              </p>
            </div>

            {/* 授权 URL 显示 */}
            {authUrl && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">授权 URL</span>
                  <button
                    onClick={handleCopyUrl}
                    className="flex items-center gap-1 rounded px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-50"
                  >
                    {copied ? (
                      <>
                        <Check className="h-3 w-3" />
                        已复制
                      </>
                    ) : (
                      <>
                        <Copy className="h-3 w-3" />
                        复制
                      </>
                    )}
                  </button>
                </div>
                <div className="rounded-lg border bg-muted/50 p-3">
                  <p className="break-all text-xs text-muted-foreground">
                    {authUrl.length > 100
                      ? `${authUrl.slice(0, 100)}...`
                      : authUrl}
                  </p>
                </div>

                {/* 授权码输入 */}
                <div className="space-y-2">
                  <label className="text-sm font-medium">
                    授权码 <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="text"
                    value={authCode}
                    onChange={(e) => setAuthCode(e.target.value)}
                    placeholder="粘贴浏览器页面显示的授权码..."
                    className="w-full rounded-lg border bg-background px-3 py-2 text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    在浏览器中完成授权后，复制页面显示的授权码
                  </p>
                </div>

                {/* 提交按钮 */}
                <button
                  onClick={handleExchangeCode}
                  disabled={exchanging || !authCode.trim()}
                  className="w-full rounded-lg border border-emerald-200 bg-[linear-gradient(135deg,#0ea5e9_0%,#14b8a6_52%,#10b981_100%)] px-4 py-2 text-sm text-white shadow-sm shadow-emerald-950/15 hover:opacity-95 disabled:opacity-50"
                >
                  {exchanging ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      验证中...
                    </span>
                  ) : (
                    "验证授权码"
                  )}
                </button>
              </div>
            )}
          </div>
        ) : (
          <FileImportForm
            credsFilePath={credsFilePath}
            setCredsFilePath={setCredsFilePath}
            onSelectFile={onSelectFile}
            placeholder="选择 oauth_creds.json..."
            hint="默认路径: ~/.gemini/oauth_creds.json"
            projectId={projectId}
            setProjectId={setProjectId}
            showProjectId
          />
        )}
      </>
    ),
  };
}
