# Lime 浏览器续测与 E2E 指南

> 本文只保留 Lime 当前仍有效的浏览器端 E2E 入口；详细操作与续测步骤以 `docs/aiprompts/playwright-e2e.md` 为准。

## 1. 当前事实源

### current

- `docs/aiprompts/playwright-e2e.md`：浏览器续测、Playwright MCP 交互、DevBridge 排障的唯一详细事实源
- `npm run tauri:dev:headless`：当前浏览器模式启动入口
- `npm run bridge:health -- --timeout-ms 120000`：当前 DevBridge 就绪检查入口
- `npm run test:bridge`：当前浏览器桥接最小自动校验入口
- `npm run smoke:workspace-ready`：当前自包含 smoke，覆盖 DevBridge 就绪与默认 workspace 基础链路
- `npm run smoke:browser-runtime`：当前自包含 smoke，覆盖 browser runtime 的启动、状态读取、最小动作与审计关联键
- `npm run smoke:site-adapters`：当前自包含 smoke，覆盖站点适配器目录状态、列表、推荐与检索主链
- `npm run smoke:agent-runtime-tool-surface`：当前自包含 smoke，覆盖 runtime inventory 到应用层透传、Runtime strip 与 HarnessStatusPanel 的 team/task current surface 派生
- `npm run smoke:agent-runtime-tool-surface-page`：当前真实页面 smoke，覆盖 onboarding 跳过、最小发送、工作台 `Runtime 能力摘要`，并确认旧页级黄提示不再回到主路径

### supplement

- `npm run bridge:e2e`：偏排障性质的脚本，不是仓库统一 E2E 标准
- `npm run smoke:social-workbench`：现有专项 smoke，但仍依赖人工前置状态，暂不等于“自包含主链路冒烟”

### deprecated

- `tauri-driver`：不再是当前仓库推荐的 E2E 方案
- `npm run test:e2e`：当前仓库已不存在，不应继续作为执行入口

## 2. 何时使用 E2E / 续测

以下场景优先走当前浏览器续测流程：

- 用户明确要求“继续测试”“继续复现”“继续用 Playwright MCP 验证”
- 需要复用已有页面状态或浏览器标签页
- 需要确认页面真实交互、控制台报错、DevBridge / mock fallback 行为
- 修改涉及前端页面主路径，而不是单一工具函数或纯后端逻辑

以下场景不要强行拉起整条 E2E：

- 只是模块级逻辑修改，可用单测或定向集成测试覆盖
- 只是 `safeInvoke`、mock、bridge 边界修改，且 `npm run test:bridge` 足以验证
- 只是命令注册 / 命令漂移问题，优先跑 `npm run test:contracts`

## 3. 当前标准流程

### 第 1 步：启动浏览器模式

```bash
npm run tauri:dev:headless
```

用途：

- 启动前端 dev server
- 启动 Tauri headless 环境
- 启动 DevBridge
- 让 Playwright MCP 可访问 `http://127.0.0.1:1420/`

### 第 2 步：等待桥接就绪

```bash
npm run bridge:health -- --timeout-ms 120000
```

用途：

- 等待 `http://127.0.0.1:3030/health` 可用
- 降低页面早于 DevBridge 就绪时的 `Failed to fetch` 噪音

### 第 3 步：使用 Playwright MCP 进入页面

标准入口：

- 打开 `http://127.0.0.1:1420/`
- 等待“正在加载...”消失
- 确认默认首页已出现
- 检查一次 `browser_console_messages(level=error)`

### 第 4 步：沿主路径做最小验证

当前优先验证以下路径：

1. 首页可加载，主导航可见
2. 社媒内容工作流可进入
3. 页面交互后控制台不新增关键 error
4. runtime inventory、Runtime strip、工作台 `Runtime 能力摘要` 与应用层透传对 team/task current tools 的展示保持一致，且旧页级黄提示不回流

详细点击路径、控制台检查要求、交接格式，以 `docs/aiprompts/playwright-e2e.md` 为准。

## 4. 当前命令矩阵

| 目标                   | 命令 / 入口                                    | 角色       | 说明                                            |
| ---------------------- | ---------------------------------------------- | ---------- | ----------------------------------------------- |
| 启动浏览器模式         | `npm run tauri:dev:headless`                   | current    | 当前标准启动命令                                |
| 等待 Bridge 就绪       | `npm run bridge:health -- --timeout-ms 120000` | current    | 当前标准健康检查                                |
| 校验桥接基础能力       | `npm run test:bridge`                          | current    | `safeInvoke` / mock / tauri-mock 最小自动校验   |
| Workspace 自包含 smoke | `npm run smoke:workspace-ready`                | current    | 验证 DevBridge、默认 workspace、路径回查链路    |
| Browser Runtime smoke  | `npm run smoke:browser-runtime`                | current    | 验证 browser runtime 最短主链与审计关联键       |
| Site Adapter smoke     | `npm run smoke:site-adapters`                  | current    | 验证站点适配器目录、推荐与检索最短主链          |
| Runtime Tool Surface smoke | `npm run smoke:agent-runtime-tool-surface` | current    | 验证 runtime inventory 到应用层透传 / Runtime strip / HarnessStatusPanel 的 current surface 派生 |
| Runtime Tool Surface page smoke | `npm run smoke:agent-runtime-tool-surface-page` | current    | 验证真实页面最小发送后工作台 `Runtime 能力摘要` 的缺口诊断，并确认旧页级黄提示已删除 |
| 校验跨层命令契约       | `npm run test:contracts`                       | current    | 检查前端命令、Rust 注册、catalog、mock 集合漂移 |
| 浏览器续测细则         | `docs/aiprompts/playwright-e2e.md`             | current    | Playwright MCP 唯一详细事实源                   |
| 专项 bridge 排障       | `npm run bridge:e2e`                           | supplement | 适合排障，不是统一门禁                          |
| 社媒内容专项 smoke     | `npm run smoke:social-workbench`               | supplement | 仍非自包含，不应冒充标准 E2E                    |
| 旧 E2E 命令            | `npm run test:e2e`                             | deprecated | 当前仓库不存在                                  |

## 5. 当前验证标准

一次有效的浏览器续测 / E2E 至少满足以下之一：

1. 主路径走通且控制台 error 归零
2. 主路径走通，且剩余错误已明确归类为非阻塞项
3. 已定位新的 bridge / mock / 命令注册缺口，并给出下一步最小修复点

## 6. 当前不做的假设

本文不再把以下内容当成当前标准：

- 假设仓库已接入本地 Playwright 测试目录与统一 `test:e2e` 命令
- 假设 `tauri-driver` 仍是推荐路径
- 假设浏览器 E2E 已进入 CI 标准门禁

当前浏览器最小 smoke 基线已经具备；后续是否继续补 terminal / server / 专项 smoke，以 `docs/test/testing-strategy-2026.md` 的剩余优先级为准。

## 7. 给后续 Agent 的交接要求

如果本轮没有完全收口，请至少留下：

- 当前页面 URL
- 已完成的业务步骤
- 控制台 error 数量
- 是否走到了真实 bridge 或 mock fallback
- 最新暴露的命令缺口
- 下一轮应先补 mock、bridge，还是命令注册
