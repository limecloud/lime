import { useState } from "react";
import {
  Heart,
  HeartOff,
  Trash2,
  RotateCcw,
  Activity,
  Power,
  PowerOff,
  Clock,
  AlertTriangle,
  RefreshCw,
  Settings,
  Upload,
  Lock,
  User,
  Globe,
  BarChart3,
  ChevronUp,
  Fingerprint,
  Copy,
  Check,
  Timer,
  MonitorDown,
} from "lucide-react";
import type {
  CredentialDisplay,
  CredentialSource,
} from "@/lib/api/providerPool";
import {
  getKiroCredentialFingerprint,
  switchKiroToLocal,
  type KiroFingerprintInfo,
  type SwitchToLocalResult,
  kiroCredentialApi,
} from "@/lib/api/providerPool";
import { usageApi, type UsageInfo } from "@/lib/api/usage";
import { UsageDisplay } from "./UsageDisplay";

interface CredentialCardProps {
  credential: CredentialDisplay;
  onToggle: () => void;
  onDelete: () => void;
  onReset: () => void;
  onCheckHealth: () => void;
  onRefreshToken?: () => void;
  onEdit: () => void;
  deleting: boolean;
  checkingHealth: boolean;
  refreshingToken?: boolean;
  /** 是否为 Kiro 凭证（支持用量查询） */
  isKiroCredential?: boolean;
  /** 是否为当前本地使用的凭证 */
  isLocalActive?: boolean;
  /** 切换到本地成功后的回调 */
  onSwitchToLocal?: () => void;
}

