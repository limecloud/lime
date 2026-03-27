# Lime 测试体系

> 面向 Lime 当前桌面端产品形态的测试入口与索引

## 概述

Lime 当前是一个本地优先的 Tauri 桌面应用，而不是单一前端项目或单一 API 服务。

测试体系需要同时覆盖：

- 前端界面与工作台交互
- Tauri 命令边界
- Rust 服务层与业务逻辑
- 数据库、文件系统与工作区状态
- Provider、协议转换与本地 HTTP Server
- 浏览器运行时、终端、OpenClaw 等桌面能力
- Agent Runtime 与真实模型行为
- macOS / Windows 平台差异

## 测试分层

```
┌─────────────────────────────────────────────────────────────────┐
│                     Lime 测试金字塔                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│                        ┌─────────┐                              │
│                        │  E2E    │  端到端测试                   │
│                        │  测试   │  (Tauri + 前端)               │
│                       ─┴─────────┴─                             │
│                      ┌─────────────┐                            │
│                      │   集成测试   │  API 服务器、凭证池         │
│                     ─┴─────────────┴─                           │
│                    ┌─────────────────┐                          │
│                    │     单元测试     │  转换器、Provider、工具   │
│                   ─┴─────────────────┴─                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## 目录结构

```
docs/test/
├── README.md                    # 本文件 - 测试体系概览
├── testing-strategy-2026.md     # 当前 Lime 主测试策略
├── unit-tests.md               # 单元测试指南
├── integration-tests.md        # 集成测试指南
├── e2e-tests.md               # 浏览器续测与 E2E 总览
├── agent-evaluation.md        # Agent 评估指南（核心文档）
├── harness-evals.md           # Harness eval 任务集与 runner 入口
└── test-cases/                # 测试用例模板
    ├── converter-tests.md     # 协议转换器测试用例
    ├── provider-tests.md      # Provider 测试用例
    └── agent-tests.md         # Agent 测试用例
```

## 文档索引

| 文档                                                             | 说明                         | 适用场景                              |
| ---------------------------------------------------------------- | ---------------------------- | ------------------------------------- |
| [testing-strategy-2026.md](testing-strategy-2026.md)             | 当前 Lime 测试体系建设建议   | 建立分层门禁、规划演进                |
| [unit-tests.md](unit-tests.md)                                   | 单元测试指南                 | 独立模块测试                          |
| [integration-tests.md](integration-tests.md)                     | 集成测试指南                 | 模块间协作测试                        |
| [e2e-tests.md](e2e-tests.md)                                     | 当前浏览器续测与 E2E 入口    | Playwright MCP / DevBridge 主路径验证 |
| [../aiprompts/playwright-e2e.md](../aiprompts/playwright-e2e.md) | 浏览器续测详细事实源         | 继续测试、复现、控制台与 Bridge 排障  |
| [agent-evaluation.md](agent-evaluation.md)                       | Agent 评估指南               | AI Agent 行为评估                     |
| [harness-evals.md](harness-evals.md)                             | Harness eval 任务集与 runner | Replay 样本、grader、nightly 摘要     |
| [test-cases/converter-tests.md](test-cases/converter-tests.md)   | 转换器测试用例               | OpenAI ↔ Claude 转换                  |
| [test-cases/provider-tests.md](test-cases/provider-tests.md)     | Provider 测试用例            | OAuth 和 API 调用                     |
| [test-cases/agent-tests.md](test-cases/agent-tests.md)           | Agent 测试用例               | Aster Agent 集成                      |

## 快速开始

### 运行 Rust 测试

```bash
cd src-tauri && cargo test
```

### 运行前端测试

```bash
npm test
```

### 运行本地智能校验

```bash
npm run verify:local
```

### 运行本地全量校验

```bash
npm run verify:local:full
```

### 浏览器模式桥接检查

```bash
npm run bridge:health -- --timeout-ms 120000
```

### 运行首条自包含 smoke

```bash
npm run smoke:workspace-ready
```

### 运行 Harness eval 摘要

```bash
npm run harness:eval
```

### 提升工作区 Replay 为仓库样本

```bash
npm run harness:eval:promote -- --session-id "session-123" --slug "pending-request-runtime"
```

### 运行 Harness eval 趋势报告

```bash
npm run harness:eval:trend
```

### 当前浏览器续测入口

当前仓库的浏览器模式 E2E / 续测文档分两层：

- `docs/test/e2e-tests.md`：总览、命令矩阵、适用边界
- `docs/aiprompts/playwright-e2e.md`：详细操作流程与 Playwright MCP 续测事实源

### 运行代码检查

```bash
# Rust
cd src-tauri && cargo clippy

# 前端
npm run lint
```

## 核心测试模块

| 模块          | 测试重点                   | 文档                                                |
| ------------- | -------------------------- | --------------------------------------------------- |
| 协议转换      | OpenAI ↔ Claude 转换正确性 | [converter-tests.md](test-cases/converter-tests.md) |
| Provider 系统 | OAuth 刷新、API 调用       | [provider-tests.md](test-cases/provider-tests.md)   |
| 凭证池        | 轮询、健康检查、负载均衡   | [integration-tests.md](integration-tests.md)        |
| Aster Agent   | 流式响应、工具调用         | [agent-tests.md](test-cases/agent-tests.md)         |

## 测试原则

基于 [Anthropic AI Agent 评估指南](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) 和 Orchids Bridge 项目实践：

1. **评估结果，而非路径** - Agent 可能找到更好的方法，不要过度约束执行路径
2. **平衡问题集** - 测试"应该做"和"不应该做"两种情况
3. **隔离测试环境** - 每个测试独立状态，避免测试间污染
4. **从 Bug 到测试** - 每个修复的 Bug 都应该有对应测试用例
5. **处理非确定性** - 使用 pass@k 和 pass^k 指标评估 Agent 行为
6. **多层防护** - 结合自动评估、监控、人工审查

## 评分器类型

| 类型           | 适用场景   | 优点         | 缺点             |
| -------------- | ---------- | ------------ | ---------------- |
| **代码评分器** | 确定性验证 | 快速、可复现 | 对有效变体脆弱   |
| **模型评分器** | 语义评估   | 灵活、可扩展 | 非确定性、需校准 |
| **人工评分器** | 复杂判断   | 金标准质量   | 昂贵、慢         |

## 评估指标

```
pass@k = P(至少 1 次成功 | k 次尝试) = 1 - (1 - p)^k
pass^k = P(全部成功 | k 次尝试) = p^k
```

- **pass@k**：适用于"找到一个解决方案就行"的场景
- **pass^k**：适用于"每次都必须成功"的场景
