# LimeCore 联动入口说明

当任务同时涉及 `lime` 客户端与服务端能力时，不要只在本仓库里猜测。

跨仓库协作主文档放在：

- 绝对路径：`/Users/coso/Documents/dev/ai/limecloud/limecore/docs/aiprompts/lime-limecore-collaboration.md`
- 在 `limecore` 仓库内的相对路径：`docs/aiprompts/lime-limecore-collaboration.md`

## 什么时候先读主文档

遇到下面这些任务时，默认先读 `limecore` 主文档：

- OEM 登录、Google 登录、desktop auth session
- 用户中心、个人资料、会话同步
- AI 服务商页、云端 Provider、默认来源、模型目录
- `client/bootstrap`、`client/session`、`client/profile`
- `client/skills`、`skillCatalog.entries`、`client/service-skills`
- Gateway、Scene、Service Skill 云配置同步
- 任何“客户端要不要本地维护一份服务端数据”的判断

## 为什么主文档放在 `limecore`

因为跨仓库联动里的正式事实源更多在服务端：

- 认证与会话
- 客户端 bootstrap
- `client/skills` 统一命令目录
- 用户资料与账户能力
- Provider Offer / 服务目录 / Scene Catalog
- Gateway 与云端运行时策略

客户端仓库更适合作为实现消费方，而不是这些能力的唯一背景事实源。

## 在 `lime` 仓库里继续优先看这些

读完主文档后，如果确认主要是客户端实现，再回到本仓库重点看：

- `src/hooks/useOemCloudAccess.ts`
- `src/lib/api/oemCloudControlPlane.ts`
- `src/lib/api/oemCloudRuntime.ts`
- `src/components/settings-v2/`
- `src/components/agent/`
- `src-tauri/`

## 默认工作原则

- 服务端已有接口时，优先补客户端接线
- 云事实源不要在客户端长期维护第二份
- `@` / 产品型 `/` 的统一目录优先看 `client/skills.entries`
- Lime 客户端必须保留 seeded / fallback 韧性兜底，不能只靠服务端在线返回
- 能走运行时配置和 `bootstrap.features` 的，不要写死在前端
- 用户界面不要直接暴露 “OEM” 技术概念
- `scene` 目录项要稳定提供 `sceneKey` 与 `linkedSkillId`。Lime 当前会用它把 `/scene-key` 解析到现有 `ServiceSkill` 启动链；若云端 run 创建前失败，客户端会自动回退到本地工作区 prompt 主链
