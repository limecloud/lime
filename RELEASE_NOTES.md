## Lime v1.15.0

### 发布概览

- 本次版本基于当前待发布工作树整理，主线集中在 `技能 / 灵感库 / 生成` 闭环收口、参考运行时 `hooks / skills / peer messaging / config` current 推进、`Lime Browser Bridge 0.4.0` 上架准备，以及官网直达桌面入口与品牌资产更新。
- 本次发布目标 tag 为 `v1.15.0`。

### 生成主线与结果模板

- 结果模板启动事实开始跨首页、技能页、slash、launcher 与 `GeneralWorkbench` 连续流转：`launchInputValues`、`referenceEntries`、默认参考对象与 follow-up prompt 不再只靠首轮 prompt 文本恢复。
- `CuratedTaskLauncherDialog` 现在支持打开态实时刷新最近参考对象，并保留用户已经手动勾选的参考项；确认启动时会继续带上这些引用，而不是被 recent list 刷新静默挤掉。
- 参考对象的前台语言从泛化“灵感”收口为 `风格参考 / 偏好基线 / 参考素材 / 成果样本 / 收藏线索`，推荐理由、launcher 引用区、默认标题和来源标签都改成 category-aware 呈现。
- 复盘结果开始回流到结果模板推荐信号，最近一次 review decision 会影响首页、技能页、slash 与 launcher 的下一轮推荐排序与推荐理由。
- 结果模板卡片与 launcher 补充了“结果去向”“下一步动作”“跨模板 follow-up target”等信息，`复盘 -> 下一轮内容方案` 这类 continuation 会继续保留上一轮已确认的启动上下文。
- 首页 `继续上次做法` 与 slash `最近使用` 改成同页实时回流；最近使用过的本地 Skill 会回到首页继续层，而不是只留在技能页里。

### 技能工作台闭环

- `沉淀为做法 -> 创建 Skill -> 我的方法库 -> 进入生成` 现在是完整闭环：创建 scaffold 成功后会立即刷新本地技能列表、关闭整理弹窗、把新做法高亮到“我的方法库”，并支持 optimistic 插入避免刷新空档。
- 技能页 `先拿结果 -> 进入生成` 会把 `launchInputValues`、`referenceEntries` 与 reference memory ids 一起写回 capability route，避免只剩 prompt 与 reference prefill 的半状态。
- 结果沉淀后的新 Skill 会以“刚沉淀”状态回到列表，用户可以直接继续进入生成，而不需要重新回到导入整理流。

### 官网入口与品牌更新

- 桌面端新增 `lime://open` deep link 协议，官网现在可以直接打开结果模板、服务技能或提示词入口；桌面收到 deep link 后会把它解析成当前可用的工作台导航。
- 侧边栏、关于页、公共品牌常量与静态资源统一切到新的 Lime 品牌 logo，桌面托盘与扩展图标也同步更新。
- Chrome Relay 设置页新增明确提示：不要直接加载仓库源码目录里的 `extensions/lime-chrome`，应使用 Lime 导出的带配置连接器目录。

### Lime Browser Bridge 0.4.0

- 扩展版本推进到 `0.4.0`，并补齐 Chrome Web Store 提交底稿、上传包、SHA-256、截图与发布计划。
- Browser Bridge 现在会把缺少 `serverUrl / bridgeKey` 的状态显式标成 `Setup Required / 需要配置`，而不是继续混在“连接中”状态里。
- popup 与 options 页都新增了更清晰的缺配置引导文案，用户可以更直接理解需要从 Lime 同步连接配置或手动粘贴配置。
- options 页新增中英文切换、完整状态说明、故障排查与设置说明，扩展安装/引导页的上架材料也同步收口到当前版本事实源。

### 运行时与工程边界

- project hooks 已真正进入 runtime current：`UserPromptSubmit`、`SessionStart(startup / compact)` 都会按当前 workspace 加载 project hooks 并执行，不再停留在 loader/executor 存在但主路径不接入的半成品。
- hooks executor 已从占位实现推进到 `command / url / prompt / agent / mcp` 全执行链：Prompt hook、Agent hook 与 MCP hook 都会真实调用当前 provider/runtime，而不是只打 warning。
- `SkillTool` 现在能够真实执行 `prompt` / `workflow` 技能；`SkillExecutionMode::Agent` 仍明确保持未实现状态，没有假装进入 current。
- 本机 cross-session peer messaging 进入最小 current：`ListPeers` 会暴露 synthetic `uds:<session-id>` local peers，`SendMessage` 可把纯文本消息投递到同工作目录下的其他活跃 session。
- `ConfigTool` 已接入 `classifierPermissionsEnabled` current key，并明确收口 `remoteControlAtStartup`、移动推送类 setting 与 `permissions.defaultMode` 的真实支持边界，不再把它们模糊混成“未知 setting”。
- 旧 `channels_cmd` CRUD stub 命令已从 Tauri 命令面正式下线，并加入治理目录守卫，防止旧命令从 Rust 或前端路径重新回流。
- provider 模型加载策略进一步收口：`anthropic-compatible` 等渠道在没有返回实时模型目录时仍允许保留和手动维护模型，不再被“必须拿到 live model truth”误伤。

### 版本与发布同步

- 应用版本入口已对齐到 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json`、`src-tauri/tauri.conf.headless.json`。
- CLI npm wrapper 与发布示例已同步到 `1.15.0`。
- `package-lock.json`、`src-tauri/Cargo.lock` 与校验结果以本次最终验证通过的状态为准。

### 已执行校验

- `npm run verify:app-version`：通过
- `cargo fmt --manifest-path "src-tauri/Cargo.toml" --all`：已执行
- `env CARGO_TARGET_DIR="/tmp/lime-release-1.15.0-test" cargo test --manifest-path "src-tauri/Cargo.toml"`：通过，`984` 个单测通过，额外 `2` 个集成测试通过；另有 `2` 个真实联网用例按默认配置保持 `ignored`
- `env CARGO_TARGET_DIR="/tmp/lime-release-1.15.0-test" cargo clippy --manifest-path "src-tauri/Cargo.toml"`：通过，当前保留 `1` 条 clippy 告警，位于 `src-tauri/crates/skills/src/lime_llm_provider.rs:255`（`clippy::too_many_arguments`）；同时 `lime` crate 还存在 `3` 条 `dead_code` 级别的非阻塞 warning，集中在 `runtime_project_hooks.rs` 与 `session_runtime.rs`
- `npm run lint`：通过

---

**完整变更**: `v1.14.0` -> `v1.15.0`
