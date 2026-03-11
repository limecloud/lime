import { safeInvoke } from "@/lib/dev-bridge";
import type {
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  DiscordProbeResult,
  FeishuProbeResult,
  GatewayChannelStatusResponse,
  GatewayTunnelCreateResponse,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramProbeResult,
} from "./channelsRuntimeTypes";

export type {
  ChannelsConfig,
  CloudflaredInstallResult,
  CloudflaredInstallStatus,
  DiscordAccountConfig,
  DiscordActionsConfig,
  DiscordAgentComponentsConfig,
  DiscordBotConfig,
  DiscordChannelConfig,
  DiscordExecApprovalsConfig,
  DiscordGatewayAccountStatus,
  DiscordGatewayStatus,
  DiscordGuildConfig,
  DiscordIntentsConfig,
  DiscordProbeResult,
  DiscordThreadBindingsConfig,
  DiscordUiComponentsConfig,
  DiscordUiConfig,
  DiscordVoiceAutoJoinConfig,
  DiscordVoiceConfig,
  DiscordAutoPresenceConfig,
  FeishuBotConfig,
  FeishuAccountConfig,
  FeishuGatewayAccountStatus,
  FeishuGatewayStatus,
  FeishuGroupConfig,
  FeishuProbeResult,
  CloudflareTunnelConfig,
  GatewayChannelStatusResponse,
  GatewayConfig,
  GatewayTunnelCreateResponse,
  GatewayTunnelConfig,
  GatewayTunnelProbeResult,
  GatewayTunnelStatus,
  GatewayTunnelSyncWebhookResponse,
  TelegramBotConfig,
  TelegramGatewayAccountStatus,
  TelegramGatewayStatus,
  TelegramProbeResult,
} from "./channelsRuntimeTypes";

export async function gatewayChannelStart(params?: {
  channel?: "telegram" | "feishu" | "discord";
  accountId?: string;
  pollTimeoutSecs?: number;
}): Promise<GatewayChannelStatusResponse> {
  return safeInvoke("gateway_channel_start", {
    request: {
      channel: params?.channel ?? "telegram",
      account_id: params?.accountId?.trim() || undefined,
      poll_timeout_secs: params?.pollTimeoutSecs,
    },
  });
}

export async function gatewayChannelStop(params?: {
  channel?: "telegram" | "feishu" | "discord";
  accountId?: string;
}): Promise<GatewayChannelStatusResponse> {
  return safeInvoke("gateway_channel_stop", {
    request: {
      channel: params?.channel ?? "telegram",
      account_id: params?.accountId?.trim() || undefined,
    },
  });
}

export async function gatewayChannelStatus(params?: {
  channel?: "telegram" | "feishu" | "discord";
}): Promise<GatewayChannelStatusResponse> {
  return safeInvoke("gateway_channel_status", {
    request: {
      channel: params?.channel ?? "telegram",
    },
  });
}

export async function telegramChannelProbe(params?: {
  accountId?: string;
}): Promise<TelegramProbeResult> {
  return safeInvoke("telegram_channel_probe", {
    request: {
      account_id: params?.accountId?.trim() || undefined,
    },
  });
}

export async function feishuChannelProbe(params?: {
  accountId?: string;
}): Promise<FeishuProbeResult> {
  return safeInvoke("feishu_channel_probe", {
    request: {
      account_id: params?.accountId?.trim() || undefined,
    },
  });
}

export async function discordChannelProbe(params?: {
  accountId?: string;
}): Promise<DiscordProbeResult> {
  return safeInvoke("discord_channel_probe", {
    request: {
      account_id: params?.accountId?.trim() || undefined,
    },
  });
}

export async function gatewayTunnelProbe(): Promise<GatewayTunnelProbeResult> {
  return safeInvoke("gateway_tunnel_probe");
}

export async function gatewayTunnelDetectCloudflared(): Promise<CloudflaredInstallStatus> {
  return safeInvoke("gateway_tunnel_detect_cloudflared");
}

export async function gatewayTunnelInstallCloudflared(params?: {
  confirm?: boolean;
}): Promise<CloudflaredInstallResult> {
  return safeInvoke("gateway_tunnel_install_cloudflared", {
    request: {
      confirm: params?.confirm ?? false,
    },
  });
}

export async function gatewayTunnelCreate(params?: {
  tunnelName?: string;
  dnsName?: string;
  persist?: boolean;
}): Promise<GatewayTunnelCreateResponse> {
  return safeInvoke("gateway_tunnel_create", {
    request: {
      tunnel_name: params?.tunnelName?.trim() || undefined,
      dns_name: params?.dnsName?.trim() || undefined,
      persist: params?.persist ?? true,
    },
  });
}

export async function gatewayTunnelStart(): Promise<GatewayTunnelStatus> {
  return safeInvoke("gateway_tunnel_start");
}

export async function gatewayTunnelStop(): Promise<GatewayTunnelStatus> {
  return safeInvoke("gateway_tunnel_stop");
}

export async function gatewayTunnelRestart(): Promise<GatewayTunnelStatus> {
  return safeInvoke("gateway_tunnel_restart");
}

export async function gatewayTunnelStatus(): Promise<GatewayTunnelStatus> {
  return safeInvoke("gateway_tunnel_status");
}

export async function gatewayTunnelSyncWebhookUrl(params: {
  channel: "feishu";
  accountId?: string;
  webhookPath?: string;
  persist?: boolean;
}): Promise<GatewayTunnelSyncWebhookResponse> {
  return safeInvoke("gateway_tunnel_sync_webhook_url", {
    request: {
      channel: params.channel,
      account_id: params.accountId?.trim() || undefined,
      webhook_path: params.webhookPath?.trim() || undefined,
      persist: params.persist ?? true,
    },
  });
}
