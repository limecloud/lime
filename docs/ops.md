# 生产运维与上线就绪清单

本文档用于生产环境部署、运行、备份与恢复的最小操作规范，避免上线后缺少可执行流程。

## 部署前检查

- 确认 API Key 已更换（禁止使用默认值 `proxy_cast`）。
- 确认监听地址：
  - 本机使用 `127.0.0.1`/`localhost`。
- 当前版本仅支持本地监听，不支持对外服务。
- 若需要 HTTPS，请使用反向代理终止 TLS；当前服务端未启用内置 TLS。
- 确认磁盘权限可写：`~/.lime/`、`~/.lime/request_logs/`、应用数据目录（macOS: `~/Library/Application Support/lime/`，Linux: `~/.local/share/lime/`，Windows: `%APPDATA%\\lime\\`）。

## 配置路径与加载顺序

- YAML 配置（优先）：
  - macOS: `~/Library/Application Support/lime/config.yaml`
  - Linux: `~/.config/lime/config.yaml`
  - Windows: `%APPDATA%\\lime\\config.yaml`
- JSON 配置（兼容）：macOS `~/Library/Application Support/lime/config.json`，Linux `~/.config/lime/config.json`，Windows `%APPDATA%\\lime\\config.json`
- 旧版遗留路径：`~/.lime/config.json`（检测到会提示手动迁移）
- 两者都不存在时使用默认配置。
  - 首次启动会自动生成强随机 API Key 并写入配置。

### TUI 按键配置

TUI 只从上述 Lime 用户配置读取 `tui.keymap`、`tui.right_click_paste`、`tui.status_line` 与
`tui.status_line_use_colors` 与 `tui.terminal_title`。启动时会经 App Server `config/read` 生成不可变按键 snapshot；
修改按键配置后需重启当前 TUI 进程。不要创建 TUI 专用
配置文件或按键环境变量。`right_click_paste` 支持 `auto`（默认，遵循 SSH/WSL/VS Code 安全护栏）、
`on` 和 `off`；中键 PRIMARY 仅在本地 X11 可用时启用。

`/statusline` 打开状态栏选择器：Space 勾选、左右键调整顺序、输入文字搜索；搜索中不排序。
确认和取消使用当前 `tui.keymap.list.accept|cancel`，默认 Enter/Esc。预览使用当前线程真实数据，
取消不写配置。确认通过共享 `config/batchWrite` 原子保存两个状态栏字段并立即应用，版本冲突
拒绝写入；失败后刷新共享版本，由用户再次确认重试。省略 `status_line` 默认显示
`model-with-reasoning`、`current-dir`、`thread-name`；显式 `[]` 关闭。未知或不可用项目省略，
不会显示假额度、token 或 Git 数据。主题颜色默认开启；状态栏让位给交互、搜索与排队提示。
运行状态和线程标识保存为 Codex 的 `run-state`、`thread-id`；选择器读取 `status`、
`session-id` 时识别其同义含义，确认后统一保存 canonical 名称并去重。

普通输入框底栏在右侧显示真实上下文剩余百分比；关闭状态栏或运行中输入排队草稿时可见。
没有有效窗口但已观察到用量时，显示服务端累计 `total_tokens`（包含缓存），未知用量留空。
它与可选 `used-tokens` 的非缓存统计含义不同。窄屏优先保全排队/切换模式提示，隐藏完整
统计而不截断；搜索和交互弹层使用各自底栏。Vim 与上下文组合在右侧，启用状态栏时右侧
只显示模式/Vim，不重复上下文。

输入框为空、当前回合已结束时，连续按两次 Esc 可浏览并编辑历史输入。左右键或 h/l
选择，Enter 回退到所选回合之前并把原输入放回输入框，Esc 取消；Ctrl+T（或实际配置的
open_transcript 键）切换详情。只有回合的首条用户输入可独立回退，中途追加输入不支持。
操作保留 Thread，不回滚工作区文件，也不会自动发送恢复的输入。新建 CLI/TUI 会话使用
分页历史；旧 Legacy 会话明确提示不支持回退。刷新失败时保留草稿、禁止提交，按 Esc
重试读取历史；搜索、Vim、弹层和运行中中断继续保持各自输入优先级。

