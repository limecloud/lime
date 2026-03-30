import { ImConfigPage } from "@/components/channels/ImConfigPage";

/**
 * 设置页里的渠道管理直接复用 IM 配置主页面，
 * 避免再维护一套平行的“概览 / 渠道 / 网关 / 日志”工作台。
 */
export function ChannelsSettings() {
  return <ImConfigPage />;
}
