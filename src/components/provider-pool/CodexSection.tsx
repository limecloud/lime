import { useState } from "react";
import { Plus, Trash2, FolderOpen, LogIn, RefreshCw } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { CredentialEntry } from "@/lib/api/providerRuntime";

interface CodexSectionProps {
  entries: CredentialEntry[];
  onChange: (entries: CredentialEntry[]) => void;
  onOAuthLogin?: (id: string) => Promise<void>;
  onRefreshToken?: (id: string) => Promise<void>;
}

export function CodexSection({
  entries,
  onChange,
  onOAuthLogin,
  onRefreshToken,
}: CodexSectionProps) {
  const [loginLoading, setLoginLoading] = useState<string | null>(null);
  const [refreshLoading, setRefreshLoading] = useState<string | null>(null);

  const addEntry = () => {
    const newEntry: CredentialEntry = {
      id: `codex-${Date.now()}`,
      token_file: "~/.codex/oauth.json",
      disabled: false,
      proxy_url: null,
    };
    onChange([...entries, newEntry]);
  };

  const updateEntry = (id: string, updates: Partial<CredentialEntry>) => {
    onChange(entries.map((e) => (e.id === id ? { ...e, ...updates } : e)));
  };

  const removeEntry = (id: string) => {
    onChange(entries.filter((e) => e.id !== id));
  };

  const handleSelectFile = async (id: string) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: "JSON", extensions: ["json"] }],
      });
      if (selected) {
        updateEntry(id, { token_file: selected as string });
      }
    } catch (e) {
      console.error("Failed to open file dialog:", e);
    }
  };

  const handleOAuthLogin = async (id: string) => {
    if (!onOAuthLogin) return;
    setLoginLoading(id);
    try {
      await onOAuthLogin(id);
    } catch (e) {
      console.error("OAuth login failed:", e);
    } finally {
      setLoginLoading(null);
    }
  };

  const handleRefreshToken = async (id: string) => {
    if (!onRefreshToken) return;
    setRefreshLoading(id);
    try {
      await onRefreshToken(id);
    } catch (e) {
      console.error("Token refresh failed:", e);
    } finally {
      setRefreshLoading(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <LogIn className="h-5 w-5 text-purple-500" />
          <div>
            <h3 className="text-sm font-medium">OpenAI Codex OAuth</h3>
            <p className="text-xs text-muted-foreground">
              通过 OAuth 认证使用 OpenAI Codex 服务
            </p>
          </div>
        </div>
        <button
          onClick={addEntry}
          className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          添加
        </button>
      </div>

      {entries.length === 0 ? (
        <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground">
          <p>暂无 Codex OAuth 凭证</p>
          <p className="text-xs mt-1">点击上方"添加"按钮添加凭证</p>
        </div>
      ) : (
        <div className="space-y-3">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className={`rounded-lg border p-4 space-y-3 ${
                entry.disabled ? "opacity-60 bg-muted/30" : ""
              }`}
            >
              {/* Header */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium font-mono">
                  {entry.id}
                </span>
                <div className="flex items-center gap-2">
                  <label className="flex items-center gap-1 text-xs cursor-pointer">
                    <input
                      type="checkbox"
                      checked={entry.disabled}
                      onChange={(e) =>
                        updateEntry(entry.id, { disabled: e.target.checked })
                      }
                      className="w-3 h-3"
                    />
                    禁用
                  </label>
                  <button
                    onClick={() => removeEntry(entry.id)}
                    className="p-1 rounded hover:bg-red-100 text-red-500"
                    title="删除"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Token File Path */}
              <div>
                <label className="block text-xs font-medium mb-1">
                  Token 文件路径
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={entry.token_file}
                    onChange={(e) =>
                      updateEntry(entry.id, { token_file: e.target.value })
                    }
                    placeholder="~/.codex/oauth.json"
                    className="flex-1 px-3 py-1.5 rounded border bg-background text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => handleSelectFile(entry.id)}
                    className="flex items-center gap-1 rounded border px-2 py-1.5 text-sm hover:bg-muted"
                  >
                    <FolderOpen className="h-4 w-4" />
                  </button>
                </div>
              </div>

              {/* Proxy URL */}
              <div>
                <label className="block text-xs font-medium mb-1">
                  代理 URL (可选)
                </label>
                <input
                  type="text"
                  value={entry.proxy_url || ""}
                  onChange={(e) =>
                    updateEntry(entry.id, { proxy_url: e.target.value || null })
                  }
                  placeholder="socks5://127.0.0.1:1080"
                  className="w-full px-3 py-1.5 rounded border bg-background text-sm"
                />
              </div>

              {/* OAuth Actions */}
              <div className="flex gap-2 pt-2 border-t">
                {onOAuthLogin && (
                  <button
                    onClick={() => handleOAuthLogin(entry.id)}
                    disabled={loginLoading === entry.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded bg-purple-600 text-white text-sm hover:bg-purple-700 disabled:opacity-50"
                  >
                    {loginLoading === entry.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <LogIn className="h-4 w-4" />
                    )}
                    OAuth 登录
                  </button>
                )}
                {onRefreshToken && (
                  <button
                    onClick={() => handleRefreshToken(entry.id)}
                    disabled={refreshLoading === entry.id}
                    className="flex items-center gap-1 px-3 py-1.5 rounded border text-sm hover:bg-muted disabled:opacity-50"
                  >
                    {refreshLoading === entry.id ? (
                      <RefreshCw className="h-4 w-4 animate-spin" />
                    ) : (
                      <RefreshCw className="h-4 w-4" />
                    )}
                    刷新 Token
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