恢复、重连、会话预览和完整记录统一使用 App Server 分页读取；旧 Legacy 会话仍可
正常读取历史。页面的回合元数据读取失败时显示读取失败，保留阅读位置与草稿；Home
可重试加载更早记录。恢复会同步运行中/已结束回合状态，已结束回合的迟到输出不会
重新打开任务。会话预览先过滤内部 review 输入，再选最近六行，最多扫描 400 条记录。

TUI 默认只显示推理摘要，推理原文不会补成缺失摘要、改写运行状态或进入历史导出。
rich/raw 切换只改变终端排版，仍保持这一显示策略；当前未接入显式显示推理原文的配置。
摘要详情按段落显示正文，独立空注释占位不显示；带正文的首个加粗标题用于状态，不在
详情重复。只有加粗标题的摘要、正文强调和行内代码中的注释仍保留。恢复与导出使用
同一正文；窄屏续行保持缩进，文件路径按会话工作目录显示，网页链接保留。

恢复运行中回合时，末尾摘要会继续显示当前状态，并接收后续摘要增量；前面的摘要和
已结束回合保持完成状态。后续新活动开始或回合结束时，恢复的临时状态随之收尾；
加载更早记录不会覆盖当前进度。这一行为不改变推理原文默认隐藏策略。

终端标签标题默认显示活动指示、当前线程名称和工作目录名称；未命名线程省略名称，空闲时
省略活动指示。等待审批、问答或 MCP 输入时显示“需要操作”。退出 TUI 或交接外部编辑器时
清除当前进程设置的标题，编辑器返回后重新应用；不尝试恢复终端先前的标题。

`/title` 打开终端标题选择器，与 `/statusline` 共用搜索、多选、排序和当前 list 按键配置。
选择会实时预览真实标签标题，取消或 Ctrl+C 恢复已保存选择；只有确认写入成功才更新共享
`tui.terminal_title`。省略配置默认 `[activity, thread-name, project-name]`，显式 `[]` 关闭。
可选应用名、工作目录/项目名、活动/运行状态、线程名称/标题/标识、模型/推理强度；
线程标题在未命名时显示标识。活动项被取消时不显示 spinner 或“需要操作”。
普通项目用 ` | ` 分隔，活动项两侧用空格；不可用项目省略，长项目按 Unicode 字素截断。

两种配置器都提供 `task-progress`，显示最近一次结构化计划的完成数/总数。计数直接来自
App Server `turn/plan/updated` 的状态字段，空计划会清除；没有观察到结构化计划时省略。
恢复后的历史计划若只有文本，则只显示计划正文，等待新的结构化更新后再显示计数。

`/statusline` 可选 `used-tokens`、`total-input-tokens`、`total-output-tokens`、
`context-window-size`、`context-remaining`、`context-used`；`/title` 提供除窗口大小外的
同名项目，`context-usage` 也识别为 `context-used`。`/status` 显示同一用量。
已用 token 为累计非缓存输入与输出，输入/输出保留服务端累计；上下文百分比按最近一次
用量及服务端窗口计算，扣除 12000 个固定提示/工具基线。没有观察到用量时省略，窗口未知
时省略百分比；已用零值省略，已观察到的输入/输出零值保留。线程切换只重放已观察的最新
用量，冷恢复没有用量快照时等待新通知，不从历史文字猜测或显示虚构的 100%。

