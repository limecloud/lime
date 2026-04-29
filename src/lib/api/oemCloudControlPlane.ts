import { resolveOemCloudRuntimeContext } from "./oemCloudRuntime";
import type { OemCloudCurrentSessionLike } from "@/lib/oemCloudSession";
import type {
  ModelAliasSource,
  ModelDeploymentSource,
  ModelManagementPlane,
  ModelModality,
  ModelRuntimeFeature,
  ModelTaskFamily,
} from "@/lib/types/modelRegistry";

export type OemCloudProviderSource = "local" | "oem_cloud";
export type OemCloudProviderOfferState =
  | "available_logged_out"
  | "available_subscribe_required"
  | "available_ready"
  | "available_quota_low"
  | "blocked"
  | "unavailable";
export type OemCloudPartnerHubAccessMode = "session" | "hub_token" | "api_key";
export type OemCloudPartnerHubConfigMode = "managed" | "hybrid" | "developer";
export type OemCloudPartnerHubModelsSource = "hub_catalog" | "manual";

export interface OemCloudTenant {
  id: string;
  name: string;
  slug: string;
}

export interface OemCloudUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl?: string;
  username?: string;
  passwordConfigured: boolean;
  roles: string[];
}

export interface OemCloudUserSession {
  id: string;
  tenantId: string;
  userId: string;
  provider: string;
  roles: string[];
  issuedAt: string;
  expiresAt: string;
}

export interface OemCloudAuthCatalogProvider {
  provider: string;
  displayName: string;
  authorizeUrl?: string;
  redirectUri?: string;
  scopes: string[];
  enabled: boolean;
  loginHint?: string;
}

export type OemCloudAuthStartupTrigger = "none" | "oauth";

export interface OemCloudAuthPolicy {
  required: boolean;
  startupTrigger: OemCloudAuthStartupTrigger;
  primaryProvider?: string;
}

export interface OemCloudPublicAuthCatalog {
  providers: OemCloudAuthCatalogProvider[];
  authPolicy: OemCloudAuthPolicy;
}

export interface OemCloudCurrentSession extends Omit<
  OemCloudCurrentSessionLike,
  "tenant" | "user" | "session"
> {
  token?: string;
  tenant: OemCloudTenant;
  user: OemCloudUser;
  session: OemCloudUserSession;
}

export interface OemCloudFeatureFlags {
  oauthLoginEnabled: boolean;
  emailCodeLoginEnabled: boolean;
  passwordLoginEnabled: boolean;
  profileEditable: boolean;
  hubTokensEnabled: boolean;
  billingEnabled: boolean;
  referralEnabled: boolean;
  gatewayEnabled: boolean;
}

export interface OemCloudProviderPreference {
  tenantId: string;
  userId: string;
  providerSource: OemCloudProviderSource;
  providerKey: string;
  defaultModel?: string;
  needsValidation: boolean;
  lastValidatedAt?: string;
  updatedAt: string;
}

export interface OemCloudSceneSkillTemplate {
  id: string;
  title: string;
  description?: string;
  prompt: string;
}

export interface OemCloudCustomScene {
  id?: string;
  title: string;
  summary?: string;
  linkedEntryId: string;
  placeholder?: string;
  templates: OemCloudSceneSkillTemplate[];
  enabled?: boolean;
}

export interface OemCloudSceneSkillPreference {
  tenantId: string;
  userId: string;
  orderedEntryIds: string[];
  hiddenEntryIds: string[];
  customScenes: OemCloudCustomScene[];
  updatedAt?: string;
}

export interface UpdateClientSceneSkillPreferencePayload {
  orderedEntryIds: string[];
  hiddenEntryIds: string[];
  customScenes: OemCloudCustomScene[];
}

export interface OemCloudProviderOfferSummary {
  providerKey: string;
  displayName: string;
  source: OemCloudProviderSource;
  state: OemCloudProviderOfferState;
  logoUrl?: string;
  description?: string;
  supportUrl?: string;
  visible: boolean;
  loggedIn: boolean;
  accountStatus: string;
  subscriptionStatus: string;
  quotaStatus: string;
  canInvoke: boolean;
  defaultModel?: string;
  effectiveAccessMode: OemCloudPartnerHubAccessMode;
  apiKeyModeEnabled: boolean;
  tenantOverrideApplied: boolean;
  configMode: OemCloudPartnerHubConfigMode;
  modelsSource: OemCloudPartnerHubModelsSource;
  developerAccessVisible: boolean;
  availableModelCount: number;
  fallbackToLocalAllowed: boolean;
  currentPlan?: string;
  creditsSummary?: string;
  statusReason?: string;
  tags?: string[];
}

export interface OemCloudProviderOfferAccess {
  offerId: string;
  accessMode: OemCloudPartnerHubAccessMode;
  sessionTokenRef?: string;
  hubTokenRef?: string;
  hubTokenEnabled: boolean;
  lastIssuedAt?: string;
}

export interface OemCloudProviderOfferDetail extends OemCloudProviderOfferSummary {
  loginHint?: string;
  subscribeHint?: string;
  unavailableHint?: string;
  access: OemCloudProviderOfferAccess;
}

