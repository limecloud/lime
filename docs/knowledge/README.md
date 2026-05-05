# Knowledge 文档索引

> 当前实现事实源：`docs/roadmap/knowledge/prd.md` 与 `docs/exec-plans/agent-knowledge-implementation-plan.md`。本目录多数文件是早期方案或样例，只作为迁移参考，不作为 current 实现依据。

## Current

- `docs/roadmap/knowledge/prd.md`：项目资料模块的 current PRD、架构图、流程图、时序图和分阶段计划。
- `docs/exec-plans/agent-knowledge-implementation-plan.md`：Agent Knowledge 实现执行计划、进度日志和验证记录。

## Compat / 参考

- `lime-knowledge-base-construction-blueprint.md`：早期 KnowledgePack 构建蓝图，保留概念参考；目录结构和 UI 主路径以 current PRD 为准。
- `markdown-first-knowledge-pack-plan.md`：Markdown-first 方案探索，保留迁移参考。
- `lime-project-knowledge-base-solution.md`：项目知识库早期产品方案，保留用户场景参考。
- `agent-skills-and-knowledge-pack-boundary.md`：Skill 与 Knowledge 边界说明，仍可作为概念参考。

## Current 产品闭环

```text
File Manager / @项目资料 / 首页引导 / Agent 输出
  -> 添加或沉淀为项目资料
  -> 整理与人工确认
  -> 现有 Agent 输入框显式使用
  -> 生成新内容
  -> 继续沉淀为项目资料
```

固定规则：资料管理页是维护面板，不是独立聊天入口；项目资料使用必须回到现有 Agent。