```yaml
tui:
  status_line: [model-with-reasoning, current-dir, thread-name]
  status_line_use_colors: true
  terminal_title: [activity, thread-name, project-name]
  right_click_paste: auto
  keymap:
    global:
      find_transcript: ctrl-x f
    pager:
      page_down: [page-down, space, ctrl-f]
      find: [f3, /]
    agents:
      resume: []
    editor:
      kill_whole_line: ctrl-q k
      move_word_left: [alt-b, alt-left, ctrl-left, f10]
    vim_normal:
      undo: [u, "z u"]
    vim_operator:
      motion_word_forward: [w, "z w"]
    vim_text_object:
      word: [w, f12]
    vim_search:
      forward: ["/", "z /"]
```

每个 action 可使用单个按键、按优先级排列的数组、最多两段且以空格分隔的 chord，或用空数组
显式解除绑定。当前 context/action 为：

- `global`：`open_agents`、`open_transcript`、`find_transcript`
- `pager`：`scroll_up`、`scroll_down`、`page_up`、`page_down`、`half_page_up`、
  `half_page_down`、`jump_top`、`jump_bottom`、`close`、`close_transcript`、`find`
- `agents`：`resume`、`search`、`new_task`、`rename`、`stop`、`toggle_grouping`
- `list`：`move_up`、`move_down`、`move_left`、`move_right`、`page_up`、`page_down`、
  `jump_top`、`jump_bottom`、`accept`、`cancel`；当前 resume/fork、模型/推理强度 picker 和 Agent Center 消费，其它选择器尚未接入。
- `editor`：`insert_newline`、`move_left`、`move_right`、`move_up`、`move_down`、
  `move_word_left`、`move_word_right`、`move_line_start`、`move_line_end`、`delete_backward`、
  `delete_forward`、`delete_backward_word`、`delete_forward_word`、`kill_line_start`、
  `kill_whole_line`、`kill_line_end`、`yank`；composer 的普通/Insert/Replace、Vim query、
  request-user-input notes 和 MCP 文本字段共用同一 snapshot。
- `vim_normal`、`vim_operator`、`vim_text_object`、`vim_search`：分别提供 36、20、9、4 个
  Codex 同义动作；完整字段见 `lime-rs/crates/core/src/config/tui_keymap/vim.rs`。
  Normal 默认 `gg/G` 跳首/末行，`Y` 或 `yy` 按行复制，`p` 按 register 类型粘贴；
  自定义动作与 undo/redo/`.`、搜索、历史导航使用同一语义分发，不回退旧键位。

编辑默认键位按 Codex：Alt+B/F 移动单词、Ctrl+D/Delete 删除后一个字符、Ctrl+H/Backspace
删除前一个字符；`kill_whole_line` 默认无绑定。普通 Enter 由 composer 提交，Shift/Alt+Enter
和 Ctrl+J/M 由 `insert_newline` 插入换行，解绑不会回退硬编码换行。默认 Up/Down 在满足历史
导航条件时调用同一 recall owner；解绑也会关闭该入口。pending editor chord 的完成/取消键
归编辑 owner，不会提交、终止任务或触发全局快捷键。Vim `.` 录制语义动作，不随重新改绑改变。
editor 与 global 共用输入路径，绑定或 chord prefix 冲突会拒绝启动；例如 global.open_agents
使用 Ctrl+N 时需将 editor.move_down 显式改为 `down`，不能保留同键双重动作。

会话列表默认 `PageDown/Ctrl+F`、`PageUp/Ctrl+B` 按可见行翻页，左右键或 `Ctrl+H/Ctrl+L`
切换 Tab 当前聚焦的筛选/状态/排序；旧 `Ctrl+F` 筛选、`Ctrl+S` 状态、`Ctrl+R` 排序不保留。
可打印导航键优先进入搜索，配置 chord 的完成键仍由 chord 消费。确认/取消提示只展示实际绑定，
显式 unbind 不恢复 Enter/Esc。`Ctrl+C` 关闭、`Ctrl+O/T/E` 详情与密度、Tab/Shift+Tab 焦点和
Backspace 搜索删除仍由 picker 持有，冲突的 list 配置会 fail closed；没有暗中不生效的键位。

