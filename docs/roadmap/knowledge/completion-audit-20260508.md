# Knowledge v2 完成度审计（2026-05-08）

## 审计结论

- 目标：完成整个 Knowledge v2，即把 Lime Knowledge 从 v1 项目资料主链升级为 `Agent Skills Builder Skill -> Agent Knowledge v0.6 document-first KnowledgePack -> compiled/splits -> Resolver -> 1 persona + N data GUI -> Agent Runtime` 的 current 端到端闭环，并完成文档、计划、README、Release Notes、验证证据与发布准备。
- 当前结论：**本地工程闭环基本完成（约 99%），整体真实交付约 97%，但不能标记整个目标完成。**
- 未完成项：真实长资料人工质量评测、真实用户 workspace 的 legacy fallback 清零后删除 / 停用 `knowledge_builder`、以及 GitHub commit / tag / push / Release 发布。
- 发布状态：当前 worktree 同时包含 Knowledge v2 与非 Knowledge 的 Design Canvas / layered-design 改动；用户本轮选择递交所有代码，版本已同步到 `1.31.0`，但 GitHub 仍只有 `v1.30.0` Release。发布前仍必须由用户明确确认并执行 Git 高风险操作。

## 成功标准拆解

| 成功标准 / 用户要求 | 具体证据 | 审计状态 |
| --- | --- | --- |
| 参考 Agent Skills Apache 核心标准，不发明 Lime 私有整理引擎 | `docs/roadmap/knowledge/prd-v2.md` §2B；9 个内置 `*-knowledge-builder/SKILL.md` 均写 `license: Apache-2.0` 与 `compatibility.agentKnowledge` | 已完成 |
| Agent Skills 负责怎么生产和维护知识，Agent Knowledge 负责产物和上下文安全进入 | `docs/roadmap/knowledge/prd-v2.md`、`README.md`、`RELEASE_NOTES.md` 均说明该分工 | 已完成 |
| 不只个人 IP，还要运营类知识库 | `src-tauri/resources/default-skills/content-operations-knowledge-builder/`、`private-domain-operations-knowledge-builder/`、`live-commerce-operations-knowledge-builder/`、`campaign-operations-knowledge-builder/` | 已完成 |
| Builder Skills 迁入 Lime 内置默认 Skills | `src-tauri/resources/default-skills/*knowledge-builder/`、`src-tauri/src/skills/default_skills.rs`、seeded SkillCatalog 投影 | 已完成 |
| `knowledge_compile_pack` 调用 Builder Skill，而不是自建整理引擎 | `src-tauri/src/commands/knowledge_cmd.rs` Runtime Binding seam；`src-tauri/crates/knowledge/src/lib.rs` plan / compile / provenance | 已完成 |
| document-first KnowledgePack 结构 | `documents/<doc>.md`、`compiled/index.json`、`compiled/splits/<doc>/`、`runs/compile-*.json` | 已完成 |
| Resolver 只消费 KnowledgePack，不在回答阶段执行 Builder Skill | `src-tauri/crates/knowledge/src/lib.rs` Resolver；persona/data fenced wrapper；context run | 已完成 |
| 支持 `1 persona + N data` | `KnowledgePage` chooser、Inputbar metadata、`knowledge_pack.packs[]` | 已完成 |
| 真实 Provider E2E | `docs/roadmap/knowledge/evidence/provider-e2e-20260508.json`：`runtimeBinding.executed=true`、`status=succeeded`、25 个 splits、persona context warningCount=0 | 已完成 |
| 真实 Provider E2E 可复用验证入口 | `scripts/knowledge-provider-e2e.mjs`、`package.json` script `knowledge:provider-e2e`；脚本默认拒绝外部模型调用，必须显式 `--allow-external-provider` | 已完成 |
| Provider 输出不严格 JSON 时不污染主文档 | `src-tauri/crates/knowledge/src/lib.rs` 宽容解析；测试 `builder_runtime_parser_should_extract_loose_json_fenced_content` | 已完成 |
| README / Release Notes 更新 | `README.md`、`RELEASE_NOTES.md` 已记录真实 Provider E2E、Skills-first 与 Knowledge v2 范围 | 已完成 |
| PRD v2 与可视化文档更新 | `docs/roadmap/knowledge/prd-v2.md`、`docs/roadmap/knowledge/prd-v2-diagrams.md` | 已完成 |
| 执行计划更新 | `docs/exec-plans/agent-knowledge-implementation-plan.md` 已追加真实 Provider E2E 与完成度判断；该目录当前被 `.gitignore` 忽略 | 已完成但不在 Git 跟踪范围 |
| 真实长资料人审 | 已有 golden sample / fixture / 一次短资料真实 Provider E2E / `docs/roadmap/knowledge/evidence/provider-e2e-quality-review-20260508.md`；没有多类真实长资料人工评分表 | **未完成** |
| 真实用户 workspace legacy fallback 清零 | 仓库 workspace 扫描 `total=0`；真实用户 workspace 未提供，无法确认清零 | **未完成 / 需输入** |
| Knowledge-only 发布范围审计 | `scripts/knowledge-release-scope-report.mjs`、`docs/roadmap/knowledge/evidence/release-scope-report-20260508.json`；当前 dirty scope：knowledge=75、nonKnowledge=30、mixed=0、unknown=0 | 已完成审计，发布仍需确认 |
| GitHub commit / tag / push / Release | 当前没有 `v1.31.0` commit/tag/release；`v1.30.0` 已存在，版本文件已同步为 `1.31.0` | **未完成 / 需确认** |

