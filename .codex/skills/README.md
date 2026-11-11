# Lime 仓库技能索引

本目录存放 Lime 仓库的项目级 Codex skills。
这些 skill 不是替代根 `AGENTS.md` 或 `internal/aiprompts/`，而是把高频工作流做成可重复执行的入口。

## 当前仓库级 skills

- `lime-governance`：治理收口、事实源识别、compat / deprecated 收口
- `lime-design-language`：基于 Codex Desktop 证据对齐 GUI 结构、交互与命名，保留主题、多模型和首页 Banner
- `lime-quality-workflow`：按 current owner 选择定向验证，区分 Desktop / CLI / TUI 证据，迁移过期测试与护栏
- `lime-windows-cloud-test`：复用无影 Windows 云电脑测试 Lime，导出 Electron/安装包证据并按预算关机或释放
- `lime-command-boundary`：Electron IPC、App Server JSON-RPC、legacy adapter、前端网关、mock 同步
- `lime-playwright-e2e`：GUI 续测、Playwright MCP、bridge / mock 缺口分类
- `lime-product-e2e-loop`：产品化 E2E 闭环、真实用户路径、最小修复与复测记录
- `lime-project-heatmap`：热力图生成、治理优先级分析
- `project-skill-factory`：把仓库规则与高频流程提炼成新的项目技能
- `lime-app-center-logo-cheatsheet`：为应用中心和侧边栏应用入口生成不重复、可落库的 Logo / icon
- `article-image-cheatsheet`：按文章上下文生成中文配图、解析流式图片结果并插入 Markdown 引用
- `lime-product-design-cheatsheet`：基于截图和需求生成符合 Lime 原型的桌面产品设计图
- `gongzonghao-article-writer`：把真实体悟、群聊素材和项目上下文写成中文公众号文章

## 入口关系

- 仓库规则：看 `AGENTS.md`
- 文档索引：看 `internal/aiprompts/README.md`
- 模块与流程事实源：看 `internal/aiprompts/*.md`
- 高频工作流执行入口：看本目录下的各个 skill

## 维护规则

1. 新增长期复用的仓库级工作流时，优先评估是否应该新增 skill
2. 新增或重构 skill 时，同步检查对应 `internal/aiprompts/` 文档是否仍是事实源
3. 如果 skill 依赖的长流程已经迁到新文档，及时同步 skill 的读取入口
