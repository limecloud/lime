/**
 * @file ASR Provider 管理区域
 * @description 显示 ASR 凭证列表和管理操作
 * @module components/voice/AsrProviderSection
 */

import { useState, useEffect, useCallback } from "react";
import { Plus, RefreshCw, Cpu, Cloud, Sparkles } from "lucide-react";
import { AsrCredentialCard } from "./AsrCredentialCard";
import { AddAsrCredentialModal } from "./AddAsrCredentialModal";
import type { AsrCredentialEntry, AsrProviderType } from "./types";
import {
  getAsrCredentials,
  deleteAsrCredential,
  setDefaultAsrCredential,
  testAsrCredential,
  updateAsrCredential,
  ASR_PROVIDERS,
} from "./types";

/** Provider 图标 */
const ProviderIcon = ({ type }: { type: AsrProviderType }) => {
  switch (type) {
    case "whisper_local":
    case "sensevoice_local":
      return <Cpu className="h-5 w-5" />;
    case "openai":
      return <Sparkles className="h-5 w-5" />;
    default:
      return <Cloud className="h-5 w-5" />;
  }
};

export function AsrProviderSection() {
  const [credentials, setCredentials] = useState<AsrCredentialEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [selectedType, setSelectedType] = useState<AsrProviderType | null>(
    null,
  );

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getAsrCredentials();
      setCredentials(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchCredentials();
  }, [fetchCredentials]);

  const handleSetDefault = async (id: string) => {
    try {
      await setDefaultAsrCredential(id);
      await fetchCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "设置默认失败");
    }
  };

  const handleToggle = async (credential: AsrCredentialEntry) => {
    try {
      await updateAsrCredential({
        ...credential,
        disabled: !credential.disabled,
      });
      await fetchCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "切换状态失败");
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteAsrCredential(id);
      await fetchCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "删除失败");
    }
  };

  const handleTest = async (id: string) => {
    return testAsrCredential(id);
  };

  // 按类型分组
  const getCredentialsByType = (type: AsrProviderType) => {
    return credentials.filter((c) => c.provider === type);
  };

  // 当前选中类型的凭证
  const currentCredentials = selectedType
    ? getCredentialsByType(selectedType)
    : credentials;

  return (
    <div className="space-y-4">
      {error && (
        <div className="rounded-lg border border-red-500 bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Provider 类型选择 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => setSelectedType(null)}
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
            selectedType === null
              ? "border-primary bg-primary/10 text-primary"
              : "border-border hover:border-primary/50"
          }`}
        >
          全部
          {credentials.length > 0 && (
            <span className="rounded-full bg-muted px-1.5 text-xs">
              {credentials.length}
            </span>
          )}
        </button>
        {ASR_PROVIDERS.map((provider) => {
          const count = getCredentialsByType(provider.type).length;
          return (
            <button
              key={provider.type}
              onClick={() => setSelectedType(provider.type)}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                selectedType === provider.type
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:border-primary/50"
              }`}
            >
              <ProviderIcon type={provider.type} />
              {provider.label}
              {count > 0 && (
                <span className="rounded-full bg-muted px-1.5 text-xs">
                  {count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* 操作栏 */}
      <div className="flex items-center justify-between">
        <div className="text-sm text-muted-foreground">
          {credentials.length > 0
            ? `共 ${credentials.length} 个语音服务`
            : "暂无语音服务"}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchCredentials}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            刷新
          </button>
          <button
            onClick={() => setAddModalOpen(true)}
            className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            添加服务
          </button>
        </div>
      </div>

      {/* 凭证列表 */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : currentCredentials.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground">
          <p className="text-lg">暂无语音服务</p>
          <p className="mt-1 text-sm">点击"添加服务"按钮添加语音识别服务</p>
          <button
            onClick={() => setAddModalOpen(true)}
            className="mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            添加第一个服务
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {currentCredentials.map((credential) => (
            <AsrCredentialCard
              key={credential.id}
              credential={credential}
              onSetDefault={() => handleSetDefault(credential.id)}
              onToggle={() => handleToggle(credential)}
              onDelete={() => handleDelete(credential.id)}
              onTest={() => handleTest(credential.id)}
            />
          ))}
        </div>
      )}

      {/* 添加模态框 */}
      <AddAsrCredentialModal
        isOpen={addModalOpen}
        onClose={() => setAddModalOpen(false)}
        onSuccess={fetchCredentials}
      />
    </div>
  );
}
