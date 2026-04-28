# 云端套餐与支付边界收口执行计划

## 主目标

把套餐购买、支付、账单、用量明细统一收敛到 `limecore` 用户中心网页；Lime 客户端只保留会话状态、当前套餐、积分余额、待支付提醒和跳转入口。

## 事实源

- `current`：`limecore` control-plane 与 `apps/user-center-web` 的 `/pricing`、`/billing`、`/subscription`、`/credits`
- `current`：Lime 客户端 `useOemCloudAccess` 负责登录态、权益摘要、API Key、支付回跳同步
- `dead`：Lime 客户端内置套餐卡、充值包卡、用量图、账单表、直接创建购买订单的本地商业工作台

## 本轮进度

- 已将 Lime 设置页云端服务面收口为摘要卡 + 用户中心入口。
- 已从客户端设置页移除本地套餐购买、积分充值、用量明细和账单表渲染。
- 已从 `useOemCloudAccess` 返回面移除客户端直接创建套餐/充值订单的处理器。
- 已在 `limecore` 用户中心 `/billing` 补齐用量与账单 tab，使用真实 usage / credits / billing dashboard 和真实 checkout。
- 已将 `limecore` 用户中心 `/pricing` 文案从“模型价格”收敛为“套餐与价格”。
- 已让 Lime 客户端入口直达 `/billing?tab=usage` 与 `/billing?tab=billing`，并让用户中心 tab 与 URL 查询参数同步。
- 已从用户中心主导航移除独立“账单管理”菜单，保留 `/subscription` 直接路由作为旧链接可达页面，主导航收敛到 `/billing`。

## 下一刀

继续验证两个仓库的定向类型检查与回归测试；如果后续发现客户端仍存在套餐购买 UI 文案或旧 testid，应继续按 `dead` 删除，不再迁回客户端。