export interface OemCloudProviderModelItem {
  id: string;
  offerId: string;
  modelId: string;
  displayName: string;
  description?: string;
  abilities: string[];
  task_families?: ModelTaskFamily[];
  input_modalities?: ModelModality[];
  output_modalities?: ModelModality[];
  runtime_features?: ModelRuntimeFeature[];
  deployment_source?: ModelDeploymentSource;
  management_plane?: ModelManagementPlane;
  canonical_model_id?: string;
  provider_model_id?: string;
  alias_source?: ModelAliasSource | null;
  recommended: boolean;
  status: string;
  sort: number;
  upstreamMapping?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudGatewayConfig {
  basePath?: string;
  llmBaseUrl?: string;
  openAIBaseUrl?: string;
  anthropicBaseUrl?: string;
  chatCompletionsPath?: string;
  authorizationHeader?: string;
  authorizationScheme?: string;
  tenantHeader?: string;
}

export interface OemCloudBootstrapResponse {
  session: OemCloudCurrentSession;
  app: {
    id: string;
    key: string;
    name: string;
    slug: string;
    category: string;
    description?: string;
    status: string;
    distributionChannels: string[];
  };
  authPolicy: OemCloudAuthPolicy;
  providerOffersSummary: OemCloudProviderOfferSummary[];
  providerPreference: OemCloudProviderPreference;
  skillCatalog?: unknown;
  serviceSkillCatalog?: unknown;
  siteAdapterCatalog?: unknown;
  sceneCatalog?: Array<{ id: string }>;
  features: OemCloudFeatureFlags;
  gateway?: OemCloudGatewayConfig;
  referral?: OemCloudReferralDashboard | null;
}

export interface SendClientAuthEmailCodePayload {
  identifier: string;
}

export interface SendAuthEmailCodeResponse {
  sent: boolean;
  maskedEmail: string;
  expiresInSeconds: number;
}

export interface VerifyClientAuthEmailCodePayload {
  identifier: string;
  code: string;
  displayName?: string;
  username?: string;
}

export interface ClientPasswordLoginPayload {
  identifier: string;
  password: string;
}

export type OemCloudDesktopAuthSessionStatus =
  | "pending_login"
  | "pending_consent"
  | "approved"
  | "denied"
  | "cancelled"
  | "consumed"
  | "expired";

export interface CreateClientDesktopAuthSessionPayload {
  clientId: string;
  provider?: string;
  desktopRedirectUri?: string;
}

export interface OemCloudDesktopAuthSessionStartResponse {
  authSessionId: string;
  deviceCode: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  provider?: string;
  desktopRedirectUri?: string;
  status: OemCloudDesktopAuthSessionStatus;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
  authorizeUrl: string;
}

export interface OemCloudDesktopAuthSessionStatusResponse {
  deviceCode: string;
  tenantId: string;
  clientId: string;
  clientName: string;
  provider?: string;
  desktopRedirectUri?: string;
  status: OemCloudDesktopAuthSessionStatus;
  expiresInSeconds: number;
  pollIntervalSeconds: number;
  sessionToken?: string;
  sessionExpiresAt?: string;
}

export interface UpdateClientProviderPreferencePayload {
  providerSource: OemCloudProviderSource;
  providerKey: string;
  defaultModel?: string;
}

export type OemCloudBillingCycle =
  | "monthly"
  | "yearly"
  | "one_time"
  | (string & {});

export interface OemCloudPlanBillingCycle {
  key: OemCloudBillingCycle;
  label: string;
  priceCents: number;
  credits: number;
  autoRenew: boolean;
  originalPriceCents?: number;
  discountPercent?: number;
}

export interface OemCloudPlanQuotaSummary {
  key: string;
  label: string;
  value: string;
  hint?: string;
}

export interface OemCloudPlanFeatureSection {
  key: string;
  title: string;
  description?: string;
  items: string[];
}

export interface OemCloudEntitlementPlan {
  id: string;
  tenantId: string;
  templateId?: string;
  key: string;
  name: string;
  description?: string;
  tagline?: string;
  badge?: string;
  priceMonthly: number;
  creditsMonthly: number;
  features: string[];
  status: string;
  recommended: boolean;
  sortOrder?: number;
  yearlyDiscountPercent?: number;
  oneTimeDiscountPercent?: number;
  billingCycles: OemCloudPlanBillingCycle[];
  quotaSummaries: OemCloudPlanQuotaSummary[];
  featureSections: OemCloudPlanFeatureSection[];
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudSubscription {
  id: string;
  tenantId: string;
  userId?: string;
  planId: string;
  planKey: string;
  planName?: string;
  status: string;
  billingCycle?: OemCloudBillingCycle;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  renewalAt?: string;
  autoRenew: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudCreditAccount {
  tenantId: string;
  userId?: string;
  balance: number;
  reserved: number;
  currency: string;
  updatedAt: string;
  lastTopUp?: string;
  lastSource?: string;
}

export interface OemCloudPaymentConfig {
  id: string;
  tenantId: string;
  provider: string;
  displayName: string;
  merchantIdMasked?: string;
  currency?: string;
  environment?: string;
  notifyUrl: string;
  returnUrl: string;
  enabled: boolean;
  methods: OemCloudPaymentMethodConfig[];
  providerOptions: Record<string, string>;
  credentialMasks: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudPaymentMethodConfig {
  key: string;
  displayName: string;
  paymentType?: string;
  paymentName?: string;
  icon?: string;
  enabled: boolean;
}

export interface OemCloudTopupPackage {
  id: string;
  tenantId: string;
  key: string;
  name: string;
  credits: number;
  priceCents: number;
  bonusCredits?: number;
  validDays: number;
  recommended: boolean;
  sortOrder?: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudCreditWallet {
  id: string;
  tenantId: string;
  userId: string;
  packageId?: string;
  packageName?: string;
  sourceType: string;
  sourceId?: string;
  grantedCredits: number;
  usedCredits: number;
  remainingCredits: number;
  status: string;
  effectiveAt: string;
  expiresAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudCreditTopupOrder {
  id: string;
  tenantId: string;
  userId: string;
  packageId?: string;
  packageName: string;
  creditsGranted: number;
  amountCents: number;
  paymentChannel: string;
  paymentMethod?: string;
  paymentReference?: string;
  checkoutUrl?: string;
  providerOrderId?: string;
  providerSessionId?: string;
  providerStatus?: string;
  status: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudUsageRecord {
  id: string;
  tenantId: string;
  userId: string;
  createdAt: string;
  usageType: string;
  triggerType: string;
  usageTag?: string;
  model: string;
  tokens: number;
  credits: number;
  durationMs: number;
  status: string;
}

export interface OemCloudMonthlyUsageSummary {
  freeCreditsUsed: number;
  freeCreditsLimit: number;
  topupCreditsUsed: number;
  topupCreditsLimit: number;
  subscriptionCreditsUsed: number;
  subscriptionCreditsLimit: number;
}

export interface OemCloudBillingSummary {
  currency: string;
  nextPaymentAmountCents: number;
  currentPeriodStart?: string;
  currentPeriodEnd?: string;
  renewalAt?: string;
  autoRenew: boolean;
  lastPaidAt?: string;
  totalSpentCents: number;
}

export interface OemCloudOrder {
  id: string;
  tenantId: string;
  userId: string;
  planId: string;
  planKey: string;
  planName: string;
  amountCents: number;
  creditsGranted: number;
  paymentChannel: string;
  paymentMethod?: string;
  billingCycle?: OemCloudBillingCycle;
  paymentReference?: string;
  checkoutUrl?: string;
  providerOrderId?: string;
  providerSessionId?: string;
  providerStatus?: string;
  status: string;
  paidAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudCreditsDashboard {
  creditAccount: OemCloudCreditAccount;
  subscription: OemCloudSubscription | null;
  topupPackages: OemCloudTopupPackage[];
  creditWallets: OemCloudCreditWallet[];
  creditOrders: OemCloudCreditTopupOrder[];
}

export interface OemCloudUsageDashboard {
  usageRecords: OemCloudUsageRecord[];
  monthlySummary: OemCloudMonthlyUsageSummary;
}

export interface OemCloudBillingDashboard {
  billingSummary: OemCloudBillingSummary;
  subscription: OemCloudSubscription | null;
  currentPlan: OemCloudEntitlementPlan | null;
  orders: OemCloudOrder[];
}

export interface OemCloudAccessToken {
  id: string;
  tenantId: string;
  userId: string;
  name: string;
  tokenMasked: string;
  tokenPrefix?: string;
  scopes: string[];
  allowedModels: string[];
  maxTokensPerRequest?: number;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  monthlyCreditLimit?: number;
  status: string;
  lastUsedAt?: string;
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
}

export interface OemCloudActiveAccessTokenResponse {
  hasActive: boolean;
  token: OemCloudAccessToken | null;
}

export interface CreateClientAccessTokenPayload {
  name: string;
  scopes?: string[];
  allowedModels?: string[];
  maxTokensPerRequest?: number;
  requestsPerMinute?: number;
  tokensPerMinute?: number;
  monthlyCreditLimit?: number;
}

export interface OemCloudCreateAccessTokenResponse {
  token: OemCloudAccessToken;
  rawToken?: string;
  apiKey?: string;
}

export interface OemCloudRotateAccessTokenResponse {
  previousToken: OemCloudAccessToken;
  newToken: OemCloudAccessToken;
  rawToken?: string;
  apiKey?: string;
}

export interface CreateClientOrderPayload {
  planId: string;
  paymentChannel: string;
  paymentMethod?: string;
  billingCycle?: OemCloudBillingCycle;
}

export interface CreatePaymentCheckoutPayload {
  paymentMethod?: string;
  successUrl?: string;
  cancelUrl?: string;
}

export interface OemCloudPaymentCheckoutResponse {
  orderKind: string;
  orderId: string;
  paymentChannel: string;
  paymentMethod?: string;
  paymentReference?: string;
  checkoutUrl?: string;
  status: string;
}

export interface CreateClientCreditTopupOrderPayload {
  packageId?: string;
  customCredits?: number;
  paymentChannel: string;
  paymentMethod?: string;
}

export type OemCloudReadinessStatus =
  | "no_payment_channel"
  | "no_plan_or_credits"
  | "payment_pending"
  | "no_api_key"
  | "no_models"
  | "ready"
  | "quota_low"
  | "subscription_expired"
  | "blocked";

export interface OemCloudReadinessStep {
  key: string;
  label: string;
  description?: string;
  done: boolean;
  action?: string;
}

export interface OemCloudReadiness {
  status: OemCloudReadinessStatus;
  title: string;
  description?: string;
  nextAction?: string;
  canInvoke: boolean;
  blockers: string[];
  steps: OemCloudReadinessStep[];
}

export interface OemCloudPaymentAction {
  kind: "plan_order" | "credit_topup_order" | (string & {});
  orderId: string;
  title: string;
  paymentChannel: string;
  paymentReference?: string;
  amountCents: number;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudActivationResponse {
  gateway: OemCloudGatewayConfig;
  llmBaseUrl: string;
  openAIBaseUrl: string;
  anthropicBaseUrl: string;
  readiness: OemCloudReadiness;
  pendingPayment: OemCloudPaymentAction | null;
  paymentConfigs: OemCloudPaymentConfig[];
  plans: OemCloudEntitlementPlan[];
  subscription: OemCloudSubscription | null;
  creditAccount: OemCloudCreditAccount | null;
  creditsDashboard: OemCloudCreditsDashboard | null;
  topupPackages: OemCloudTopupPackage[];
  usageDashboard: OemCloudUsageDashboard | null;
  billingDashboard: OemCloudBillingDashboard | null;
  providerOffers: OemCloudProviderOfferSummary[];
  selectedOffer: OemCloudProviderOfferDetail | null;
  providerModels: OemCloudProviderModelItem[];
  providerPreference: OemCloudProviderPreference | null;
  accessTokens: OemCloudAccessToken[];
  activeAccessToken: OemCloudActiveAccessTokenResponse | null;
  orders: OemCloudOrder[];
  creditTopupOrders: OemCloudCreditTopupOrder[];
}

export interface OemCloudReferralCode {
  id: string;
  tenantId: string;
  userId: string;
  code: string;
  landingUrl: string;
  channel?: string;
  status: string;
  disabledReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface OemCloudReferralPolicy {
  tenantId?: string;
  enabled: boolean;
  rewardCredits: number;
  referrerRewardCredits: number;
  inviteeRewardCredits: number;
  claimWindowDays: number;
  autoClaimEnabled: boolean;
  allowManualClaimFallback: boolean;
  landingPageHeadline?: string;
  landingPageRules?: string;
  riskReviewEnabled: boolean;
  updatedAt?: string;
}

export interface OemCloudReferralSummary {
  totalInvites: number;
  successfulInvites: number;
  totalRewardCredits: number;
  referrerRewardCreditsTotal: number;
  inviteeRewardCreditsTotal: number;
}

export interface OemCloudReferralInviteRelation {
  eventId?: string;
  code?: string;
  referrerUserId?: string;
  referrerEmail?: string;
  referrerName?: string;
  inviteeRewardCredits?: number;
  claimedAt?: string;
}

export interface OemCloudReferralShare {
  brandName: string;
  code: string;
  landingUrl: string;
  downloadUrl: string;
  shareText: string;
  headline?: string;
  rules?: string;
}

export interface OemCloudReferralDashboard {
  code: OemCloudReferralCode;
  policy: OemCloudReferralPolicy;
  summary: OemCloudReferralSummary;
  events: unknown[];
  rewards: unknown[];
  invitedBy: OemCloudReferralInviteRelation;
  share: OemCloudReferralShare;
}

export interface ClaimClientReferralPayload {
  code: string;
  inviteeEmail?: string;
  inviteeName?: string;
  claimMethod?: "auto" | "manual" | (string & {});
  entrySource?: "link" | "code_input" | (string & {});
  landingPath?: string;
  capturedAt?: string;
}

export interface OemCloudReferralClaimResponse {
  event?: unknown;
  reward?: unknown;
  rewards: unknown[];
  creditAccount: OemCloudCreditAccount | null;
  accountLedgers: unknown[];
}

interface OemCloudEnvelope<T> {
  code?: number;
  message?: string;
  data?: T;
}

export class OemCloudControlPlaneError extends Error {
  status: number;
  code?: number;

  constructor(message: string, options?: { status?: number; code?: number }) {
    super(message);
    this.name = "OemCloudControlPlaneError";
    this.status = options?.status ?? 0;
    this.code = options?.code;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function normalizeText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();
  return normalized ? normalized : undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function normalizeStringMap(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value)
      .map(([key, item]) => [key.trim(), normalizeText(item)] as const)
      .filter((entry): entry is readonly [string, string] =>
        Boolean(entry[0] && entry[1]),
      ),
  );
}

function normalizeTypedStringArray<T extends string>(
  value: unknown,
  acceptedValues: Set<T>,
): T[] {
  return Array.from(
    new Set(
      normalizeStringArray(value).filter((item): item is T =>
        acceptedValues.has(item as T),
      ),
    ),
  );
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function normalizeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

const COMPAT_REFERRAL_BRAND_NAME = "Lime";
const COMPAT_REFERRAL_DOWNLOAD_URL = "https://limeai.run";

const PARTNER_HUB_ACCESS_MODE_SET = new Set<OemCloudPartnerHubAccessMode>([
  "session",
  "hub_token",
  "api_key",
]);

const PARTNER_HUB_CONFIG_MODE_SET = new Set<OemCloudPartnerHubConfigMode>([
  "managed",
  "hybrid",
  "developer",
]);

const PARTNER_HUB_MODELS_SOURCE_SET = new Set<OemCloudPartnerHubModelsSource>([
  "hub_catalog",
  "manual",
]);

const MODEL_TASK_FAMILY_SET = new Set<ModelTaskFamily>([
  "chat",
  "reasoning",
  "vision_understanding",
  "image_generation",
  "image_edit",
  "speech_to_text",
  "text_to_speech",
  "embedding",
  "rerank",
  "moderation",
]);

const MODEL_MODALITY_SET = new Set<ModelModality>([
  "text",
  "image",
  "audio",
  "video",
  "file",
  "embedding",
  "json",
]);

const MODEL_RUNTIME_FEATURE_SET = new Set<ModelRuntimeFeature>([
  "streaming",
  "tool_calling",
  "json_schema",
  "reasoning",
  "prompt_cache",
  "responses_api",
  "chat_completions_api",
  "images_api",
]);

const MODEL_DEPLOYMENT_SOURCE_SET = new Set<ModelDeploymentSource>([
  "local",
  "user_cloud",
  "oem_cloud",
]);

const MODEL_MANAGEMENT_PLANE_SET = new Set<ModelManagementPlane>([
  "local_settings",
  "oem_control_plane",
  "hybrid",
]);

const MODEL_ALIAS_SOURCE_SET = new Set<ModelAliasSource>([
  "official",
  "relay",
  "oem",
  "local",
]);

function parsePartnerHubAccessMode(
  value: unknown,
  fallback?: OemCloudPartnerHubAccessMode,
): OemCloudPartnerHubAccessMode {
  const accessMode = normalizeText(value) as
    | OemCloudPartnerHubAccessMode
    | undefined;
  if (accessMode && PARTNER_HUB_ACCESS_MODE_SET.has(accessMode)) {
    return accessMode;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商接入模式格式非法");
}

function parsePartnerHubConfigMode(
  value: unknown,
  fallback?: OemCloudPartnerHubConfigMode,
): OemCloudPartnerHubConfigMode {
  const configMode = normalizeText(value) as
    | OemCloudPartnerHubConfigMode
    | undefined;
  if (configMode && PARTNER_HUB_CONFIG_MODE_SET.has(configMode)) {
    return configMode;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商配置模式格式非法");
}

function parsePartnerHubModelsSource(
  value: unknown,
  fallback?: OemCloudPartnerHubModelsSource,
): OemCloudPartnerHubModelsSource {
  const modelsSource = normalizeText(value) as
    | OemCloudPartnerHubModelsSource
    | undefined;
  if (modelsSource && PARTNER_HUB_MODELS_SOURCE_SET.has(modelsSource)) {
    return modelsSource;
  }

  if (fallback) {
    return fallback;
  }

  throw new OemCloudControlPlaneError("服务商模型来源格式非法");
}

function parseOptionalModelDeploymentSource(
  value: unknown,
): ModelDeploymentSource | undefined {
  const normalized = normalizeText(value) as ModelDeploymentSource | undefined;
  return normalized && MODEL_DEPLOYMENT_SOURCE_SET.has(normalized)
    ? normalized
    : undefined;
}

function parseOptionalModelManagementPlane(
  value: unknown,
): ModelManagementPlane | undefined {
  const normalized = normalizeText(value) as ModelManagementPlane | undefined;
  return normalized && MODEL_MANAGEMENT_PLANE_SET.has(normalized)
    ? normalized
    : undefined;
}

function parseOptionalModelAliasSource(
  value: unknown,
): ModelAliasSource | undefined {
  const normalized = normalizeText(value) as ModelAliasSource | undefined;
  return normalized && MODEL_ALIAS_SOURCE_SET.has(normalized)
    ? normalized
    : undefined;
}

function unwrapEnvelope<T>(payload: unknown): {
  data: T | undefined;
  message: string;
  code: number | undefined;
} {
  if (isRecord(payload)) {
    const code = typeof payload.code === "number" ? payload.code : undefined;
    const message = normalizeText(payload.message) ?? "";
    const data = payload.data as T | undefined;
    return {
      data,
      message,
      code,
    };
  }

  return {
    data: payload as T,
    message: "",
    code: undefined,
  };
}

function ensureRuntime() {
  const runtime = resolveOemCloudRuntimeContext();
  if (!runtime) {
    throw new OemCloudControlPlaneError(
      "缺少品牌云端配置，请先配置域名与租户。",
    );
  }
  return runtime;
}

async function requestControlPlane<T>(
  path: string,
  options?: {
    method?: "GET" | "POST" | "PUT" | "DELETE";
    payload?: unknown;
    auth?: boolean;
  },
): Promise<T> {
  const runtime = ensureRuntime();
  const method = options?.method ?? "GET";
  const headers: Record<string, string> = {
    Accept: "application/json",
  };

  if (options?.payload !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (options?.auth) {
    const token = normalizeText(runtime.sessionToken);
    if (!token) {
      throw new OemCloudControlPlaneError(
        "缺少品牌云端 Session Token，请先完成登录。",
      );
    }
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${runtime.controlPlaneBaseUrl}${path}`, {
    method,
    headers,
    body:
      options?.payload === undefined
        ? undefined
        : JSON.stringify(options.payload),
  });

  let payload: OemCloudEnvelope<T> | unknown = null;
  try {
    payload = (await response.json()) as OemCloudEnvelope<T>;
  } catch {
    payload = null;
  }

  const { data, message, code } = unwrapEnvelope<T>(payload);
  if (!response.ok) {
    throw new OemCloudControlPlaneError(
      message || `请求失败 (${response.status})`,
      {
        status: response.status,
        code,
      },
    );
  }

  if (data === undefined) {
    throw new OemCloudControlPlaneError(message || "服务端返回格式非法", {
      status: response.status,
      code,
    });
  }

  return data;
}

function parseCurrentSession(value: unknown): OemCloudCurrentSession {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("当前会话格式非法");
  }

  const tenant = isRecord(value.tenant) ? value.tenant : null;
  const user = isRecord(value.user) ? value.user : null;
  const session = isRecord(value.session) ? value.session : null;
  const tenantId = normalizeText(tenant?.id);
  const userId = normalizeText(user?.id);
  const sessionId = normalizeText(session?.id);

  if (!tenantId || !userId || !sessionId) {
    throw new OemCloudControlPlaneError("当前会话格式非法");
  }

  return {
    token: normalizeText(value.token),
    tenant: {
      id: tenantId,
      name: normalizeText(tenant?.name) ?? tenantId,
      slug: normalizeText(tenant?.slug) ?? tenantId,
    },
    user: {
      id: userId,
      email: normalizeText(user?.email) ?? "",
      displayName: normalizeText(user?.displayName) ?? userId,
      avatarUrl: normalizeText(user?.avatarUrl),
      username: normalizeText(user?.username),
      passwordConfigured: normalizeBoolean(user?.passwordConfigured),
      roles: normalizeStringArray(user?.roles),
    },
    session: {
      id: sessionId,
      tenantId: normalizeText(session?.tenantId) ?? tenantId,
      userId: normalizeText(session?.userId) ?? userId,
      provider: normalizeText(session?.provider) ?? "password",
      roles: normalizeStringArray(session?.roles),
      issuedAt: normalizeText(session?.issuedAt) ?? "",
      expiresAt: normalizeText(session?.expiresAt) ?? "",
    },
  };
}

function parseAuthCatalogProvider(value: unknown): OemCloudAuthCatalogProvider {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("登录方式格式非法");
  }

  const provider = normalizeText(value.provider);
  const displayName = normalizeText(value.displayName) ?? provider;
  if (!provider || !displayName) {
    throw new OemCloudControlPlaneError("登录方式格式非法");
  }

  return {
    provider,
    displayName,
    authorizeUrl: normalizeText(value.authorizeUrl) ?? undefined,
    redirectUri: normalizeText(value.redirectUri) ?? undefined,
    scopes: normalizeStringArray(value.scopes),
    enabled: normalizeBoolean(value.enabled, true),
    loginHint: normalizeText(value.loginHint) ?? undefined,
  };
}

function parseAuthPolicy(value: unknown): OemCloudAuthPolicy {
  const record = isRecord(value) ? value : {};
  const startupTrigger = normalizeText(record.startupTrigger);

  return {
    required: normalizeBoolean(record.required),
    startupTrigger: startupTrigger === "oauth" ? "oauth" : "none",
    primaryProvider: normalizeText(record.primaryProvider) ?? undefined,
  };
}

function parsePublicAuthCatalog(value: unknown): OemCloudPublicAuthCatalog {
  const record = isRecord(value) ? value : {};
  return {
    providers: Array.isArray(record.items)
      ? record.items.map(parseAuthCatalogProvider)
      : [],
    authPolicy: parseAuthPolicy(record.authPolicy),
  };
}

function parseProviderOfferSummary(
  value: unknown,
): OemCloudProviderOfferSummary {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("服务商摘要格式非法");
  }

  const providerKey = normalizeText(value.providerKey);
  const displayName = normalizeText(value.displayName);
  const source = normalizeText(value.source) as
    | OemCloudProviderSource
    | undefined;
  const state = normalizeText(value.state) as
    | OemCloudProviderOfferState
    | undefined;

  if (!providerKey || !displayName || !source || !state) {
    throw new OemCloudControlPlaneError("服务商摘要格式非法");
  }

  return {
    providerKey,
    displayName,
    source,
    state,
    logoUrl: normalizeText(value.logoUrl),
    description: normalizeText(value.description),
    supportUrl: normalizeText(value.supportUrl),
    visible: normalizeBoolean(value.visible),
    loggedIn: normalizeBoolean(value.loggedIn),
    accountStatus: normalizeText(value.accountStatus) ?? "anonymous",
    subscriptionStatus: normalizeText(value.subscriptionStatus) ?? "none",
    quotaStatus: normalizeText(value.quotaStatus) ?? "ok",
    canInvoke: normalizeBoolean(value.canInvoke),
    defaultModel: normalizeText(value.defaultModel),
    effectiveAccessMode: parsePartnerHubAccessMode(
      value.effectiveAccessMode,
      "session",
    ),
    apiKeyModeEnabled: normalizeBoolean(value.apiKeyModeEnabled),
    tenantOverrideApplied: normalizeBoolean(value.tenantOverrideApplied),
    configMode: parsePartnerHubConfigMode(value.configMode, "managed"),
    modelsSource: parsePartnerHubModelsSource(
      value.modelsSource,
      "hub_catalog",
    ),
    developerAccessVisible: normalizeBoolean(value.developerAccessVisible),
    availableModelCount:
      typeof value.availableModelCount === "number"
        ? value.availableModelCount
        : 0,
    fallbackToLocalAllowed: normalizeBoolean(value.fallbackToLocalAllowed),
    currentPlan: normalizeText(value.currentPlan),
    creditsSummary: normalizeText(value.creditsSummary),
    statusReason: normalizeText(value.statusReason),
    tags: normalizeStringArray(value.tags),
  };
}

function parseProviderOfferDetail(value: unknown): OemCloudProviderOfferDetail {
  const summary = parseProviderOfferSummary(value);
  const access = isRecord((value as Record<string, unknown>).access)
    ? ((value as Record<string, unknown>).access as Record<string, unknown>)
    : null;
  if (!access) {
    throw new OemCloudControlPlaneError("服务商详情格式非法");
  }

  const offerId = normalizeText(access.offerId);
  if (!offerId) {
    throw new OemCloudControlPlaneError("服务商详情格式非法");
  }

  return {
    ...summary,
    loginHint: normalizeText((value as Record<string, unknown>).loginHint),
    subscribeHint: normalizeText(
      (value as Record<string, unknown>).subscribeHint,
    ),
    unavailableHint: normalizeText(
      (value as Record<string, unknown>).unavailableHint,
    ),
    access: {
      offerId,
      accessMode: parsePartnerHubAccessMode(
        access.accessMode,
        summary.effectiveAccessMode,
      ),
      sessionTokenRef: normalizeText(access.sessionTokenRef),
      hubTokenRef: normalizeText(access.hubTokenRef),
      hubTokenEnabled: normalizeBoolean(access.hubTokenEnabled),
      lastIssuedAt: normalizeText(access.lastIssuedAt),
    },
  };
}

function parseProviderModelItem(value: unknown): OemCloudProviderModelItem {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("服务商模型格式非法");
  }

  const id = normalizeText(value.id);
  const offerId = normalizeText(value.offerId);
  const modelId = normalizeText(value.modelId);
  const displayName = normalizeText(value.displayName);
  if (!id || !offerId || !modelId || !displayName) {
    throw new OemCloudControlPlaneError("服务商模型格式非法");
  }

  return {
    id,
    offerId,
    modelId,
    displayName,
    description: normalizeText(value.description),
    abilities: normalizeStringArray(value.abilities),
    task_families: normalizeTypedStringArray(
      value.task_families,
      MODEL_TASK_FAMILY_SET,
    ),
    input_modalities: normalizeTypedStringArray(
      value.input_modalities,
      MODEL_MODALITY_SET,
    ),
    output_modalities: normalizeTypedStringArray(
      value.output_modalities,
      MODEL_MODALITY_SET,
    ),
    runtime_features: normalizeTypedStringArray(
      value.runtime_features,
      MODEL_RUNTIME_FEATURE_SET,
    ),
    deployment_source: parseOptionalModelDeploymentSource(
      value.deployment_source,
    ),
    management_plane: parseOptionalModelManagementPlane(value.management_plane),
    canonical_model_id: normalizeText(value.canonical_model_id),
    provider_model_id: normalizeText(value.provider_model_id),
    alias_source: parseOptionalModelAliasSource(value.alias_source) ?? null,
    recommended: normalizeBoolean(value.recommended),
    status: normalizeText(value.status) ?? "active",
    sort: typeof value.sort === "number" ? value.sort : 0,
    upstreamMapping: normalizeText(value.upstreamMapping),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseProviderPreference(value: unknown): OemCloudProviderPreference {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("默认服务商配置格式非法");
  }

  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  const providerSource = normalizeText(value.providerSource) as
    | OemCloudProviderSource
    | undefined;
  const providerKey = normalizeText(value.providerKey);
  if (!tenantId || !userId || !providerSource || !providerKey) {
    throw new OemCloudControlPlaneError("默认服务商配置格式非法");
  }

  return {
    tenantId,
    userId,
    providerSource,
    providerKey,
    defaultModel: normalizeText(value.defaultModel),
    needsValidation: normalizeBoolean(value.needsValidation),
    lastValidatedAt: normalizeText(value.lastValidatedAt),
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseSceneSkillTemplate(
  value: unknown,
): OemCloudSceneSkillTemplate | null {
  if (!isRecord(value)) {
    return null;
  }

  const id = normalizeText(value.id);
  const title = normalizeText(value.title);
  const prompt = normalizeText(value.prompt);
  if (!id || !title || !prompt) {
    return null;
  }

  return {
    id,
    title,
    description: normalizeText(value.description),
    prompt,
  };
}

function parseCustomScene(value: unknown): OemCloudCustomScene | null {
  if (!isRecord(value)) {
    return null;
  }

  const title = normalizeText(value.title);
  const linkedEntryId = normalizeText(value.linkedEntryId);
  const templates = Array.isArray(value.templates)
    ? value.templates
        .map(parseSceneSkillTemplate)
        .filter((item): item is OemCloudSceneSkillTemplate => Boolean(item))
    : [];
  if (!title || !linkedEntryId || templates.length === 0) {
    return null;
  }

  return {
    id: normalizeText(value.id),
    title,
    summary: normalizeText(value.summary),
    linkedEntryId,
    placeholder: normalizeText(value.placeholder),
    templates,
    enabled: normalizeBoolean(value.enabled),
  };
}

function parseSceneSkillPreference(
  value: unknown,
): OemCloudSceneSkillPreference {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("场景技能偏好格式非法");
  }

  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  if (!tenantId || !userId) {
    throw new OemCloudControlPlaneError("场景技能偏好格式非法");
  }

  return {
    tenantId,
    userId,
    orderedEntryIds: normalizeStringArray(value.orderedEntryIds),
    hiddenEntryIds: normalizeStringArray(value.hiddenEntryIds),
    customScenes: Array.isArray(value.customScenes)
      ? value.customScenes
          .map(parseCustomScene)
          .filter((item): item is OemCloudCustomScene => Boolean(item))
      : [],
    updatedAt: normalizeText(value.updatedAt),
  };
}

function parseFeatureFlags(value: unknown): OemCloudFeatureFlags {
  const record = isRecord(value) ? value : {};
  return {
    oauthLoginEnabled: normalizeBoolean(record.oauthLoginEnabled),
    emailCodeLoginEnabled: normalizeBoolean(record.emailCodeLoginEnabled),
    passwordLoginEnabled: normalizeBoolean(record.passwordLoginEnabled, true),
    profileEditable: normalizeBoolean(record.profileEditable),
    hubTokensEnabled: normalizeBoolean(record.hubTokensEnabled),
    billingEnabled: normalizeBoolean(record.billingEnabled),
    referralEnabled: normalizeBoolean(record.referralEnabled),
    gatewayEnabled: normalizeBoolean(record.gatewayEnabled),
  };
}

const DESKTOP_AUTH_SESSION_STATUS_SET =
  new Set<OemCloudDesktopAuthSessionStatus>([
    "pending_login",
    "pending_consent",
    "approved",
    "denied",
    "cancelled",
    "consumed",
    "expired",
  ]);

function parseDesktopAuthSessionStatus(
  value: unknown,
): OemCloudDesktopAuthSessionStatus {
  const status = normalizeText(value) as
    | OemCloudDesktopAuthSessionStatus
    | undefined;
  if (!status || !DESKTOP_AUTH_SESSION_STATUS_SET.has(status)) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  return status;
}

function parseDesktopAuthDuration(value: unknown, fieldName: string): number {
  const duration = normalizeNumber(value);
  if (duration === undefined) {
    throw new OemCloudControlPlaneError(`${fieldName} 格式非法`);
  }

  return duration;
}

function parseDesktopAuthSessionStartResponse(
  value: unknown,
): OemCloudDesktopAuthSessionStartResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("桌面授权会话创建结果格式非法");
  }

  const authSessionId = normalizeText(value.authSessionId);
  const deviceCode = normalizeText(value.deviceCode);
  const tenantId = normalizeText(value.tenantId);
  const clientId = normalizeText(value.clientId);
  const clientName = normalizeText(value.clientName);
  const authorizeUrl = normalizeText(value.authorizeUrl);

  if (
    !authSessionId ||
    !deviceCode ||
    !tenantId ||
    !clientId ||
    !clientName ||
    !authorizeUrl
  ) {
    throw new OemCloudControlPlaneError("桌面授权会话创建结果格式非法");
  }

  return {
    authSessionId,
    deviceCode,
    tenantId,
    clientId,
    clientName,
    provider: normalizeText(value.provider),
    desktopRedirectUri: normalizeText(value.desktopRedirectUri),
    status: parseDesktopAuthSessionStatus(value.status),
    expiresInSeconds: parseDesktopAuthDuration(
      value.expiresInSeconds,
      "桌面授权会话过期时间",
    ),
    pollIntervalSeconds: parseDesktopAuthDuration(
      value.pollIntervalSeconds,
      "桌面授权轮询间隔",
    ),
    authorizeUrl,
  };
}

function parseDesktopAuthSessionStatusResponse(
  value: unknown,
): OemCloudDesktopAuthSessionStatusResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  const deviceCode = normalizeText(value.deviceCode);
  const tenantId = normalizeText(value.tenantId);
  const clientId = normalizeText(value.clientId);
  const clientName = normalizeText(value.clientName);

  if (!deviceCode || !tenantId || !clientId || !clientName) {
    throw new OemCloudControlPlaneError("桌面授权状态格式非法");
  }

  return {
    deviceCode,
    tenantId,
    clientId,
    clientName,
    provider: normalizeText(value.provider),
    desktopRedirectUri: normalizeText(value.desktopRedirectUri),
    status: parseDesktopAuthSessionStatus(value.status),
    expiresInSeconds: parseDesktopAuthDuration(
      value.expiresInSeconds,
      "桌面授权状态过期时间",
    ),
    pollIntervalSeconds: parseDesktopAuthDuration(
      value.pollIntervalSeconds,
      "桌面授权轮询间隔",
    ),
    sessionToken: normalizeText(value.sessionToken),
    sessionExpiresAt: normalizeText(value.sessionExpiresAt),
  };
}

function parseGatewayConfig(value: unknown): OemCloudGatewayConfig {
  if (!isRecord(value)) {
    return {};
  }

  return {
    basePath: normalizeText(value.basePath),
    llmBaseUrl: normalizeText(value.llmBaseUrl),
    openAIBaseUrl: normalizeText(value.openAIBaseUrl),
    anthropicBaseUrl: normalizeText(value.anthropicBaseUrl),
    chatCompletionsPath: normalizeText(value.chatCompletionsPath),
    authorizationHeader: normalizeText(value.authorizationHeader),
    authorizationScheme: normalizeText(value.authorizationScheme),
    tenantHeader: normalizeText(value.tenantHeader),
  };
}

function parseBootstrap(value: unknown): OemCloudBootstrapResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("bootstrap 格式非法");
  }

  return {
    session: parseCurrentSession(value.session),
    app: {
      id:
        normalizeText(value.app && isRecord(value.app) ? value.app.id : "") ??
        "",
      key:
        normalizeText(value.app && isRecord(value.app) ? value.app.key : "") ??
        "",
      name:
        normalizeText(value.app && isRecord(value.app) ? value.app.name : "") ??
        "",
      slug:
        normalizeText(value.app && isRecord(value.app) ? value.app.slug : "") ??
        "",
      category:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.category : "",
        ) ?? "",
      description:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.description : "",
        ) ?? undefined,
      status:
        normalizeText(
          value.app && isRecord(value.app) ? value.app.status : "",
        ) ?? "",
      distributionChannels: normalizeStringArray(
        value.app && isRecord(value.app) ? value.app.distributionChannels : [],
      ),
    },
    authPolicy: parseAuthPolicy(value.authPolicy),
    providerOffersSummary: Array.isArray(value.providerOffersSummary)
      ? value.providerOffersSummary.map(parseProviderOfferSummary)
      : [],
    providerPreference: parseProviderPreference(value.providerPreference),
    skillCatalog: value.skillCatalog,
    serviceSkillCatalog: value.serviceSkillCatalog,
    siteAdapterCatalog: value.siteAdapterCatalog ?? value.site_adapter_catalog,
    sceneCatalog: Array.isArray(value.sceneCatalog)
      ? value.sceneCatalog
          .filter((item) => isRecord(item) && normalizeText(item.id))
          .map((item) => ({
            id: normalizeText((item as Record<string, unknown>).id) ?? "",
          }))
      : [],
    features: parseFeatureFlags(value.features),
    gateway: isRecord(value.gateway)
      ? parseGatewayConfig(value.gateway)
      : undefined,
    referral: isRecord(value.referral)
      ? parseReferralDashboard(value.referral)
      : null,
  };
}

function normalizeNumberOrZero(value: unknown): number {
  return normalizeNumber(value) ?? 0;
}

function normalizeOptionalNumber(value: unknown): number | undefined {
  return normalizeNumber(value);
}

function parseBillingCycle(value: unknown): OemCloudBillingCycle | undefined {
  return normalizeText(value) as OemCloudBillingCycle | undefined;
}

function parsePlanBillingCycle(value: unknown): OemCloudPlanBillingCycle {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("套餐周期格式非法");
  }

  const key = parseBillingCycle(value.key);
  const label = normalizeText(value.label);
  if (!key || !label) {
    throw new OemCloudControlPlaneError("套餐周期格式非法");
  }

  return {
    key,
    label,
    priceCents: normalizeNumberOrZero(value.priceCents),
    credits: normalizeNumberOrZero(value.credits),
    autoRenew: normalizeBoolean(value.autoRenew),
    originalPriceCents: normalizeOptionalNumber(value.originalPriceCents),
    discountPercent: normalizeOptionalNumber(value.discountPercent),
  };
}

function parsePlanQuotaSummary(value: unknown): OemCloudPlanQuotaSummary {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("套餐额度摘要格式非法");
  }

  const key = normalizeText(value.key);
  const label = normalizeText(value.label);
  const summaryValue = normalizeText(value.value);
  if (!key || !label || !summaryValue) {
    throw new OemCloudControlPlaneError("套餐额度摘要格式非法");
  }

  return {
    key,
    label,
    value: summaryValue,
    hint: normalizeText(value.hint),
  };
}

function parsePlanFeatureSection(value: unknown): OemCloudPlanFeatureSection {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("套餐能力分组格式非法");
  }

  const key = normalizeText(value.key);
  const title = normalizeText(value.title);
  if (!key || !title) {
    throw new OemCloudControlPlaneError("套餐能力分组格式非法");
  }

  return {
    key,
    title,
    description: normalizeText(value.description),
    items: normalizeStringArray(value.items),
  };
}

function parseEntitlementPlan(value: unknown): OemCloudEntitlementPlan {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("套餐格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const key = normalizeText(value.key);
  const name = normalizeText(value.name);
  if (!id || !tenantId || !key || !name) {
    throw new OemCloudControlPlaneError("套餐格式非法");
  }

  return {
    id,
    tenantId,
    templateId: normalizeText(value.templateId),
    key,
    name,
    description: normalizeText(value.description),
    tagline: normalizeText(value.tagline),
    badge: normalizeText(value.badge),
    priceMonthly: normalizeNumberOrZero(value.priceMonthly),
    creditsMonthly: normalizeNumberOrZero(value.creditsMonthly),
    features: normalizeStringArray(value.features),
    status: normalizeText(value.status) ?? "inactive",
    recommended: normalizeBoolean(value.recommended),
    sortOrder: normalizeOptionalNumber(value.sortOrder),
    yearlyDiscountPercent: normalizeOptionalNumber(value.yearlyDiscountPercent),
    oneTimeDiscountPercent: normalizeOptionalNumber(
      value.oneTimeDiscountPercent,
    ),
    billingCycles: Array.isArray(value.billingCycles)
      ? value.billingCycles.map(parsePlanBillingCycle)
      : [],
    quotaSummaries: Array.isArray(value.quotaSummaries)
      ? value.quotaSummaries.map(parsePlanQuotaSummary)
      : [],
    featureSections: Array.isArray(value.featureSections)
      ? value.featureSections.map(parsePlanFeatureSection)
      : [],
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseSubscription(value: unknown): OemCloudSubscription {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("订阅格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const planId = normalizeText(value.planId);
  const planKey = normalizeText(value.planKey);
  if (!id || !tenantId || !planId || !planKey) {
    throw new OemCloudControlPlaneError("订阅格式非法");
  }

  return {
    id,
    tenantId,
    userId: normalizeText(value.userId),
    planId,
    planKey,
    planName: normalizeText(value.planName),
    status: normalizeText(value.status) ?? "unknown",
    billingCycle: parseBillingCycle(value.billingCycle),
    currentPeriodStart: normalizeText(value.currentPeriodStart) ?? "",
    currentPeriodEnd: normalizeText(value.currentPeriodEnd) ?? "",
    renewalAt: normalizeText(value.renewalAt),
    autoRenew: normalizeBoolean(value.autoRenew),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseOptionalSubscription(
  value: unknown,
): OemCloudSubscription | null {
  if (!isRecord(value) || !normalizeText(value.id)) {
    return null;
  }

  const tenantId = normalizeText(value.tenantId);
  const planId = normalizeText(value.planId);
  const planKey = normalizeText(value.planKey);
  if (!tenantId || !planId || !planKey) {
    return null;
  }

  return parseSubscription(value);
}

function parseCreditAccount(value: unknown): OemCloudCreditAccount {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("积分账户格式非法");
  }

  const tenantId = normalizeText(value.tenantId);
  if (!tenantId) {
    throw new OemCloudControlPlaneError("积分账户格式非法");
  }

  return {
    tenantId,
    userId: normalizeText(value.userId),
    balance: normalizeNumberOrZero(value.balance),
    reserved: normalizeNumberOrZero(value.reserved),
    currency: normalizeText(value.currency) ?? "credits",
    updatedAt: normalizeText(value.updatedAt) ?? "",
    lastTopUp: normalizeText(value.lastTopUp),
    lastSource: normalizeText(value.lastSource),
  };
}

function parsePaymentConfig(value: unknown): OemCloudPaymentConfig {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("支付配置格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const provider = normalizeText(value.provider);
  const displayName = normalizeText(value.displayName);
  if (!id || !tenantId || !provider || !displayName) {
    throw new OemCloudControlPlaneError("支付配置格式非法");
  }

  return {
    id,
    tenantId,
    provider,
    displayName,
    merchantIdMasked: normalizeText(value.merchantIdMasked),
    currency: normalizeText(value.currency),
    environment: normalizeText(value.environment),
    notifyUrl: normalizeText(value.notifyUrl) ?? "",
    returnUrl: normalizeText(value.returnUrl) ?? "",
    enabled: normalizeBoolean(value.enabled),
    methods: Array.isArray(value.methods)
      ? value.methods.map(parsePaymentMethodConfig)
      : [],
    providerOptions: normalizeStringMap(value.providerOptions),
    credentialMasks: normalizeStringMap(value.credentialMasks),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parsePaymentMethodConfig(value: unknown): OemCloudPaymentMethodConfig {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("支付方式格式非法");
  }
  const key = normalizeText(value.key);
  const displayName = normalizeText(value.displayName);
  if (!key || !displayName) {
    throw new OemCloudControlPlaneError("支付方式格式非法");
  }
  return {
    key,
    displayName,
    paymentType: normalizeText(value.paymentType),
    paymentName: normalizeText(value.paymentName),
    icon: normalizeText(value.icon),
    enabled: normalizeBoolean(value.enabled),
  };
}

function parseTopupPackage(value: unknown): OemCloudTopupPackage {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("充值包格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const key = normalizeText(value.key);
  const name = normalizeText(value.name);
  if (!id || !tenantId || !key || !name) {
    throw new OemCloudControlPlaneError("充值包格式非法");
  }

  return {
    id,
    tenantId,
    key,
    name,
    credits: normalizeNumberOrZero(value.credits),
    priceCents: normalizeNumberOrZero(value.priceCents),
    bonusCredits: normalizeOptionalNumber(value.bonusCredits),
    validDays: normalizeNumberOrZero(value.validDays),
    recommended: normalizeBoolean(value.recommended),
    sortOrder: normalizeOptionalNumber(value.sortOrder),
    status: normalizeText(value.status) ?? "inactive",
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseCreditWallet(value: unknown): OemCloudCreditWallet {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("积分钱包格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  if (!id || !tenantId || !userId) {
    throw new OemCloudControlPlaneError("积分钱包格式非法");
  }

  return {
    id,
    tenantId,
    userId,
    packageId: normalizeText(value.packageId),
    packageName: normalizeText(value.packageName),
    sourceType: normalizeText(value.sourceType) ?? "unknown",
    sourceId: normalizeText(value.sourceId),
    grantedCredits: normalizeNumberOrZero(value.grantedCredits),
    usedCredits: normalizeNumberOrZero(value.usedCredits),
    remainingCredits: normalizeNumberOrZero(value.remainingCredits),
    status: normalizeText(value.status) ?? "unknown",
    effectiveAt: normalizeText(value.effectiveAt) ?? "",
    expiresAt: normalizeText(value.expiresAt),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseCreditTopupOrder(value: unknown): OemCloudCreditTopupOrder {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("充值订单格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  const packageName = normalizeText(value.packageName);
  if (!id || !tenantId || !userId || !packageName) {
    throw new OemCloudControlPlaneError("充值订单格式非法");
  }

  return {
    id,
    tenantId,
    userId,
    packageId: normalizeText(value.packageId),
    packageName,
    creditsGranted: normalizeNumberOrZero(value.creditsGranted),
    amountCents: normalizeNumberOrZero(value.amountCents),
    paymentChannel: normalizeText(value.paymentChannel) ?? "",
    paymentMethod: normalizeText(value.paymentMethod),
    paymentReference: normalizeText(value.paymentReference),
    checkoutUrl: normalizeText(value.checkoutUrl),
    providerOrderId: normalizeText(value.providerOrderId),
    providerSessionId: normalizeText(value.providerSessionId),
    providerStatus: normalizeText(value.providerStatus),
    status: normalizeText(value.status) ?? "unknown",
    paidAt: normalizeText(value.paidAt),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseMonthlyUsageSummary(value: unknown): OemCloudMonthlyUsageSummary {
  const record = isRecord(value) ? value : {};
  return {
    freeCreditsUsed: normalizeNumberOrZero(record.freeCreditsUsed),
    freeCreditsLimit: normalizeNumberOrZero(record.freeCreditsLimit),
    topupCreditsUsed: normalizeNumberOrZero(record.topupCreditsUsed),
    topupCreditsLimit: normalizeNumberOrZero(record.topupCreditsLimit),
    subscriptionCreditsUsed: normalizeNumberOrZero(
      record.subscriptionCreditsUsed,
    ),
    subscriptionCreditsLimit: normalizeNumberOrZero(
      record.subscriptionCreditsLimit,
    ),
  };
}

function parseUsageRecord(value: unknown): OemCloudUsageRecord {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("用量记录格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  if (!id || !tenantId || !userId) {
    throw new OemCloudControlPlaneError("用量记录格式非法");
  }

  return {
    id,
    tenantId,
    userId,
    createdAt: normalizeText(value.createdAt) ?? "",
    usageType: normalizeText(value.usageType) ?? "llm",
    triggerType: normalizeText(value.triggerType) ?? "request",
    usageTag: normalizeText(value.usageTag),
    model: normalizeText(value.model) ?? "",
    tokens: normalizeNumberOrZero(value.tokens),
    credits: normalizeNumberOrZero(value.credits),
    durationMs: normalizeNumberOrZero(value.durationMs),
    status: normalizeText(value.status) ?? "unknown",
  };
}

function parseBillingSummary(value: unknown): OemCloudBillingSummary {
  const record = isRecord(value) ? value : {};
  return {
    currency: normalizeText(record.currency) ?? "CNY",
    nextPaymentAmountCents: normalizeNumberOrZero(
      record.nextPaymentAmountCents,
    ),
    currentPeriodStart: normalizeText(record.currentPeriodStart),
    currentPeriodEnd: normalizeText(record.currentPeriodEnd),
    renewalAt: normalizeText(record.renewalAt),
    autoRenew: normalizeBoolean(record.autoRenew),
    lastPaidAt: normalizeText(record.lastPaidAt),
    totalSpentCents: normalizeNumberOrZero(record.totalSpentCents),
  };
}

function parseOrder(value: unknown): OemCloudOrder {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("套餐订单格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  const planId = normalizeText(value.planId);
  const planKey = normalizeText(value.planKey);
  const planName = normalizeText(value.planName);
  if (!id || !tenantId || !userId || !planId || !planKey || !planName) {
    throw new OemCloudControlPlaneError("套餐订单格式非法");
  }

  return {
    id,
    tenantId,
    userId,
    planId,
    planKey,
    planName,
    amountCents: normalizeNumberOrZero(value.amountCents),
    creditsGranted: normalizeNumberOrZero(value.creditsGranted),
    paymentChannel: normalizeText(value.paymentChannel) ?? "",
    paymentMethod: normalizeText(value.paymentMethod),
    billingCycle: parseBillingCycle(value.billingCycle),
    paymentReference: normalizeText(value.paymentReference),
    checkoutUrl: normalizeText(value.checkoutUrl),
    providerOrderId: normalizeText(value.providerOrderId),
    providerSessionId: normalizeText(value.providerSessionId),
    providerStatus: normalizeText(value.providerStatus),
    status: normalizeText(value.status) ?? "unknown",
    paidAt: normalizeText(value.paidAt),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseCreditsDashboard(value: unknown): OemCloudCreditsDashboard {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("积分看板格式非法");
  }

  return {
    creditAccount: parseCreditAccount(value.creditAccount),
    subscription: parseOptionalSubscription(value.subscription),
    topupPackages: Array.isArray(value.topupPackages)
      ? value.topupPackages.map(parseTopupPackage)
      : [],
    creditWallets: Array.isArray(value.creditWallets)
      ? value.creditWallets.map(parseCreditWallet)
      : [],
    creditOrders: Array.isArray(value.creditOrders)
      ? value.creditOrders.map(parseCreditTopupOrder)
      : [],
  };
}

function parseUsageDashboard(value: unknown): OemCloudUsageDashboard {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("用量看板格式非法");
  }

  return {
    usageRecords: Array.isArray(value.usageRecords)
      ? value.usageRecords.map(parseUsageRecord)
      : [],
    monthlySummary: parseMonthlyUsageSummary(value.monthlySummary),
  };
}

function parseBillingDashboard(value: unknown): OemCloudBillingDashboard {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("账单看板格式非法");
  }

  return {
    billingSummary: parseBillingSummary(value.billingSummary),
    subscription: parseOptionalSubscription(value.subscription),
    currentPlan: parseOptionalPlan(value.currentPlan),
    orders: Array.isArray(value.orders) ? value.orders.map(parseOrder) : [],
  };
}

function parseAccessToken(value: unknown): OemCloudAccessToken {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("API Key 格式非法");
  }

  const id = normalizeText(value.id);
  const tenantId = normalizeText(value.tenantId);
  const userId = normalizeText(value.userId);
  const name = normalizeText(value.name);
  const tokenMasked = normalizeText(value.tokenMasked);
  if (!id || !tenantId || !userId || !name || !tokenMasked) {
    throw new OemCloudControlPlaneError("API Key 格式非法");
  }

  return {
    id,
    tenantId,
    userId,
    name,
    tokenMasked,
    tokenPrefix: normalizeText(value.tokenPrefix),
    scopes: normalizeStringArray(value.scopes),
    allowedModels: normalizeStringArray(value.allowedModels),
    maxTokensPerRequest: normalizeOptionalNumber(value.maxTokensPerRequest),
    requestsPerMinute: normalizeOptionalNumber(value.requestsPerMinute),
    tokensPerMinute: normalizeOptionalNumber(value.tokensPerMinute),
    monthlyCreditLimit: normalizeOptionalNumber(value.monthlyCreditLimit),
    status: normalizeText(value.status) ?? "unknown",
    lastUsedAt: normalizeText(value.lastUsedAt),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
    expiresAt: normalizeText(value.expiresAt) ?? "",
  };
}

function parseActiveAccessTokenResponse(
  value: unknown,
): OemCloudActiveAccessTokenResponse {
  const record = isRecord(value) ? value : {};
  return {
    hasActive: normalizeBoolean(record.hasActive),
    token: isRecord(record.token) ? parseAccessToken(record.token) : null,
  };
}

function parseCreateAccessTokenResponse(
  value: unknown,
): OemCloudCreateAccessTokenResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("创建 API Key 结果格式非法");
  }

  return {
    token: parseAccessToken(value.token),
    rawToken: normalizeText(value.rawToken),
    apiKey: normalizeText(value.apiKey),
  };
}

function parseRotateAccessTokenResponse(
  value: unknown,
): OemCloudRotateAccessTokenResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("轮换 API Key 结果格式非法");
  }

  return {
    previousToken: parseAccessToken(value.previousToken),
    newToken: parseAccessToken(value.newToken),
    rawToken: normalizeText(value.rawToken),
    apiKey: normalizeText(value.apiKey),
  };
}

function parsePaymentCheckoutResponse(
  value: unknown,
): OemCloudPaymentCheckoutResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("支付链接格式非法");
  }
  const orderKind = normalizeText(value.orderKind);
  const orderId = normalizeText(value.orderId);
  const paymentChannel = normalizeText(value.paymentChannel);
  if (!orderKind || !orderId || !paymentChannel) {
    throw new OemCloudControlPlaneError("支付链接格式非法");
  }
  return {
    orderKind,
    orderId,
    paymentChannel,
    paymentMethod: normalizeText(value.paymentMethod),
    paymentReference: normalizeText(value.paymentReference),
    checkoutUrl: normalizeText(value.checkoutUrl),
    status: normalizeText(value.status) ?? "pending",
  };
}

function parseReadinessStatus(value: unknown): OemCloudReadinessStatus {
  const status = normalizeText(value);
  switch (status) {
    case "no_payment_channel":
    case "no_plan_or_credits":
    case "payment_pending":
    case "no_api_key":
    case "no_models":
    case "ready":
    case "quota_low":
    case "subscription_expired":
    case "blocked":
      return status;
    default:
      return "blocked";
  }
}

function parseReadinessStep(value: unknown): OemCloudReadinessStep {
  const record = isRecord(value) ? value : {};
  return {
    key: normalizeText(record.key) ?? "unknown",
    label: normalizeText(record.label) ?? "未命名步骤",
    description: normalizeText(record.description),
    done: normalizeBoolean(record.done),
    action: normalizeText(record.action),
  };
}

function parseReadiness(value: unknown): OemCloudReadiness {
  const record = isRecord(value) ? value : {};
  return {
    status: parseReadinessStatus(record.status),
    title: normalizeText(record.title) ?? "云端状态未知",
    description: normalizeText(record.description),
    nextAction: normalizeText(record.nextAction),
    canInvoke: normalizeBoolean(record.canInvoke),
    blockers: normalizeStringArray(record.blockers),
    steps: Array.isArray(record.steps)
      ? record.steps.map(parseReadinessStep)
      : [],
  };
}

function parsePaymentAction(value: unknown): OemCloudPaymentAction | null {
  if (!isRecord(value)) {
    return null;
  }

  const orderId = normalizeText(value.orderId);
  const kind = normalizeText(value.kind);
  if (!orderId || !kind) {
    return null;
  }

  return {
    kind,
    orderId,
    title: normalizeText(value.title) ?? orderId,
    paymentChannel: normalizeText(value.paymentChannel) ?? "",
    paymentReference: normalizeText(value.paymentReference),
    amountCents: normalizeNumberOrZero(value.amountCents),
    status: normalizeText(value.status) ?? "unknown",
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseOptionalPlan(value: unknown): OemCloudEntitlementPlan | null {
  if (!isRecord(value) || !normalizeText(value.id)) {
    return null;
  }
  return parseEntitlementPlan(value);
}

function parseCloudActivation(value: unknown): OemCloudActivationResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("云端激活状态格式非法");
  }

  const creditsDashboard = isRecord(value.creditsDashboard)
    ? parseCreditsDashboard(value.creditsDashboard)
    : null;
  const usageDashboard = isRecord(value.usageDashboard)
    ? parseUsageDashboard(value.usageDashboard)
    : null;
  const billingDashboard = isRecord(value.billingDashboard)
    ? parseBillingDashboard(value.billingDashboard)
    : null;

  return {
    gateway: parseGatewayConfig(value.gateway),
    llmBaseUrl: normalizeText(value.llmBaseUrl) ?? "",
    openAIBaseUrl: normalizeText(value.openAIBaseUrl) ?? "",
    anthropicBaseUrl: normalizeText(value.anthropicBaseUrl) ?? "",
    readiness: parseReadiness(value.readiness),
    pendingPayment: parsePaymentAction(value.pendingPayment),
    paymentConfigs: Array.isArray(value.paymentConfigs)
      ? value.paymentConfigs.map(parsePaymentConfig)
      : [],
    plans: Array.isArray(value.plans)
      ? value.plans.map(parseEntitlementPlan)
      : [],
    subscription: parseOptionalSubscription(value.subscription),
    creditAccount: isRecord(value.creditAccount)
      ? parseCreditAccount(value.creditAccount)
      : null,
    creditsDashboard,
    topupPackages: Array.isArray(value.topupPackages)
      ? value.topupPackages.map(parseTopupPackage)
      : (creditsDashboard?.topupPackages ?? []),
    usageDashboard,
    billingDashboard,
    providerOffers: Array.isArray(value.providerOffers)
      ? value.providerOffers.map(parseProviderOfferSummary)
      : [],
    selectedOffer: isRecord(value.selectedOffer)
      ? parseProviderOfferDetail(value.selectedOffer)
      : null,
    providerModels: Array.isArray(value.providerModels)
      ? value.providerModels.map(parseProviderModelItem)
      : [],
    providerPreference: isRecord(value.providerPreference)
      ? parseProviderPreference(value.providerPreference)
      : null,
    accessTokens: Array.isArray(value.accessTokens)
      ? value.accessTokens.map(parseAccessToken)
      : [],
    activeAccessToken: isRecord(value.activeAccessToken)
      ? parseActiveAccessTokenResponse(value.activeAccessToken)
      : null,
    orders: Array.isArray(value.orders) ? value.orders.map(parseOrder) : [],
    creditTopupOrders: Array.isArray(value.creditTopupOrders)
      ? value.creditTopupOrders.map(parseCreditTopupOrder)
      : [],
  };
}

function parseReferralCode(value: unknown): OemCloudReferralCode {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("邀请代码格式非法");
  }

  const code = normalizeText(value.code);
  if (!code) {
    throw new OemCloudControlPlaneError("邀请代码格式非法");
  }

  return {
    id: normalizeText(value.id) ?? "",
    tenantId: normalizeText(value.tenantId) ?? "",
    userId: normalizeText(value.userId) ?? "",
    code,
    landingUrl: normalizeText(value.landingUrl) ?? "",
    channel: normalizeText(value.channel),
    status: normalizeText(value.status) ?? "active",
    disabledReason: normalizeText(value.disabledReason),
    createdAt: normalizeText(value.createdAt) ?? "",
    updatedAt: normalizeText(value.updatedAt) ?? "",
  };
}

function parseReferralPolicy(value: unknown): OemCloudReferralPolicy {
  const record = isRecord(value) ? value : {};
  return {
    tenantId: normalizeText(record.tenantId),
    enabled: normalizeBoolean(record.enabled, true),
    rewardCredits: normalizeNumberOrZero(record.rewardCredits),
    referrerRewardCredits: normalizeNumberOrZero(record.referrerRewardCredits),
    inviteeRewardCredits: normalizeNumberOrZero(record.inviteeRewardCredits),
    claimWindowDays: normalizeNumberOrZero(record.claimWindowDays),
    autoClaimEnabled: normalizeBoolean(record.autoClaimEnabled),
    allowManualClaimFallback: normalizeBoolean(
      record.allowManualClaimFallback,
      true,
    ),
    landingPageHeadline: normalizeText(record.landingPageHeadline),
    landingPageRules: normalizeText(record.landingPageRules),
    riskReviewEnabled: normalizeBoolean(record.riskReviewEnabled),
    updatedAt: normalizeText(record.updatedAt),
  };
}

function parseReferralSummary(value: unknown): OemCloudReferralSummary {
  const record = isRecord(value) ? value : {};
  return {
    totalInvites: normalizeNumberOrZero(record.totalInvites),
    successfulInvites: normalizeNumberOrZero(record.successfulInvites),
    totalRewardCredits: normalizeNumberOrZero(record.totalRewardCredits),
    referrerRewardCreditsTotal: normalizeNumberOrZero(
      record.referrerRewardCreditsTotal,
    ),
    inviteeRewardCreditsTotal: normalizeNumberOrZero(
      record.inviteeRewardCreditsTotal,
    ),
  };
}

function parseReferralInviteRelation(
  value: unknown,
): OemCloudReferralInviteRelation {
  const record = isRecord(value) ? value : {};
  return {
    eventId: normalizeText(record.eventId),
    code: normalizeText(record.code),
    referrerUserId: normalizeText(record.referrerUserId),
    referrerEmail: normalizeText(record.referrerEmail),
    referrerName: normalizeText(record.referrerName),
    inviteeRewardCredits: normalizeOptionalNumber(record.inviteeRewardCredits),
    claimedAt: normalizeText(record.claimedAt),
  };
}

function resolveReferralDownloadUrl(landingUrl: string): string {
  try {
    return new URL(landingUrl).origin;
  } catch {
    return COMPAT_REFERRAL_DOWNLOAD_URL;
  }
}

function buildCompatReferralShareText(params: {
  brandName: string;
  downloadUrl: string;
  code: string;
}): string {
  return `邀请你体验${params.brandName}，让AI做牛做马，我们来做牛人！前往 ${params.downloadUrl} 下载客户端，复制邀请码 ${params.code} 激活并注册账号参与内测`;
}

function parseReferralShare(
  value: unknown,
  code: OemCloudReferralCode,
  policy: OemCloudReferralPolicy,
): OemCloudReferralShare {
  const record = isRecord(value) ? value : {};
  const shareCode = normalizeText(record.code) ?? code.code;
  let landingUrl = normalizeText(record.landingUrl) ?? code.landingUrl;
  const brandName =
    normalizeText(record.brandName) ?? COMPAT_REFERRAL_BRAND_NAME;
  const downloadUrl =
    normalizeText(record.downloadUrl) ?? resolveReferralDownloadUrl(landingUrl);
  if (!landingUrl) {
    landingUrl = `${downloadUrl}/invite?code=${encodeURIComponent(shareCode)}`;
  }

  return {
    brandName,
    code: shareCode,
    landingUrl,
    downloadUrl,
    shareText:
      normalizeText(record.shareText) ??
      buildCompatReferralShareText({
        brandName,
        downloadUrl,
        code: shareCode,
      }),
    headline:
      normalizeText(record.headline) ??
      normalizeText(policy.landingPageHeadline),
    rules:
      normalizeText(record.rules) ?? normalizeText(policy.landingPageRules),
  };
}

function parseReferralDashboard(value: unknown): OemCloudReferralDashboard {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("邀请看板格式非法");
  }

  const code = parseReferralCode(value.code);
  const policy = parseReferralPolicy(value.policy);

  return {
    code,
    policy,
    summary: parseReferralSummary(value.summary),
    events: Array.isArray(value.events) ? value.events : [],
    rewards: Array.isArray(value.rewards) ? value.rewards : [],
    invitedBy: parseReferralInviteRelation(value.invitedBy),
    share: parseReferralShare(value.share, code, policy),
  };
}

function parseReferralClaimResponse(
  value: unknown,
): OemCloudReferralClaimResponse {
  if (!isRecord(value)) {
    throw new OemCloudControlPlaneError("邀请领取结果格式非法");
  }

  return {
    event: value.event,
    reward: value.reward,
    rewards: Array.isArray(value.rewards) ? value.rewards : [],
    creditAccount: isRecord(value.creditAccount)
      ? parseCreditAccount(value.creditAccount)
      : null,
    accountLedgers: Array.isArray(value.accountLedgers)
      ? value.accountLedgers
      : [],
  };
}

export function getConfiguredOemCloudTarget() {
  const runtime = ensureRuntime();
  return {
    baseUrl: runtime.baseUrl,
    tenantId: runtime.tenantId,
  };
}

export async function sendClientAuthEmailCode(
  tenantId: string,
  payload: SendClientAuthEmailCodePayload,
): Promise<SendAuthEmailCodeResponse> {
  return requestControlPlane<SendAuthEmailCodeResponse>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/email-code/send`,
    {
      method: "POST",
      payload,
    },
  );
}

export async function createClientDesktopAuthSession(
  tenantId: string,
  payload: CreateClientDesktopAuthSessionPayload,
): Promise<OemCloudDesktopAuthSessionStartResponse> {
  return parseDesktopAuthSessionStartResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/desktop/auth-sessions`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function pollClientDesktopAuthSession(
  deviceCode: string,
): Promise<OemCloudDesktopAuthSessionStatusResponse> {
  return parseDesktopAuthSessionStatusResponse(
    await requestControlPlane<unknown>(
      `/v1/public/desktop/auth-sessions/${encodeURIComponent(deviceCode)}/poll`,
      {
        method: "POST",
      },
    ),
  );
}

export async function getPublicAuthCatalog(
  tenantId: string,
): Promise<OemCloudPublicAuthCatalog> {
  return parsePublicAuthCatalog(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/auth-catalog`,
    ),
  );
}

export async function verifyClientAuthEmailCode(
  tenantId: string,
  payload: VerifyClientAuthEmailCodePayload,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/email-code/verify`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function loginClientByPassword(
  tenantId: string,
  payload: ClientPasswordLoginPayload,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/auth/password/login`,
      {
        method: "POST",
        payload,
      },
    ),
  );
}

export async function getClientBootstrap(
  tenantId: string,
): Promise<OemCloudBootstrapResponse> {
  return parseBootstrap(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/bootstrap`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientSession(
  tenantId: string,
): Promise<OemCloudCurrentSession> {
  return parseCurrentSession(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/session`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientSceneSkillPreferences(
  tenantId: string,
): Promise<OemCloudSceneSkillPreference> {
  return parseSceneSkillPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/scene-skill-preferences`,
      {
        auth: true,
      },
    ),
  );
}

export async function updateClientSceneSkillPreferences(
  tenantId: string,
  payload: UpdateClientSceneSkillPreferencePayload,
): Promise<OemCloudSceneSkillPreference> {
  return parseSceneSkillPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/scene-skill-preferences`,
      {
        method: "PUT",
        payload,
        auth: true,
      },
    ),
  );
}

export async function listClientProviderOffers(
  tenantId: string,
): Promise<OemCloudProviderOfferSummary[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseProviderOfferSummary)
    : [];
}

export async function getClientProviderOffer(
  tenantId: string,
  providerKey: string,
): Promise<OemCloudProviderOfferDetail> {
  return parseProviderOfferDetail(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers/${encodeURIComponent(providerKey)}`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientProviderOfferModels(
  tenantId: string,
  providerKey: string,
): Promise<OemCloudProviderModelItem[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-offers/${encodeURIComponent(providerKey)}/models`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseProviderModelItem)
    : [];
}

export async function getClientProviderPreference(
  tenantId: string,
): Promise<OemCloudProviderPreference> {
  return parseProviderPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-preferences`,
      {
        auth: true,
      },
    ),
  );
}

export async function updateClientProviderPreference(
  tenantId: string,
  payload: UpdateClientProviderPreferencePayload,
): Promise<OemCloudProviderPreference> {
  return parseProviderPreference(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/provider-preferences`,
      {
        method: "PUT",
        payload,
        auth: true,
      },
    ),
  );
}

export async function getClientCloudActivation(
  tenantId: string,
): Promise<OemCloudActivationResponse> {
  return parseCloudActivation(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/cloud-activation`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientPaymentConfigs(
  tenantId: string,
): Promise<OemCloudPaymentConfig[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/payment-configs`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parsePaymentConfig)
    : [];
}

export async function listClientPlans(
  tenantId: string,
): Promise<OemCloudEntitlementPlan[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/plans`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseEntitlementPlan)
    : [];
}

export async function getClientSubscription(
  tenantId: string,
): Promise<OemCloudSubscription> {
  return parseSubscription(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/subscription`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientCreditAccount(
  tenantId: string,
): Promise<OemCloudCreditAccount> {
  return parseCreditAccount(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/credits`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientCreditsDashboard(
  tenantId: string,
): Promise<OemCloudCreditsDashboard> {
  return parseCreditsDashboard(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/credits/dashboard`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientTopupPackages(
  tenantId: string,
): Promise<OemCloudTopupPackage[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/topup-packages`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseTopupPackage)
    : [];
}

export async function getClientUsageDashboard(
  tenantId: string,
): Promise<OemCloudUsageDashboard> {
  return parseUsageDashboard(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/usage/dashboard`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientBillingDashboard(
  tenantId: string,
): Promise<OemCloudBillingDashboard> {
  return parseBillingDashboard(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/billing/dashboard`,
      {
        auth: true,
      },
    ),
  );
}

export async function getClientReferralDashboard(
  tenantId: string,
): Promise<OemCloudReferralDashboard> {
  return parseReferralDashboard(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/referral`,
      {
        auth: true,
      },
    ),
  );
}

export async function claimClientReferral(
  tenantId: string,
  payload: ClaimClientReferralPayload,
): Promise<OemCloudReferralClaimResponse> {
  return parseReferralClaimResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/referrals/claim`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function getClientActiveAccessToken(
  tenantId: string,
): Promise<OemCloudActiveAccessTokenResponse> {
  return parseActiveAccessTokenResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/access-tokens/active`,
      {
        auth: true,
      },
    ),
  );
}

export async function listClientAccessTokens(
  tenantId: string,
): Promise<OemCloudAccessToken[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/access-tokens`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items)
    ? payload.items.map(parseAccessToken)
    : [];
}

export async function createClientAccessToken(
  tenantId: string,
  payload: CreateClientAccessTokenPayload,
): Promise<OemCloudCreateAccessTokenResponse> {
  return parseCreateAccessTokenResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/access-tokens`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function rotateClientAccessToken(
  tenantId: string,
  tokenId: string,
): Promise<OemCloudRotateAccessTokenResponse> {
  return parseRotateAccessTokenResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/access-tokens/${encodeURIComponent(tokenId)}/rotate`,
      {
        method: "POST",
        auth: true,
      },
    ),
  );
}

export async function revokeClientAccessToken(
  tenantId: string,
  tokenId: string,
): Promise<OemCloudAccessToken> {
  return parseAccessToken(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/access-tokens/${encodeURIComponent(tokenId)}/revoke`,
      {
        method: "POST",
        auth: true,
      },
    ),
  );
}

export async function listClientOrders(
  tenantId: string,
): Promise<OemCloudOrder[]> {
  const payload = await requestControlPlane<{ items?: unknown[] }>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/orders`,
    {
      auth: true,
    },
  );
  return Array.isArray(payload.items) ? payload.items.map(parseOrder) : [];
}

export async function getClientOrder(
  tenantId: string,
  orderId: string,
): Promise<OemCloudOrder> {
  return parseOrder(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/orders/${encodeURIComponent(orderId)}`,
      {
        auth: true,
      },
    ),
  );
}

export async function createClientOrder(
  tenantId: string,
  payload: CreateClientOrderPayload,
): Promise<OemCloudOrder> {
  return parseOrder(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/orders`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function createClientOrderCheckout(
  tenantId: string,
  orderId: string,
  payload: CreatePaymentCheckoutPayload = {},
): Promise<OemCloudPaymentCheckoutResponse> {
  return parsePaymentCheckoutResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/orders/${encodeURIComponent(orderId)}/checkout`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function getClientCreditTopupOrder(
  tenantId: string,
  orderId: string,
): Promise<OemCloudCreditTopupOrder> {
  return parseCreditTopupOrder(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/credit-topup-orders/${encodeURIComponent(orderId)}`,
      {
        auth: true,
      },
    ),
  );
}

export async function createClientCreditTopupOrder(
  tenantId: string,
  payload: CreateClientCreditTopupOrderPayload,
): Promise<OemCloudCreditTopupOrder> {
  return parseCreditTopupOrder(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/credit-topup-orders`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function createClientCreditTopupOrderCheckout(
  tenantId: string,
  orderId: string,
  payload: CreatePaymentCheckoutPayload = {},
): Promise<OemCloudPaymentCheckoutResponse> {
  return parsePaymentCheckoutResponse(
    await requestControlPlane<unknown>(
      `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/credit-topup-orders/${encodeURIComponent(orderId)}/checkout`,
      {
        method: "POST",
        payload,
        auth: true,
      },
    ),
  );
}

export async function logoutClient(tenantId: string): Promise<void> {
  await requestControlPlane<unknown>(
    `/v1/public/tenants/${encodeURIComponent(tenantId)}/client/logout`,
    {
      method: "POST",
      auth: true,
    },
  );
}
