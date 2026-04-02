/**
 * @file ProviderPoolPage 组件
 * @description 凭证池管理页面，支持 OAuth 凭证卡片布局和 API Key 左右分栏布局
 * @module components/provider-pool/ProviderPoolPage
 *
 * **Feature: provider-ui-refactor**
 * **Validates: Requirements 1.1, 2.1, 2.2, 2.3**
 */

import {
  useState,
  useEffect,
  forwardRef,
  useImperativeHandle,
  useCallback,
  useRef,
} from "react";
import {
  RefreshCw,
  Plus,
  Heart,
  HeartOff,
  RotateCcw,
  Activity,
} from "lucide-react";
import { useProviderPool } from "@/hooks/useProviderPool";
import { useApiKeyProvider } from "@/hooks/useApiKeyProvider";
import { CredentialCard } from "./CredentialCard";
import { CredentialCardContextMenu } from "./CredentialCardContextMenu";
import { AddCredentialModal } from "./AddCredentialModal";
import { EditCredentialModal } from "./EditCredentialModal";
import { ErrorDisplay, useErrorDisplay } from "./ErrorDisplay";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ProviderIcon } from "@/icons/providers";
import { ApiKeyProviderSection, AddCustomProviderModal } from "./api-key";
import type { ApiKeyProviderSectionRef } from "./api-key";
import { RelayProvidersSection } from "./RelayProvidersSection";
import { AsrProviderSection } from "@/components/voice";
import type { AddCustomProviderRequest } from "@/lib/api/apiKeyProvider";
import {
  getLocalKiroCredentialUuid,
  type PoolProviderType,
  type CredentialDisplay,
  type UpdateCredentialRequest,
} from "@/lib/api/providerPool";

export interface ProviderPoolPageRef {
  refresh: () => void;
}

interface ProviderPoolPageProps {
  hideHeader?: boolean;
}

// OAuth 类型凭证（需要上传凭证文件或登录授权）
const oauthProviderTypes: PoolProviderType[] = [
  "kiro",
  "gemini",
  "antigravity",
  "codex",
  "claude_oauth",
];

// 配置类型 tab（非凭证池）
type ConfigTabType = "connect";

// 所有 tab 类型
type TabType = PoolProviderType | ConfigTabType;

const providerLabels: Record<PoolProviderType, string> = {
  kiro: "Kiro (AWS)",
  gemini: "Gemini (Google)",
  antigravity: "Antigravity (Gemini 3 Pro)",
  openai: "OpenAI",
  claude: "Claude (Anthropic)",
  codex: "Codex (OpenAI)",
  claude_oauth: "Claude OAuth",
  gemini_api_key: "Gemini",
};

// 判断是否为配置类型 tab
const isConfigTab = (tab: TabType): tab is ConfigTabType => {
  return tab === "connect";
};

// 分类类型
type CategoryType = "oauth" | "apikey" | "connect" | "voice";

export const ProviderPoolPage = forwardRef<
  ProviderPoolPageRef,
  ProviderPoolPageProps
