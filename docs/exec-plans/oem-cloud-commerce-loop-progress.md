# OEM 云端商业闭环推进记录

## 主目标

把 Lime 客户端与 LimeCore 的云端购买链路收敛为单一 current 主链：套餐/充值下单 -> 真实支付 checkout -> 支付渠道 webhook -> 权益/积分/账本刷新 -> API Key 与网关使用。

## 当前阶段

- `current`：`useOemCloudAccess` 消费 `/client/cloud-activation`、订单、充值单、账本、支付配置与访问令牌，客户端不再本地兜底套餐、渠道或模型目录。
- `current`：支付完成后优先通过 LimeCore HTTPS `payments/{provider}/return` bridge 回到客户端，再 302 到 `lime://payment/return`，触发云端状态刷新和订单 watcher。
- `dead`：旧的客户端支付后台密钥配置入口已从设置页主链移除，管理型支付配置只保留在服务端管理面。

## 2026-04-28 进度

- 新增 `src/lib/oemCloudPaymentReturn.ts`，统一生成、解析、暂存和分发云端支付回跳事件。
- `useDeepLink` 识别 `lime://payment/return`，不走旧 `handle_deep_link` 命令，直接分发 current 云端商业刷新事件。
- `useOemCloudAccess` 在套餐购买和积分充值 checkout 中传入 `successUrl` / `cancelUrl`，支付页回跳后自动刷新云端权益、积分余额与账本，并重新接上订单 watcher。
- 增加回归覆盖 deep link 分发、checkout 回跳 URL、支付回跳后刷新商业状态。

## 2026-04-28 追加进度

- LimeCore 新增公开 HTTPS bridge：`/api/v1/public/tenants/{tenantId}/payments/{provider}/return`，支持 GET 与 form POST。
- bridge 只组装并 302 到 `lime://payment/return`，不在回跳页确认支付；真实权益发放仍只由 provider webhook 驱动。
- Lime 客户端 checkout 回跳 URL 改为 HTTPS bridge，保留客户端 deep link 消费和状态刷新逻辑。
- Creem checkout 已接入官方 `success_url` 参数，成功回跳进入 HTTPS bridge；取消回跳不伪造本地结果，继续依赖 watcher 与 webhook 后的服务端状态。

## 下一刀

继续用真实渠道沙箱串一次 EPay / Stripe / Creem / Waffo，确认各渠道回跳是否都能回到 `lime://payment/return`，同时验证 webhook finalize 后客户端账本、积分和权益刷新一致。