## 本轮实证命令

```bash
node -e '<读取 docs/roadmap/knowledge/evidence/provider-e2e-20260508.json 的摘要>'
npm run knowledge:legacy-fallback-report -- --working-dir "." --json
CARGO_TARGET_DIR="/tmp/lime-knowledge-v2-provider-target" cargo test --manifest-path "src-tauri/Cargo.toml" -p lime-knowledge --no-default-features
git diff --check
git tag -l 'v1.30.0' 'v1.31.0' --sort=v:refname
gh release list --limit 5
```

关键输出摘要：

- Provider E2E evidence：`runtimeBinding.attempted=true`、`runtimeBinding.executed=true`、`runtimeBinding.status=succeeded`、`documentShape.startsWithMarkdownHeading=true`、`documentShape.startsWithJsonFence=false`、`artifacts.splitCount=25`、`context.warningCount=0`。
- Legacy fallback：当前仓库 workspace `.lime/knowledge/packs` 输出 `total=0`、`legacyFallback=0`、`staleBrief=0`、`needsCompile=0`。
- Rust：`lime-knowledge` crate `18 passed; 0 failed`。
- Diff hygiene：`git diff --check` 无输出。
- Release：GitHub 最新 release 仍是 `Lime v1.30.0`；本地版本文件已同步为 `1.31.0`；`v1.31.0` tag 不存在。
- Worktree：`docs/roadmap/knowledge/evidence/release-scope-report-20260508.json` 分类出 `knowledge=75`、`nonKnowledge=30`、`mixed=0`、`unknown=0`；不能把整体递交误标为 Knowledge-only 发布。

## 不能依赖的代理信号

- `lime-knowledge` 测试通过只能证明核心 crate 行为，不证明真实 Provider、GUI、发布和真实长资料质量都完成。
- `verify:gui-smoke` 过去通过只能证明 GUI 主路径可运行，不证明真实 Provider 输出质量。
- 仓库 workspace fallback 扫描 `total=0` 只能证明当前 repo 下没有历史 pack，不证明用户真实 workspace 已清零。
- Release Notes 已更新不等于 GitHub Release 已发布。

## 当前分类

- `current`：9 个 `*-knowledge-builder`、`knowledge_compile_pack` Runtime Binding、document-first KnowledgePack、`compiled/index.json` / `compiled/splits/`、persona/data Resolver、`1 persona + N data` metadata。
- `compat`：未知 / 历史 pack 的 `knowledge_builder` fallback。
- `deprecated`：`src-tauri/resources/default-skills/knowledge_builder/SKILL.md`，只允许委托 / 最小 document-first JSON 兜底，不允许继续扩展模板或 `compiled/brief.md` 主链。
- `dead`：新 pack 写入 `compiled/brief.md` 的 current 路径已经退出；旧 `compiled/brief.md` 只剩迁移期读取 fallback。

## 下一步所需输入

1. 如果要继续补质量：需要用户提供或确认可外发的真实长资料样本范围，并明确是否允许发送给外部 Provider。
2. 如果要清理 compat：需要真实用户 workspace 路径，用于运行 `npm run knowledge:legacy-fallback-report -- --working-dir <workspace> --json`。
3. 如果要发布：本轮已选择整体 dirty worktree 与 `1.31.0 / v1.31.0`，仍需要用户明确确认并亲自/授权执行 `git commit` / `git tag` / `git push` / GitHub Release。