>(({ hideHeader = false }, ref) => {
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingCredential, setEditingCredential] =
    useState<CredentialDisplay | null>(null);
  const [activeCategory, setActiveCategory] = useState<CategoryType>("apikey");
  const [activeTab, setActiveTab] = useState<TabType>("kiro");
  const [deletingCredentials, setDeletingCredentials] = useState<Set<string>>(
    new Set(),
  );
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const { errors, showError, showSuccess, dismissError } = useErrorDisplay();

  // 添加自定义 Provider 模态框状态
  const [addCustomProviderModalOpen, setAddCustomProviderModalOpen] =
    useState(false);

  // ApiKeyProviderSection 的 ref
  const apiKeyProviderSectionRef = useRef<ApiKeyProviderSectionRef>(null);

  const {
    overview,
    loading,
    error,
    checkingHealth,
    refreshingToken,
    refresh,
    deleteCredential,
    toggleCredential,
    resetCredential,
    resetHealth,
    checkCredentialHealth,
    checkTypeHealth,
    refreshCredentialToken,
    updateCredential,
  } = useProviderPool();

  // API Key Provider Hook
  const {
    addCustomProvider,
    addApiKey,
    refresh: refreshApiKeyProviders,
  } = useApiKeyProvider();

  const [_migrating, setMigrating] = useState(false);

  // Kiro 本地活跃凭证 UUID
  const [localActiveUuid, setLocalActiveUuid] = useState<string | null>(null);

  // 获取本地活跃的 Kiro 凭证 UUID
  const fetchLocalActiveUuid = async () => {
    try {
      const uuid = await getLocalKiroCredentialUuid();
      console.log("[ProviderPoolPage] Local active Kiro UUID:", uuid);
      setLocalActiveUuid(uuid);
    } catch (e) {
      console.error("Failed to get local Kiro credential:", e);
      setLocalActiveUuid(null);
    }
  };

  useEffect(() => {
    // 只在 Kiro tab 时检测本地活跃凭证
    if (activeTab === "kiro") {
      fetchLocalActiveUuid();
    }
  }, [activeTab, overview]);

  useImperativeHandle(ref, () => ({
    refresh: () => {
      refresh();
      refreshApiKeyProviders();
    },
  }));

  const handleDeleteClick = (uuid: string) => {
    setDeleteConfirm(uuid);
  };

  const handleDeleteConfirm = async () => {
    if (!deleteConfirm) return;
    const uuid = deleteConfirm;
    setDeleteConfirm(null);
    setDeletingCredentials((prev) => new Set(prev).add(uuid));
    try {
      const providerType = !isConfigTab(activeTab)
        ? (activeTab as PoolProviderType)
        : undefined;
      await deleteCredential(uuid, providerType);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e), "delete", uuid);
    } finally {
      setDeletingCredentials((prev) => {
        const next = new Set(prev);
        next.delete(uuid);
        return next;
      });
    }
  };

  const handleToggle = async (credential: CredentialDisplay) => {
    try {
      await toggleCredential(credential.uuid, !credential.is_disabled);
    } catch (e) {
      showError(
        e instanceof Error ? e.message : String(e),
        "toggle",
        credential.uuid,
      );
    }
  };

  const handleReset = async (uuid: string) => {
    try {
      await resetCredential(uuid);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e), "reset", uuid);
    }
  };

  const handleCheckHealth = async (uuid: string) => {
    try {
      const result = await checkCredentialHealth(uuid);
      if (result.success) {
        showSuccess("健康检查通过！", uuid);
      } else {
        showError(result.message || "健康检查未通过", "health_check", uuid);
      }
    } catch (e) {
      showError(
        e instanceof Error ? e.message : String(e),
        "health_check",
        uuid,
      );
    }
  };

  const handleCheckTypeHealth = async (providerType: PoolProviderType) => {
    try {
      await checkTypeHealth(providerType);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e), "health_check");
    }
  };

  const handleResetTypeHealth = async (providerType: PoolProviderType) => {
    try {
      await resetHealth(providerType);
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e), "reset");
    }
  };

  // 迁移 Private 配置到凭证池
  const _handleMigratePrivateConfig = async () => {
    setMigrating(true);
    try {
      // const config = await getConfig();
      // const result = await migratePrivateConfig(config);
      const result = {
        migrated_count: 0,
        skipped_count: 0,
        errors: [] as string[],
      };
      if (result.migrated_count > 0) {
        showSuccess(
          `成功迁移 ${result.migrated_count} 个凭证${result.skipped_count > 0 ? `，跳过 ${result.skipped_count} 个已存在的凭证` : ""}`,
        );
      } else if (result.skipped_count > 0) {
        showSuccess(`所有凭证已存在，跳过 ${result.skipped_count} 个`);
      } else {
        showSuccess("没有需要迁移的凭证");
      }
      if (result.errors.length > 0) {
        showError(`部分迁移失败: ${result.errors.join(", ")}`, "migrate");
      }
    } catch (e) {
      showError(e instanceof Error ? e.message : String(e), "migrate");
    } finally {
      setMigrating(false);
    }
  };

  const handleRefreshToken = async (uuid: string) => {
    try {
      await refreshCredentialToken(uuid);
      showSuccess("Token 刷新成功！", uuid);
    } catch (e) {
      showError(
        e instanceof Error ? e.message : String(e),
        "refresh_token",
        uuid,
      );
    }
  };

  const handleEdit = (credential: CredentialDisplay) => {
    setEditingCredential(credential);
    setEditModalOpen(true);
  };

  const handleEditSubmit = async (
    uuid: string,
    request: UpdateCredentialRequest,
  ) => {
    try {
      await updateCredential(uuid, request);
    } catch (e) {
      throw new Error(
        `编辑失败: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  };

  const closeEditModal = () => {
    setEditModalOpen(false);
    setEditingCredential(null);
  };

  const openAddModal = () => {
    setAddModalOpen(true);
  };

  const getProviderOverview = (providerType: PoolProviderType) => {
    return overview.find((p) => p.provider_type === providerType);
  };

  const getCredentialCount = (providerType: PoolProviderType) => {
    const pool = getProviderOverview(providerType);
    return pool?.credentials?.length || 0;
  };

  // 添加自定义 Provider 处理
  const handleAddCustomProvider = useCallback(
    async (request: AddCustomProviderRequest) => {
      const result = await addCustomProvider(request);
      return result; // 返回包含 id 的结果
    },
    [addCustomProvider],
  );

  // 添加 API Key 处理
  const handleAddApiKey = useCallback(
    async (providerId: string, apiKey: string) => {
      await addApiKey(providerId, apiKey);
      // 刷新 ApiKeyProviderSection 的数据
      await apiKeyProviderSectionRef.current?.refresh();
    },
    [addApiKey],
  );

  // Current tab data (仅用于 OAuth 凭证 tab)
  const currentPool =
    !isConfigTab(activeTab) && activeCategory === "oauth"
      ? getProviderOverview(activeTab as PoolProviderType)
      : null;
  const currentStats = currentPool?.stats;
  const currentCredentials = currentPool?.credentials || [];

  return (
    <div className="space-y-4">
      {!hideHeader && (
        <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-sm shadow-slate-950/5">
          <div>
            <h2 className="text-xl font-semibold text-slate-900">
              Provider 与凭证
            </h2>
            <p className="mt-2 text-sm leading-6 text-slate-600">
              默认先管理 API Key Provider。OAuth、语音和中转服务保留在同一入口，但不再和日常 Provider 配置抢同一视觉焦点。
            </p>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500 bg-red-50 p-4 text-red-700 dark:bg-red-950/30">
          {error}
        </div>
      )}

      {/* Category Tabs - 第一行：分类选择 */}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() => {
            setActiveCategory("apikey");
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            activeCategory === "apikey"
              ? "border-slate-300 bg-white text-slate-950 shadow-sm"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900"
          }`}
          data-testid="apikey-category-tab"
        >
          服务商
        </button>
        <button
          onClick={() => {
            setActiveCategory("connect");
            setActiveTab("connect");
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            activeCategory === "connect"
              ? "border-slate-300 bg-white text-slate-950 shadow-sm"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900"
          }`}
          data-testid="connect-category-tab"
        >
          中转服务
        </button>
        <button
          onClick={() => {
            setActiveCategory("voice");
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            activeCategory === "voice"
              ? "border-slate-300 bg-white text-slate-950 shadow-sm"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900"
          }`}
          data-testid="voice-category-tab"
        >
          语音服务
        </button>
        <button
          onClick={() => {
            setActiveCategory("oauth");
            setActiveTab(oauthProviderTypes[0]);
          }}
          className={`rounded-xl border px-4 py-2 text-sm font-medium transition-colors ${
            activeCategory === "oauth"
              ? "border-slate-300 bg-white text-slate-950 shadow-sm"
              : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900"
          }`}
          data-testid="oauth-category-tab"
        >
          OAuth 凭证
        </button>
      </div>

      {/* OAuth 凭证分类 - Provider 选择图标网格 */}
      {activeCategory === "oauth" && (
        <div className="flex flex-wrap gap-2">
          {oauthProviderTypes.map((providerType) => {
            const count = getCredentialCount(providerType);
            const isActive = activeTab === providerType;
            return (
              <button
                key={providerType}
              onClick={() => setActiveTab(providerType)}
              title={providerLabels[providerType]}
                className={`group relative flex min-w-[120px] items-center justify-center gap-2 rounded-xl border px-3 py-2 transition-all ${
                  isActive
                    ? "border-slate-300 bg-white text-slate-950 shadow-sm"
                    : "border-slate-200 bg-slate-50 text-slate-600 hover:border-slate-300 hover:bg-white hover:text-slate-900"
                }`}
                data-testid={`oauth-provider-${providerType}`}
              >
                <ProviderIcon providerType={providerType} size={20} />
                <span className="text-sm font-medium">
                  {providerLabels[providerType].split(" ")[0]}
                </span>
                {count > 0 && (
                  <span
                    className={`min-w-[1.25rem] h-5 flex items-center justify-center rounded-full text-xs font-medium ${
                      isActive
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted-foreground/20 text-muted-foreground group-hover:bg-primary/20 group-hover:text-primary"
                    }`}
                    data-testid={`oauth-credential-count-${providerType}`}
                  >
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Connect 分类 - 中转商列表 */}
      {activeCategory === "connect" && (
        <div className="min-h-[400px]" data-testid="connect-section">
          <RelayProvidersSection />
        </div>
      )}

      {/* API Key 分类 - 左右分栏布局 */}
      {activeCategory === "apikey" && (
        <div
          className="h-[calc(100vh-240px)] min-h-[620px]"
          data-testid="apikey-section"
        >
          <ApiKeyProviderSection
            ref={apiKeyProviderSectionRef}
            onAddCustomProvider={() => setAddCustomProviderModalOpen(true)}
          />
        </div>
      )}

      {/* 语音服务分类 */}
      {activeCategory === "voice" && (
        <div className="min-h-[400px]" data-testid="voice-section">
          <AsrProviderSection />
        </div>
      )}

      {/* OAuth 凭证内容 - 卡片布局 */}
      {activeCategory === "oauth" &&
        !isConfigTab(activeTab) &&
        (loading ? (
          <div className="flex items-center justify-center py-12">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-4" data-testid="oauth-credentials-section">
            {/* Stats and Actions Bar */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                {currentStats && currentStats.total > 0 && (
                  <div
                    className="flex items-center gap-3 text-sm text-muted-foreground"
                    data-testid="oauth-stats"
                  >
                    <span
                      className="flex items-center gap-1"
                      data-testid="healthy-count"
                    >
                      <Heart className="h-4 w-4 text-green-500" />
                      健康: {currentStats.healthy}
                    </span>
                    <span
                      className="flex items-center gap-1"
                      data-testid="unhealthy-count"
                    >
                      <HeartOff className="h-4 w-4 text-red-500" />
                      不健康: {currentStats.unhealthy}
                    </span>
                    <span data-testid="total-count">
                      总计: {currentStats.total}
                    </span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2">
                {currentCredentials.length > 0 && (
                  <>
                    <button
                      onClick={() =>
                        handleCheckTypeHealth(activeTab as PoolProviderType)
                      }
                      disabled={checkingHealth === activeTab}
                      className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted disabled:opacity-50"
                      data-testid="check-all-health-btn"
                    >
                      <Activity
                        className={`h-4 w-4 ${checkingHealth === activeTab ? "animate-pulse" : ""}`}
                      />
                      检测全部
                    </button>
                    <button
                      onClick={() =>
                        handleResetTypeHealth(activeTab as PoolProviderType)
                      }
                      className="flex items-center gap-1 rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
                      data-testid="reset-health-btn"
                    >
                      <RotateCcw className="h-4 w-4" />
                      重置状态
                    </button>
                    <button
                      onClick={openAddModal}
                      className="flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-sm text-primary-foreground hover:bg-primary/90"
                      data-testid="add-credential-btn"
                    >
                      <Plus className="h-4 w-4" />
                      添加凭证
                    </button>
                  </>
                )}
              </div>
            </div>

            {/* Credentials List */}
            {currentCredentials.length === 0 ? (
              <div
                className="flex flex-col items-center justify-center rounded-lg border border-dashed py-12 text-muted-foreground"
                data-testid="empty-credentials"
              >
                <p className="text-lg">
                  暂无 {providerLabels[activeTab as PoolProviderType]} 凭证
                </p>
                <p className="mt-1 text-sm">点击上方"添加凭证"按钮添加</p>
                <button
                  onClick={openAddModal}
                  className="mt-4 flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm text-primary-foreground hover:bg-primary/90"
                  data-testid="add-first-credential-btn"
                >
                  <Plus className="h-4 w-4" />
                  添加第一个凭证
                </button>
              </div>
            ) : (
              <div
                className="flex flex-col gap-4"
                data-testid="credentials-list"
              >
                {currentCredentials.map((credential) => {
                  // 判断是否为 OAuth 类型（需要刷新 Token 功能）
                  const isOAuthType =
                    credential.credential_type.includes("oauth");
                  // 判断是否为 Kiro 凭证（支持用量查询）
                  const isKiroCredential = activeTab === "kiro";
                  const isLocalActive =
                    isKiroCredential && credential.uuid === localActiveUuid;

                  if (isKiroCredential) {
                    console.log(
                      `[ProviderPoolPage] Credential ${credential.uuid.substring(0, 8)}: isLocalActive=${isLocalActive}, localActiveUuid=${localActiveUuid?.substring(0, 8)}`,
                    );
                  }

                  return (
                    <CredentialCardContextMenu
                      key={credential.uuid}
                      credential={credential}
                      onRefreshToken={
                        isOAuthType
                          ? () => handleRefreshToken(credential.uuid)
                          : undefined
                      }
                      onToggle={() => handleToggle(credential)}
                      onDelete={() => handleDeleteClick(credential.uuid)}
                      isOAuth={isOAuthType}
                    >
                      <div data-testid={`credential-card-${credential.uuid}`}>
                        <CredentialCard
                          credential={credential}
                          onToggle={() => handleToggle(credential)}
                          onDelete={() => handleDeleteClick(credential.uuid)}
                          onReset={() => handleReset(credential.uuid)}
                          onCheckHealth={() =>
                            handleCheckHealth(credential.uuid)
                          }
                          onRefreshToken={
                            isOAuthType
                              ? () => handleRefreshToken(credential.uuid)
                              : undefined
                          }
                          onEdit={() => handleEdit(credential)}
                          deleting={deletingCredentials.has(credential.uuid)}
                          checkingHealth={checkingHealth === credential.uuid}
                          refreshingToken={refreshingToken === credential.uuid}
                          isKiroCredential={isKiroCredential}
                          isLocalActive={isLocalActive}
                          onSwitchToLocal={
                            isKiroCredential ? fetchLocalActiveUuid : undefined
                          }
                        />
                      </div>
                    </CredentialCardContextMenu>
                  );
                })}
              </div>
            )}
          </div>
        ))}

      {/* Add Credential Modal (仅 OAuth 凭证 tab) */}
      {addModalOpen &&
        activeCategory === "oauth" &&
        !isConfigTab(activeTab) && (
          <AddCredentialModal
            providerType={activeTab as PoolProviderType}
            onClose={() => {
              setAddModalOpen(false);
            }}
            onSuccess={() => {
              setAddModalOpen(false);
              refresh();
            }}
          />
        )}

      {/* Add Custom Provider Modal (API Key 分类) */}
      <AddCustomProviderModal
        isOpen={addCustomProviderModalOpen}
        onClose={() => setAddCustomProviderModalOpen(false)}
        onAdd={handleAddCustomProvider}
        onAddApiKey={handleAddApiKey}
      />

      {/* Edit Credential Modal */}
      <EditCredentialModal
        credential={editingCredential}
        isOpen={editModalOpen}
        onClose={closeEditModal}
        onEdit={handleEditSubmit}
      />

      {/* Error Display */}
      <ErrorDisplay
        errors={errors}
        onDismiss={dismissError}
        onRetry={(error) => {
          switch (error.type) {
            case "health_check":
              if (error.uuid) {
                handleCheckHealth(error.uuid);
              }
              break;
            case "refresh_token":
              if (error.uuid) {
                handleRefreshToken(error.uuid);
              }
              break;
            case "reset":
              if (error.uuid) {
                handleReset(error.uuid);
              }
              break;
          }
          dismissError(error.id);
        }}
      />

      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="删除确认"
        message="确定要删除这个凭证吗？"
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteConfirm(null)}
      />
    </div>
  );
});

ProviderPoolPage.displayName = "ProviderPoolPage";
