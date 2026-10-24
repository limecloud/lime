# v1.169.0 发布执行计划

状态：准备与验证中；负责人：root；日期：2026-10-24。

## 目标与候选

- 用户要求发布 v1.169.0。基底为 main/v1.168.0：`c8364fd81cd3c4ad83a3644a24b47387bfac7022`；开始时远端 main 一致，目标标签本地与远端均不存在。
- 初始工作区 957 项：538 修改、261 删除、158 未跟踪路径。按发布规则全部作为候选，包括产品、测试、文档、脚本、schema、生成客户端、依赖锁及五语言资源；不默认丢弃既有修改。
- 本轮窄写集：package.json、packages/cli/package.json、lime-rs/Cargo.toml、lime-rs/Cargo.lock、RELEASE_NOTES.md、RELEASE_NOTES.en.md、本计划。其余候选先只读审阅及验证，必要修复另行记录。
- pnpm-lock.yaml 无应用显式版本，保留候选已有依赖变更；Forge 从 package.json 读取版本，App Server crate 使用 workspace 版本。不新增重复版本事实源。
- 完整候选文件清单和验证日志保存在 `.lime/release-v11690/`，提交前复核候选内容与远端引用。用户后续明确要求“完成发布,不要找我确认”，已授权本版必要修复、提交、标签和推送，不再重复请求确认。

## 范围、架构与分类

- current：浏览器设备/批注/历史/权限、配置层与受管约束、推理默认值、归档清理、工具运行环境与搜索访问策略。主链仍为 Desktop/CLI → App Server JSON-RPC → RuntimeCore → canonical Thread/Turn/Item。
- dead/deleted：独立知识库、资源管理窗口、旧统计/开发实验设置、创作上下文拼接等候选已删除入口及专用实现；不恢复兼容包装。compat/deprecated：本轮不新增。
- 架构确认：候选已有边界与 owner 变更见 internal/aiprompts/architecture.md 及浏览器领域计划中的责任开发者确认；本轮仅同步发布 metadata，不新增运行时、配置或协议 authority。
- KISS/DRY：复用既有版本事实源及发布链，不引入脚本、依赖升级、分支或第二套产品实现。发布成功不等于完整 Codex GUI/原生浏览器专项验收完成。

## 门禁与退出条件

- 必须：verify:app-version、完整 typecheck、test:contracts。
- 风险匹配：受影响 Rust owner 单元与公共 JSON-RPC 集成、Agent current fixture、真实 Electron GUI smoke；删除项补 legacy guard。
- 不默认启动裸 lint、裸 npm test 或全 workspace cargo test；按实际失败扩大验证。
- 提交前列明实际候选、排除项、验证与限制；按用户明确授权连续完成提交、标签、main/tag 推送并复核远端，不重复确认。
- 完成以远端 main/tag 和 Release 工作流/产物实际状态为准；未执行、失败或缺失证据必须明确记录。

## 验证结果

- verify:app-version exit0；完整 test:contracts exit0（含协议生成无漂移、命令/脚本/Forge/CLI/桌面边界与文档守卫）。legacy report exit0、边界违规0；仍有一个既有零引用分类候选，不属于违规。
- Agent current fixture 前四组 31+34+3+303 项通过；真实 Electron 子场景等待外部任务持有的 fixture build lock，尚未结算 Gate B。
- 48文件前端定向回归运行中；高内存压力下多项超过默认5秒，需要在负载收敛后逐项复核，不修改断言或放宽超时。
- 初轮 Rust 三owner单元入口正在编译时，本机内存压力导致多个前端超时；已仅停止本轮启动的 cargo 及其子进程（PID77792进程树），保留完整日志、不计通过，待降低并发重跑。不终止其他任务/用户进程。
- 完整 npm run typecheck exit0。首轮前端43文件693项通过，另5条超时、导航fixture缺字段6条失败，并误收集4份内部冻结源码。仅补导航fixture现行permissionContext，smoke配置排除同标准入口的internal/exec-plans/artifacts；复跑6文件164项通过，仅配置首场景再次超时，单独原时限复跑1项通过。没有放宽timeout或删减行为断言。
- 发布修复追加写集仅 scripts/lib/vitest-smoke-runner.mjs 与 BrowserSettingsNavigation.component.test.tsx。暂存候选978文件，38443插入/79530删除；排除本地生成缓存tsconfig.node.tsbuildinfo。
- 暂存后其他任务继续修改浏览器受管权限相关文件；它们保留在原工作树，属于冻结之后的未验收增量，当前提交只消费已冻结index，避免把进行中的修改直接带入标签。未覆盖或回滚这些修改。
- staged diff检查仅报告Electron原生候选patch的必需context空白及两份上游模块的EOF空行，保留原件；其余源文件无空白错误。原生patch未编译、未接入产品，不能算原生能力完成。
- 本地GUI/current fixture仍受构建锁与本机负载影响；协议Rust单并发入口等待其他任务的Cargo锁，尚未通过。硬门禁完成后先推main，使用同提交Quality完成远端矩阵，再创建唯一v1.169.0标签；不以本地历史binary替代候选证据。