export function CredentialCard({
  credential,
  onToggle,
  onDelete,
  onReset,
  onCheckHealth,
  onRefreshToken,
  onEdit,
  deleting,
  checkingHealth,
  refreshingToken,
  isKiroCredential,
  isLocalActive,
  onSwitchToLocal,
}: CredentialCardProps) {
  // 用量查询状态
  const [usageExpanded, setUsageExpanded] = useState(false);
  const [usageLoading, setUsageLoading] = useState(false);
  const [usageInfo, setUsageInfo] = useState<UsageInfo | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);

  // 指纹信息状态（仅 Kiro 凭证）
  const [fingerprintInfo, setFingerprintInfo] =
    useState<KiroFingerprintInfo | null>(null);
  const [fingerprintLoading, setFingerprintLoading] = useState(false);
  const [fingerprintExpanded, setFingerprintExpanded] = useState(false);
  const [fingerprintCopied, setFingerprintCopied] = useState(false);

  // Kiro 增强状态管理
  const [kiroHealthScore, setKiroHealthScore] = useState<number | null>(null);
  const [kiroStatusLoading, setKiroStatusLoading] = useState(false);
  const [kiroRefreshing, setKiroRefreshing] = useState(false);
  const [kiroStatusExpanded, setKiroStatusExpanded] = useState(false);

  // 切换到本地状态
  const [switchingToLocal, setSwitchingToLocal] = useState(false);
  const [switchResult, setSwitchResult] = useState<SwitchToLocalResult | null>(
    null,
  );

  // 查询指纹信息
  const handleCheckFingerprint = async () => {
    if (fingerprintExpanded && fingerprintInfo) {
      // 已展开且有数据，直接折叠
      setFingerprintExpanded(false);
      return;
    }

    setFingerprintExpanded(true);
    setFingerprintLoading(true);

    try {
      const info = await getKiroCredentialFingerprint(credential.uuid);
      setFingerprintInfo(info);
    } catch (e) {
      console.error("获取指纹信息失败:", e);
    } finally {
      setFingerprintLoading(false);
    }
  };

  // 复制 Machine ID
  const handleCopyMachineId = async () => {
    if (!fingerprintInfo) return;
    try {
      await navigator.clipboard.writeText(fingerprintInfo.machine_id);
      setFingerprintCopied(true);
      setTimeout(() => setFingerprintCopied(false), 2000);
    } catch (e) {
      console.error("复制失败:", e);
    }
  };

  // 查询用量
  const handleCheckUsage = async () => {
    if (usageExpanded && usageInfo) {
      // 已展开且有数据，直接折叠
      setUsageExpanded(false);
      return;
    }

    setUsageExpanded(true);
    setUsageLoading(true);
    setUsageError(null);

    try {
      const info = await usageApi.getKiroUsage(credential.uuid);
      setUsageInfo(info);
    } catch (e) {
      setUsageError(e instanceof Error ? e.message : String(e));
    } finally {
      setUsageLoading(false);
    }
  };

  // 获取 Kiro 详细状态
  const handleCheckKiroStatus = async () => {
    if (kiroStatusExpanded) {
      setKiroStatusExpanded(false);
      return;
    }

    setKiroStatusExpanded(true);
    setKiroStatusLoading(true);

    try {
      const status = await kiroCredentialApi.getCredentialStatus(
        credential.uuid,
      );
      setKiroHealthScore(status.health_score || 0);
    } catch (e) {
      console.error("获取 Kiro 状态失败:", e);
    } finally {
      setKiroStatusLoading(false);
    }
  };

  // 快速刷新 Kiro Token
  const handleQuickRefresh = async () => {
    setKiroRefreshing(true);

    try {
      const result = await kiroCredentialApi.refreshCredential(credential.uuid);
      if (result.success) {
        // 刷新成功，可以显示成功消息
        console.log("Token 刷新成功:", result.message);
        // 可以触发页面数据刷新
        if (onRefreshToken) {
          onRefreshToken();
        }
      } else {
        console.error("Token 刷新失败:", result.error || result.message);
      }
    } catch (e) {
      console.error("Token 刷新异常:", e);
    } finally {
      setKiroRefreshing(false);
    }
  };

  // 切换到本地
  const handleSwitchToLocal = async () => {
    setSwitchingToLocal(true);
    setSwitchResult(null);

    try {
      const result = await switchKiroToLocal(credential.uuid);
      setSwitchResult(result);

      if (result.success) {
        console.log("切换到本地成功:", result.message);
        // 调用回调通知父组件刷新本地活跃凭证
        if (onSwitchToLocal) {
          onSwitchToLocal();
        }
      } else {
        console.error("切换到本地失败:", result.message);
      }

      // 3秒后自动清除结果提示
      setTimeout(() => {
        setSwitchResult(null);
      }, 5000);
    } catch (e) {
      console.error("切换到本地异常:", e);
      setSwitchResult({
        success: false,
        message: e instanceof Error ? e.message : String(e),
        requires_action: false,
        requires_kiro_restart: false,
      });
    } finally {
      setSwitchingToLocal(false);
    }
  };

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return "从未";
    const date = new Date(dateStr);
    return date.toLocaleString("zh-CN", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const getCredentialTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      kiro_oauth: "OAuth",
      gemini_oauth: "OAuth",
      qwen_oauth: "OAuth",
      antigravity_oauth: "OAuth",
      openai_key: "API Key",
      claude_key: "API Key",
      codex_oauth: "OAuth",
      claude_oauth: "OAuth",
      iflow_oauth: "OAuth",
      iflow_cookie: "Cookie",
    };
    return labels[type] || type;
  };

  const getSourceLabel = (source: CredentialSource) => {
    const labels: Record<
      CredentialSource,
      { text: string; icon: typeof User; color: string }
    > = {
      manual: {
        text: "手动添加",
        icon: User,
        color: "bg-sky-100 text-sky-700",
      },
      imported: {
        text: "导入",
        icon: Upload,
        color: "bg-emerald-100 text-emerald-700",
      },
      private: {
        text: "私有",
        icon: Lock,
        color: "bg-amber-100 text-amber-700",
      },
    };
    return labels[source] || labels.manual;
  };

  const sourceInfo = getSourceLabel(credential.source || "manual");
  const SourceIcon = sourceInfo.icon;

  const isHealthy = credential.is_healthy && !credential.is_disabled;
  const hasError = credential.error_count > 0;
  const isOAuth = credential.credential_type.includes("oauth");

  return (
    <div
      className={`rounded-xl border-2 transition-all hover:shadow-md ${
        credential.is_disabled
          ? "border-slate-200 bg-slate-50/80 opacity-70"
          : isLocalActive
            ? "border-amber-400 bg-gradient-to-r from-amber-50/80 to-white"
            : isHealthy
              ? "border-emerald-200 bg-gradient-to-r from-emerald-50/80 to-white"
              : "border-red-200 bg-gradient-to-r from-red-50/80 to-white"
      }`}
    >
      {/* 第一行：状态图标 + 名称 + 标签 + 操作按钮 */}
      <div className="flex items-center gap-4 p-4 pb-3">
        {/* Status Icon */}
        <div
          className={`shrink-0 rounded-full p-3 ${
            credential.is_disabled
              ? "bg-slate-100"
              : isHealthy
                ? "bg-emerald-100"
                : "bg-red-100"
          }`}
        >
          {credential.is_disabled ? (
            <PowerOff className="h-6 w-6 text-slate-400" />
          ) : isHealthy ? (
            <Heart className="h-6 w-6 text-emerald-600" />
          ) : (
            <HeartOff className="h-6 w-6 text-red-600" />
          )}
        </div>

        {/* Main Info */}
        <div className="flex-1 min-w-0">
          <h4 className="font-semibold text-lg truncate">
            {credential.name || `凭证 #${credential.uuid.slice(0, 8)}`}
          </h4>
          <div className="flex flex-wrap items-center gap-2 mt-1.5">
            <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
              {getCredentialTypeLabel(credential.credential_type)}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap ${sourceInfo.color}`}
            >
              <SourceIcon className="h-3 w-3 shrink-0" />
              {sourceInfo.text}
            </span>
            {credential.proxy_url && (
              <span
                className="rounded-full px-2.5 py-1 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap bg-orange-100 text-orange-700"
                title={`代理: ${credential.proxy_url}`}
              >
                <Globe className="h-3 w-3 shrink-0" />
                代理
              </span>
            )}
          </div>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={onToggle}
            className={`rounded-lg p-2.5 text-xs font-medium transition-colors ${
              credential.is_disabled
                ? "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
            title={credential.is_disabled ? "启用" : "禁用"}
          >
            {credential.is_disabled ? (
              <Power className="h-4 w-4" />
            ) : (
              <PowerOff className="h-4 w-4" />
            )}
          </button>

          <button
            onClick={onEdit}
            className="rounded-lg bg-sky-100 p-2.5 text-sky-700 transition-colors hover:bg-sky-200"
            title="编辑"
          >
            <Settings className="h-4 w-4" />
          </button>

          <button
            onClick={onCheckHealth}
            disabled={checkingHealth}
            className="rounded-lg bg-emerald-100 p-2.5 text-emerald-700 transition-colors hover:bg-emerald-200 disabled:opacity-50"
            title="检测"
          >
            <Activity
              className={`h-4 w-4 ${checkingHealth ? "animate-pulse" : ""}`}
            />
          </button>

          {isOAuth && onRefreshToken && (
            <button
              onClick={onRefreshToken}
              disabled={refreshingToken}
              className="rounded-lg bg-sky-100 p-2.5 text-sky-700 transition-colors hover:bg-sky-200 disabled:opacity-50"
              title="刷新 Token"
            >
              <RefreshCw
                className={`h-4 w-4 ${refreshingToken ? "animate-spin" : ""}`}
              />
            </button>
          )}

          {/* 指纹信息按钮 - 仅 Kiro 凭证显示 */}
          {isKiroCredential && (
            <button
              onClick={handleCheckFingerprint}
              disabled={fingerprintLoading}
              className={`rounded-lg p-2.5 transition-colors ${
                fingerprintExpanded
                  ? "bg-sky-200 text-sky-800"
                  : "bg-sky-100 text-sky-700 hover:bg-sky-200"
              } disabled:opacity-50`}
              title="查看设备指纹"
            >
              <Fingerprint
                className={`h-4 w-4 ${fingerprintLoading ? "animate-pulse" : ""}`}
              />
            </button>
          )}

          {/* 用量查询按钮 - 仅 Kiro 凭证显示 */}
          {isKiroCredential && (
            <button
              onClick={handleCheckUsage}
              disabled={usageLoading}
              className={`rounded-lg p-2.5 transition-colors ${
                usageExpanded
                  ? "bg-sky-200 text-sky-800"
                  : "bg-sky-100 text-sky-700 hover:bg-sky-200"
              } disabled:opacity-50`}
              title="查看用量"
            >
              <BarChart3
                className={`h-4 w-4 ${usageLoading ? "animate-pulse" : ""}`}
              />
            </button>
          )}

          {/* Kiro 详细状态按钮 - 仅 Kiro 凭证显示 */}
          {isKiroCredential && (
            <button
              onClick={handleCheckKiroStatus}
              disabled={kiroStatusLoading}
              className={`rounded-lg p-2.5 transition-colors ${
                kiroStatusExpanded
                  ? "bg-emerald-200 text-emerald-800"
                  : "bg-emerald-100 text-emerald-700 hover:bg-emerald-200"
              } disabled:opacity-50`}
              title="查看详细状态和健康分数"
            >
              <Activity
                className={`h-4 w-4 ${kiroStatusLoading ? "animate-pulse" : ""}`}
              />
            </button>
          )}

          {/* Kiro 快速刷新按钮 - 仅 Kiro 凭证显示 */}
          {isKiroCredential && (
            <button
              onClick={handleQuickRefresh}
              disabled={kiroRefreshing}
              className={`rounded-lg p-2.5 transition-colors ${
                kiroRefreshing
                  ? "bg-sky-200 text-sky-800"
                  : "bg-sky-100 text-sky-700 hover:bg-sky-200"
              } disabled:opacity-50`}
              title="快速刷新 Token"
            >
              <RefreshCw
                className={`h-4 w-4 ${kiroRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          )}

          {/* Kiro 切换到本地按钮 - 仅 Kiro 凭证显示 */}
          {isKiroCredential && (
            <button
              onClick={handleSwitchToLocal}
              disabled={switchingToLocal}
              className={`rounded-lg p-2.5 transition-colors ${
                switchingToLocal
                  ? "bg-amber-200 text-amber-800"
                  : "bg-amber-100 text-amber-700 hover:bg-amber-200"
              } disabled:opacity-50`}
              title="切换到本地 Kiro IDE"
            >
              <MonitorDown
                className={`h-4 w-4 ${switchingToLocal ? "animate-pulse" : ""}`}
              />
            </button>
          )}

          <button
            onClick={onReset}
            className="rounded-lg bg-orange-100 p-2.5 text-orange-700 transition-colors hover:bg-orange-200"
            title="重置"
          >
            <RotateCcw className="h-4 w-4" />
          </button>

          <button
            onClick={onDelete}
            disabled={deleting}
            className="rounded-lg bg-red-100 p-2.5 text-red-700 transition-colors hover:bg-red-200 disabled:opacity-50"
            title="删除"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* 第二行：统计信息 - 使用网格布局 */}
      <div className="hidden sm:block px-4 py-3 bg-muted/30 border-t border-border/30">
        <div className="grid grid-cols-5 gap-4">
          {/* 使用次数 */}
          <div className="flex items-center gap-3">
            <Activity className="h-5 w-5 text-sky-600 shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">使用次数</div>
              <div className="font-bold text-xl tabular-nums">
                {credential.usage_count}
              </div>
            </div>
          </div>

          {/* 错误次数 */}
          <div className="flex items-center gap-3">
            <AlertTriangle
              className={`h-5 w-5 shrink-0 ${hasError ? "text-amber-500" : "text-emerald-500"}`}
            />
            <div>
              <div className="text-xs text-muted-foreground">错误次数</div>
              <div className="font-bold text-xl tabular-nums">
                {credential.error_count}
              </div>
            </div>
          </div>

          {/* 最后使用 */}
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-muted-foreground shrink-0" />
            <div>
              <div className="text-xs text-muted-foreground">最后使用</div>
              <div className="font-medium text-sm">
                {formatDate(credential.last_used)}
              </div>
            </div>
          </div>

          {/* Token 有效期 - OAuth 凭证显示 */}
          {isOAuth ? (
            <div className="flex items-center gap-3">
              <Timer
                className={`h-5 w-5 shrink-0 ${
                  credential.token_cache_status?.expiry_time
                    ? credential.token_cache_status.is_expiring_soon
                      ? "text-amber-500"
                      : credential.token_cache_status.is_valid
                        ? "text-emerald-500"
                        : "text-red-500"
                    : "text-slate-400"
                }`}
              />
              <div>
                <div className="text-xs text-muted-foreground">
                  Token 有效期
                </div>
                {credential.token_cache_status?.expiry_time ? (
                  <div
                    className={`font-medium text-sm ${
                      credential.token_cache_status.is_expiring_soon
                        ? "text-amber-600"
                        : credential.token_cache_status.is_valid
                          ? "text-emerald-600"
                          : "text-red-600"
                    }`}
                  >
                    {formatDate(credential.token_cache_status.expiry_time)}
                  </div>
                ) : (
                  <div className="text-sm text-muted-foreground">--</div>
                )}
              </div>
            </div>
          ) : (
            <div /> /* 占位 */
          )}

          {/* 健康检查/健康分数 */}
          {isKiroCredential && kiroHealthScore !== null ? (
            // 为 Kiro 凭证显示健康分数
            <div className="flex items-center gap-3">
              <div
                className={`h-5 w-5 shrink-0 rounded-full flex items-center justify-center text-xs font-bold text-white ${
                  kiroHealthScore >= 80
                    ? "bg-emerald-500"
                    : kiroHealthScore >= 60
                      ? "bg-amber-500"
                      : kiroHealthScore >= 40
                        ? "bg-orange-500"
                        : "bg-red-500"
                }`}
              >
                ★
              </div>
              <div>
                <div className="text-xs text-muted-foreground">健康分数</div>
                <div
                  className={`font-bold text-xl tabular-nums ${
                    kiroHealthScore >= 80
                      ? "text-emerald-600"
                      : kiroHealthScore >= 60
                        ? "text-amber-600"
                        : kiroHealthScore >= 40
                          ? "text-orange-600"
                          : "text-red-600"
                  }`}
                >
                  {Math.round(kiroHealthScore)}
                </div>
              </div>
            </div>
          ) : credential.last_health_check_time ? (
            // 为其他凭证显示健康检查时间
            <div className="flex items-center gap-3">
              <Activity className="h-5 w-5 text-emerald-500 shrink-0" />
              <div>
                <div className="text-xs text-muted-foreground">健康检查</div>
                <div className="font-medium text-sm">
                  {formatDate(credential.last_health_check_time)}
                </div>
              </div>
            </div>
          ) : (
            <div /> /* 占位 */
          )}
        </div>
      </div>

      {/* 第三行：UUID */}
      <div className="px-4 py-2 border-t border-border/30">
        <p className="text-xs text-muted-foreground font-mono">
          {credential.uuid}
        </p>
      </div>

      {/* Mobile Stats - shown on small screens */}
      <div className="sm:hidden px-4 py-3 bg-muted/30 border-t border-border/30">
        <div className="grid grid-cols-2 gap-4">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-sky-600" />
            <span className="text-xs text-muted-foreground">使用:</span>
            <span className="font-semibold">{credential.usage_count}</span>
          </div>
          <div className="flex items-center gap-2">
            <AlertTriangle
              className={`h-4 w-4 ${hasError ? "text-amber-500" : "text-emerald-500"}`}
            />
            <span className="text-xs text-muted-foreground">错误:</span>
            <span className="font-semibold">{credential.error_count}</span>
          </div>
          <div className="flex items-center gap-2 col-span-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">最后使用:</span>
            <span className="text-sm">{formatDate(credential.last_used)}</span>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {credential.last_error_message && (
        <div
          className={`mx-4 mb-3 rounded-lg p-3 text-xs ${
            credential.last_error_message.includes("invalid_grant") ||
            credential.last_error_message.includes("重新授权") ||
            credential.last_error_message.includes("凭证已过期")
              ? "border border-amber-300 bg-amber-100"
              : "bg-red-100"
          }`}
        >
          <div
            className={`${
              credential.last_error_message.includes("invalid_grant") ||
              credential.last_error_message.includes("重新授权") ||
              credential.last_error_message.includes("凭证已过期")
                ? "text-amber-700"
                : "text-red-700"
            }`}
          >
            {credential.last_error_message.slice(0, 150)}
            {credential.last_error_message.length > 150 && "..."}
          </div>
          {/* 重新授权提示 */}
          {(credential.last_error_message.includes("invalid_grant") ||
            credential.last_error_message.includes("重新授权") ||
            credential.last_error_message.includes("凭证已过期")) && (
            <div className="mt-2 border-t border-amber-300 pt-2">
              <div className="flex items-center justify-between">
                <span className="font-medium text-amber-600">
                  💡 需要重新授权
                </span>
                {onRefreshToken && (
                  <button
                    onClick={onRefreshToken}
                    disabled={refreshingToken}
                    className="px-3 py-1 text-xs font-medium bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50 transition-colors"
                  >
                    {refreshingToken ? "刷新中..." : "尝试刷新"}
                  </button>
                )}
              </div>
              <p className="mt-1 text-amber-600/80">
                请删除此凭证并重新添加，或尝试刷新 Token
              </p>
            </div>
          )}
        </div>
      )}

      {/* 切换到本地结果提示 - 仅 Kiro 凭证 */}
      {isKiroCredential && switchResult && (
        <div
          className={`mx-4 mb-3 rounded-lg p-3 text-sm ${
            switchResult.success
              ? "bg-emerald-100 text-emerald-700"
              : "bg-red-100 text-red-700"
          }`}
        >
          <div className="flex items-center gap-2">
            {switchResult.success ? (
              <Check className="h-4 w-4 shrink-0" />
            ) : (
              <AlertTriangle className="h-4 w-4 shrink-0" />
            )}
            <span>{switchResult.message}</span>
          </div>
          {switchResult.success && switchResult.requires_kiro_restart && (
            <div className="mt-2 text-xs opacity-80">
              请重启 Kiro IDE 使配置生效
            </div>
          )}
        </div>
      )}

      {/* 指纹信息展示区域 - 仅 Kiro 凭证 */}
      {isKiroCredential && fingerprintExpanded && (
        <div className="mx-4 mb-4 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-sky-700">
              <Fingerprint className="h-4 w-4" />
              设备指纹
            </span>
            <button
              onClick={() => setFingerprintExpanded(false)}
              className="text-sky-500 hover:text-sky-700"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {fingerprintLoading ? (
            <div className="flex items-center gap-2 text-sm text-sky-600">
              <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
              加载中...
            </div>
          ) : fingerprintInfo ? (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">
                  Machine ID:
                </span>
                <code className="rounded border bg-white px-2 py-1 text-sm font-mono">
                  {fingerprintInfo.machine_id_short}...
                </code>
                <button
                  onClick={handleCopyMachineId}
                  className="rounded p-1.5 transition-colors hover:bg-sky-100"
                  title="复制完整 Machine ID"
                >
                  {fingerprintCopied ? (
                    <Check className="h-4 w-4 text-emerald-500" />
                  ) : (
                    <Copy className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              </div>
              <div className="flex items-center gap-6 text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">来源:</span>
                  <span
                    className={`px-2 py-0.5 rounded font-medium ${
                      fingerprintInfo.source === "profileArn"
                        ? "bg-sky-100 text-sky-700"
                        : fingerprintInfo.source === "clientId"
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-slate-100 text-slate-700"
                    }`}
                  >
                    {fingerprintInfo.source}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  <span className="text-muted-foreground">认证:</span>
                  <span
                    className={`px-2 py-0.5 rounded font-medium ${
                      fingerprintInfo.auth_method.toLowerCase() === "idc"
                        ? "bg-sky-100 text-sky-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {fingerprintInfo.auth_method}
                  </span>
                </span>
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              无法获取指纹信息
            </div>
          )}
        </div>
      )}

      {/* Kiro 详细状态面板 - 仅 Kiro 凭证 */}
      {isKiroCredential && kiroStatusExpanded && (
        <div className="mx-4 mb-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <Activity className="h-4 w-4" />
              Kiro 详细状态
            </span>
            <button
              onClick={() => setKiroStatusExpanded(false)}
              className="text-emerald-500 hover:text-emerald-700"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {kiroStatusLoading ? (
            <div className="flex items-center gap-2 text-sm text-emerald-600">
              <div className="animate-spin h-4 w-4 border-2 border-current border-t-transparent rounded-full" />
              加载中...
            </div>
          ) : kiroHealthScore !== null ? (
            <div className="space-y-4">
              {/* 健康分数详情 */}
              <div className="rounded-lg border border-emerald-200 bg-white p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-emerald-700">
                    健康分数
                  </span>
                  <div
                    className={`px-3 py-1 rounded-full text-sm font-bold ${
                      kiroHealthScore >= 80
                        ? "bg-emerald-100 text-emerald-700"
                        : kiroHealthScore >= 60
                          ? "bg-amber-100 text-amber-700"
                          : kiroHealthScore >= 40
                            ? "bg-orange-100 text-orange-700"
                            : "bg-red-100 text-red-700"
                    }`}
                  >
                    {Math.round(kiroHealthScore)} / 100
                  </div>
                </div>

                {/* 健康分数条 */}
                <div className="h-2 w-full rounded-full bg-slate-200">
                  <div
                    className={`h-2 rounded-full transition-all duration-300 ${
                      kiroHealthScore >= 80
                        ? "bg-emerald-500"
                        : kiroHealthScore >= 60
                          ? "bg-amber-500"
                          : kiroHealthScore >= 40
                            ? "bg-orange-500"
                            : "bg-red-500"
                    }`}
                    style={{
                      width: `${Math.max(0, Math.min(100, kiroHealthScore))}%`,
                    }}
                  ></div>
                </div>

                {/* 健康状态描述 */}
                <div className="mt-2 text-xs text-muted-foreground">
                  {credential.is_disabled
                    ? "凭证已被自动禁用，需手动重新启用"
                    : kiroHealthScore >= 80
                      ? "凭证状态良好，可正常使用"
                      : kiroHealthScore >= 60
                        ? "凭证状态一般，建议注意监控"
                        : kiroHealthScore >= 40
                          ? "凭证状态较差，可能有风险"
                          : "凭证状态异常，需要立即处理"}
                </div>
              </div>

              {/* 状态指标 */}
              <div className="grid grid-cols-2 gap-3">
                <div className="rounded-lg border border-emerald-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <Timer className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">
                      冷却时间
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    根据使用频率计算的建议等待时间
                  </div>
                </div>

                <div className="rounded-lg border border-emerald-200 bg-white p-3">
                  <div className="flex items-center gap-2 mb-1">
                    <BarChart3 className="h-4 w-4 text-emerald-600" />
                    <span className="text-sm font-medium text-emerald-700">
                      使用权重
                    </span>
                  </div>
                  <div className="text-sm text-muted-foreground">
                    在轮询池中的权重分配
                  </div>
                </div>
              </div>

              {/* 快速操作 */}
              <div className="flex gap-2 border-t border-emerald-200 pt-2">
                {credential.is_disabled ? (
                  // 已禁用凭证显示重新启用按钮
                  <button
                    onClick={onToggle}
                    className="flex-1 flex items-center justify-center gap-2 rounded-md bg-amber-600 px-3 py-2 text-sm text-white transition-colors hover:bg-amber-700"
                  >
                    <Power className="h-4 w-4" />
                    重新启用
                  </button>
                ) : (
                  // 正常凭证显示刷新和检查按钮
                  <>
                    <button
                      onClick={handleQuickRefresh}
                      disabled={kiroRefreshing}
                      className="flex-1 flex items-center justify-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded-md hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors text-sm"
                    >
                      <RefreshCw
                        className={`h-4 w-4 ${kiroRefreshing ? "animate-spin" : ""}`}
                      />
                      {kiroRefreshing ? "刷新中..." : "立即刷新"}
                    </button>
                    <button
                      onClick={onCheckHealth}
                      disabled={checkingHealth}
                      className="flex-1 flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-white px-3 py-2 text-sm text-emerald-700 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <Activity
                        className={`h-4 w-4 ${checkingHealth ? "animate-pulse" : ""}`}
                      />
                      {checkingHealth ? "检查中..." : "重新检查"}
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">
              无法获取状态信息，请重试
            </div>
          )}
        </div>
      )}

      {/* 用量信息展示区域 - 仅 Kiro 凭证 */}
      {isKiroCredential && usageExpanded && (
        <div className="mx-4 mb-4 rounded-lg border border-sky-200 bg-sky-50 p-4">
          <div className="flex items-center justify-between mb-3">
            <span className="flex items-center gap-2 text-sm font-medium text-sky-700">
              <BarChart3 className="h-4 w-4" />
              Kiro 用量
            </span>
            <button
              onClick={() => setUsageExpanded(false)}
              className="text-sky-500 hover:text-sky-700"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
          </div>

          {usageError ? (
            <div className="rounded-lg bg-red-100 p-3 text-sm text-red-700">
              {usageError}
            </div>
          ) : usageInfo ? (
            <UsageDisplay usage={usageInfo} loading={usageLoading} />
          ) : (
            <UsageDisplay
              usage={{
                subscriptionTitle: "",
                usageLimit: 0,
                currentUsage: 0,
                balance: 0,
                isLowBalance: false,
              }}
              loading={true}
            />
          )}
        </div>
      )}
    </div>
  );
}
