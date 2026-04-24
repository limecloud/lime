# Lime OEM 与本地模型协同策略

> 状态：提案
> 更新时间：2026-04-23
> 作用：定义 OEM 控制面、本地 provider pool、会话模型与任务级设置之间的协同规则。
> 依赖文档：
> - `./model-routing.md`
> - `./runtime-integration.md`
> - `docs/aiprompts/providers.md`

## 1. 固定目标

Lime 和参考运行时的关键差异在于：

- Lime 不只是本地模型客户端
- 也不只是 OEM 云端壳
- 它同时存在：
  - 本地 provider pool
  - OEM control plane
  - 会话模型设置
  - `service_models`

所以后续必须先固定：谁是约束面，谁是优化面。

## 2. 固定分工

### 2.1 OEM Control Plane

职责：

- 下发 offer
- 下发默认模型
- 下发 quota / access mode
- 约束是否允许本地 fallback

它是**业务约束面**。

### 2.2 本地 Routing Policy

职责：

- 在当前允许范围内做最佳选择
- 解释为什么选这个模型
- 在允许时做回退

它是**运行时优化面**。

## 3. 三种 OEM 模式

### 3.1 `managed`

含义：

- OEM 完全决定候选集
- 本地只能在 OEM 允许范围内执行

适用：

- OEM 托管会话
- OEM 统一计费
- OEM 不允许逃逸到本地 provider

### 3.2 `hybrid`

含义：

- OEM 给出推荐或首选
- 本地在特定条件下允许 fallback

适用：

- OEM 有首选模型，但本地也允许补位

### 3.3 `advisory`

含义：

- OEM 只给建议和默认推荐
- 本地仍有较大自主路由空间

适用：

- OEM 只做分发与品牌，不做强托管

## 4. 单 Offer / 单模型场景

这是必须明确支持的主路径。

### 4.1 OEM 只下发一个模型

系统应表达为：

- 当前 OEM 托管执行模型只有一个
- `candidate_count = 1`
- 不是“多模型自动优选”

### 4.2 OEM 只下发一个模型且不允许 fallback

系统只能：

- 服从 OEM
- 记录能力缺口
- 阻断不满足任务
- 告知用户受限原因

不能：

- 私自切本地模型
- 假装自动调度成功

### 4.3 OEM 只下发一个模型但允许 fallback

系统可在以下条件下回退本地：

1. 当前模型不可用
2. 当前模型超限
3. 当前模型能力不满足
4. 当前任务被明确标记允许本地逃逸

## 5. 建议的 OEM policy 字段

后续建议下发并统一消费：

| 字段 | 含义 |
| --- | --- |
| `routingMode` | `managed / hybrid / advisory` |
| `hardModelAllowlist` | OEM 硬允许候选 |
| `softModelPreferences` | OEM 推荐排序 |
| `quotaPolicy` | 配额与限额策略 |
| `fallbackToLocalAllowed` | 是否允许本地回退 |
| `allowedTaskKinds` | 允许任务种类 |
| `defaultBudgetClass` | 默认预算倾向 |

## 6. OEM 与设置的优先关系

固定优先级：

1. 用户本轮显式锁定
2. OEM `managed` 硬约束
3. 当前任务 `service_models`
4. OEM 软推荐
5. 会话默认设置
6. 自动策略

说明：

- `service_models` 不能越过 OEM `managed`
- `service_models` 在 `hybrid` 场景下可作为优选输入
- 自动策略永远排在设置与 OEM 之后

## 7. OEM 与本地 provider pool 的合并规则

候选合并时统一遵守：

1. 先解析 OEM 候选
2. 再解析本地可用 provider/model
3. 若 OEM 为 `managed`，只保留 OEM 候选
4. 若 OEM 为 `hybrid`，允许把本地候选加入 fallback chain
5. 若 OEM 为 `advisory`，本地候选可进入正式候选集

## 8. `service_models` 在 OEM 场景下如何工作

任务级设置必须继续生效，但要受 OEM 模式约束：

### 8.1 `managed`

- 若 `service_models` 指向 OEM 允许模型：正常生效
- 若指向 OEM 不允许模型：不可直接使用，必须解释并回退到 OEM 候选

### 8.2 `hybrid`

- `service_models` 可作为首选
- 若 OEM 不允许或当前模型失效，可回退

### 8.3 `advisory`

- `service_models` 正常参与优选

## 9. 当前必须避免的误区

1. OEM 默认模型直接等于最终执行模型。
2. 本地设置一定能覆盖 OEM 托管约束。
3. 单 OEM 模型场景继续对外讲“多模型智能选择”。
4. `service_models` 与 OEM 各自生效、互不解释。

## 10. 这一步如何服务主线

本文件的主线收益是：

**把 Lime 最容易失控的 OEM 与本地双面模型关系，固定成“约束面 + 优化面”的清晰分工。**
