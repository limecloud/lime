# Workspace 领域边界

状态：current

Workspace 是项目文件边界、用户选择上下文与 Thread 运行上下文的产品概念，不是另一套 Agent runtime。完整 owner 图见 [architecture.md](architecture.md)。

## 事实源

```text
Renderer workspace UI
  -> typed App Server client
  -> workspace/session JSON-RPC read/write
  -> App Server repository + Thread/Turn/Item read model
  -> Renderer projection
```

- Workspace 元数据、项目根目录、用户偏好与关联 Thread 的持久化由 App Server repository/read model 承担。
- Renderer 只保存当前选中、面板展开、输入草稿等局部交互状态；不得通过本地缓存伪造 Thread 或 Turn 状态。
- Electron 只提供目录选择、系统文件打开、窗口和 sidecar 等宿主能力；它不拥有 workspace 业务数据或 session 生命周期。
- 文件内容仍是文件系统事实；预览只生成 source-backed projection。写回必须经显式保存，预览不能反向定义主稿或运行时状态。

## 预览与产物

1. 打开项目文件、导出内容或历史文件时，先将 source 映射为可读 preview projection，再交给统一 workbench 呈现。
2. `ArtifactDocument` 用于正式可版本化交付物、结构化增量、diff 与导出；普通文件预览不自动升级为正式 artifact。
3. 相对资源按源文件路径解析；对 UI 展示优先保留项目内相对路径，实际磁盘读写才解析绝对路径。
4. 二进制、图片、文档、URL 与任务结果统一通过 `contentKind`、`renderMode`、`capabilities` 选择 renderer 或降级方式。

## 验证

- 只改 projection / selector：定向 unit test。
- 改 workspace JSON-RPC、bridge 或持久化：`npm run test:contracts` + 对应 Rust 定向测试。
- 改用户可见 Workspace 主路径、文件选择或 workbench：`npm run verify:gui-smoke`，必要时补 Gate B Electron fixture。

改变 Workspace owner、持久化事实源、跨层 method、主窗口路由或预览 contract 属于重大架构变更，必须更新 [architecture.md](architecture.md) 并由责任开发者确认。
