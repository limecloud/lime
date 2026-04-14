# `docs/exec-plans`

本目录存放会影响开发执行的 versioned artifact：执行计划、进度日志、阻塞记录、迁移清单、技术债追踪。

## 放什么

- 多轮实现、迁移、治理任务的执行计划
- 与计划绑定的阶段进度、阻塞项、决策记录
- 需要持续小额偿还的技术债与退出条件

## 命名约定

- 专项计划：`<topic>-plan.md`
- 进度日志：`<topic>-progress.md`
- 常驻追踪：使用固定文件名，例如 `tech-debt-tracker.md`

## 使用规则

1. 计划不是一次性文档，推进状态变化时要同步更新
2. 会改变实现顺序、范围或回滚策略的决策，必须记录在这里或链接到这里
3. 清理类工作如果不能直接回挂路线图，应登记到 `tech-debt-tracker.md`
4. 被替代的计划不要悬空，保留跳转说明或归档指针

## 关联入口

- 路线图主线：`docs/roadmap/`
- 参考运行时主链总计划：`docs/exec-plans/upstream-runtime-alignment-plan.md`
- 参考运行时主链进度日志：`docs/exec-plans/upstream-runtime-alignment-progress.md`
- LimeNext 总实施计划：`docs/exec-plans/limenext-plan.md`
- LimeNext 推进日志：`docs/exec-plans/limenext-progress.md`
- 技术债追踪：`docs/exec-plans/tech-debt-tracker.md`
- 模块级实施细节：`docs/aiprompts/README.md`