Agent Center 当前默认键位与 Codex 一致：`o` 恢复、`f` 搜索、`n` 新建、`r` 改名、`x` 停止、
`g` 切换分组；`Tab/Shift+Tab` 切换状态标签，`PageDown/Ctrl+F`、`PageUp/Ctrl+B` 按可见行
翻页，`?` 查看已接线快捷键。metadata 输入时可打印字符只用于编辑，不触发任务动作；
自定义 bindings 优先，显式空数组不会回退默认键位，footer/help 使用同一配置 snapshot。

修饰键使用 `ctrl-`、`alt-`、`shift-`；支持 ASCII 字符、`f1` 至 `f24` 及常见命名键。
未知字段、非法键名、过长 chord、同 context 重复绑定、single/chord prefix 冲突和普通可打印字符
chord prefix 都会被拒绝；只有 Vim modal contexts 允许可打印 prefix（如 `g g`、`z u`），
不会截获普通/Insert/Replace 文本。宿主/提交/队列/历史搜索等固定键冲突会拒绝；显式 modal
绑定覆盖该 context 的默认绑定，默认 search/modal 向显式动作和实际 global 绑定让位，
显式跨 context 冲突仍拒绝。pending chord 完成/取消优先于提交和全局快捷键；更新 snapshot
及替换 buffer 清 pending。composer 专用提交/队列配置尚未接入，不暴露无消费者字段。

## 数据与日志位置

- SQLite 数据库：`~/.lime/lime.db`
- 日志目录：`~/.lime/logs/`
- 请求日志目录：`~/.lime/request_logs/`
- 数据库备份目录：`~/.lime/backups/`
- 旧凭证池副本目录与旧 OAuth/Token 目录不属于 current 常规备份面；启动期会清理 Lime 管理的旧凭证池副本。如需法务或人工排障留存，先离线加密归档，再启动新版本。

## 备份与恢复

### 备份

1. 可使用管理端点触发备份（需配置管理密钥）：
   - `POST /v0/management/backup`
2. 或手动备份（建议停服后执行）：
   - 复制以下路径：
   - 配置文件（macOS: `~/Library/Application Support/lime/config.yaml`，Linux: `~/.config/lime/config.yaml`，Windows: `%APPDATA%\\lime\\config.yaml`）
   - 配置备份文件：`config.yaml.backup`
   - `~/.lime/lime.db`
   - `~/.lime/logs/`、`~/.lime/request_logs/`（如需保留日志）
3. 将备份文件存入受控存储（加密磁盘或安全存储）。

### 自动备份

- 服务运行期间每 24 小时自动创建数据库备份到 `~/.lime/backups/`。
- 备份默认保留 7 天，过期文件会被清理。

### 恢复

1. 停止 Lime 服务。
2. 使用管理端点恢复（建议停服后执行，执行时会锁定数据库并短暂阻塞请求）：
   - `POST /v0/management/restore`，请求体：`{"backup_path": "/path/to/lime_YYYYMMDD_HHMMSS.db"}`
3. 或手动恢复上述文件到原路径。
4. 启动服务并检查 `/health` 与 `/ready`。

## 升级与回滚

- 升级前执行备份流程。
- 升级后若出现异常：
  - 恢复备份文件。
  - 回滚到上一个稳定版本的安装包。

## 运行与排障

- 健康检查：`GET /health`
- 就绪检查：`GET /ready`
- 常见问题排查：
  - 端口占用：修改配置端口或释放占用端口。
  - 配置解析失败：检查 YAML/JSON 语法，确认缩进正确。
  - 数据库初始化失败：检查 `~/.lime/` 权限与磁盘空间。

## 安全基线

- 禁止默认 API key。
- 当前版本未实现内置 TLS，远程管理必须保持关闭且仅本地访问。

## 管理 API 基线

- 管理 API 启用后会对失败认证进行短期限制，避免暴力尝试。
- 建议仅在内网使用，并配合独立强密钥。
