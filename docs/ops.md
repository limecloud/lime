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

### 项目配置与新聊天默认值

设置中的 Configuration 通过同一 App Server 配置链读取用户 YAML 与项目的
`.lime/config.toml`。用户层在前；从最近 Git 根目录到当前工作目录的项目层依次覆盖，
没有 Git 根时只读取当前目录。已有 `.lime` 目录即使没有配置文件也会形成空项目层；
读取不会创建目录或文件，没有项目配置目录时默认选中用户层。

项目必须在用户 YAML 的 `projects` 中显式信任，项目文件不能自行授予信任：

```yaml
projects:
  "/absolute/path/to/project":
    trust_level: trusted
```

Windows 使用实际规范化的绝对目录路径。当前目录的显式 `untrusted` 优先于 Git 根的信任。
未信任项目层和符号链接配置路径会显示为不可写，并且不参与有效配置。
用户配置可以保留原有符号链接行为；项目配置不允许借符号链接写到项目外。

项目层当前支持新聊天默认键 `approval_policy`、`sandbox_mode`、
`sandbox_workspace_write.network_access`、`web_search`、`model_verbosity`、
`model_reasoning_summary`，以及现役 `default_permissions` / `permissions` 配置。
它不覆盖全局主题、多模型连接、网络代理、Desktop 偏好或项目信任本身。
Configuration 每行只写所选文件的目标键，保存时检查该文件的独立版本；
项目 TOML 保留注释和无关字段，内联 `sandbox_workspace_write` 表需直接打开文件编辑。
新建 Thread 按 cwd 解析并冻结默认值；已存在和恢复的 Thread 保留其 canonical 快照。
管理员可在 Unix `/etc/lime/requirements.toml` 或 Windows 系统 ProgramData 下的 `Lime/requirements.toml` 限制可选值。该路径不受用户配置、环境变量或项目配置影响，例如：

```toml
allowed_approval_policies = ["on-request"]
allowed_sandbox_modes = ["read-only", "workspace-write"]
allowed_web_search_modes = ["cached"]
```

关闭网页搜索始终允许。配置页只显示管理员允许的选项，直接 API、权限配置切换和旧聊天的下一轮也会重新校验；越权请求明确失败。文件缺失表示不设限制；文件损坏、未知字段、空审批或沙盒列表会阻止操作，修复文件后重试。策略不会改写用户/项目文件中的原值；新聊天使用受限的有效默认值。
macOS 管理员可通过配置描述文件为 `com.limecloud.lime` 强制下发字符串偏好：

- `config_toml_base64`：base64 编码的 UTF-8 TOML，支持上述新聊天默认值（包括 `model_reasoning_effort`）、命名权限预设，以及 `desktop.enabled-reasoning-efforts`。
- `requirements_toml_base64`：同样编码的三个 allowed lists，优先于系统文件和旧式强制配置回填。

只接受读取前后均为系统 forced 的值；普通 `defaults write` 不会产生管理员来源。错误类型、非法 base64/TOML、超过 1 MiB 或未接入的 managed 键会明确阻止配置读取和相关操作。强制配置覆盖 User/可信 Project，但不改写原文件；配置页仅在真实层存在时显示 Admin，无文件可打开，受管理字段在所有可写作用域中锁定。`approval_policy` 与 `sandbox_mode` 同时回填执行约束；其他受管字段提供新聊天默认值，不追溯修改已有 Thread。

Config 写入拒绝受管理字段及其父/子路径；其他设置照常保存。独立强制 requirements 可逐字段覆盖旧式单值限制，关闭网页搜索始终可用。当前没有 enterprise transport、Windows MDM 源或依赖安装修复服务。

### TUI 按键配置

TUI 只从上述 Lime 用户配置读取 `tui.keymap`、`tui.right_click_paste`、`tui.status_line`、
`tui.status_line_use_colors`、`tui.terminal_title` 和 `tui.animations`。启动时会经 App Server `config/read` 生成不可变按键 snapshot；
修改按键配置后需重启当前 TUI 进程。不要创建 TUI 专用
配置文件或按键环境变量。`right_click_paste` 支持 `auto`（默认，遵循 SSH/WSL/VS Code 安全护栏）、
`on` 和 `off`；中键 PRIMARY 仅在本地 X11 可用时启用。

`animations` 默认开启；设置 `tui.animations: false` 并重启即可关闭推理档位动画、状态栏
过渡和运行状态文字闪光。真实切换到 Max/Ultra 时播放一次动画，之后保留档位箭头；
启动、恢复或切换线程只显示当前档位。ANSI-16/无颜色终端使用静态展示；未取得终端
背景色时取消输入框动画，不会不断请求刷新。草稿和附件文字始终保留。

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
普通项目用 `|` 分隔，活动项两侧用空格；不可用项目省略，长项目按 Unicode 字素截断。

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

新聊天的回复默认值使用同一用户配置中的两个顶层字段：

```yaml
model_verbosity: high # null（模型默认）、low、medium 或 high
model_reasoning_summary: detailed # auto、concise、detailed 或 none
```

默认详细程度为模型默认，推理摘要为 `auto`。配置通过公共 `config/value/write` 或
`config/batchWrite` 保存，可用 `expectedVersion` 防止覆盖其他写入。服务端在
`thread/start` 时将默认值保存到 canonical Thread；修改全局默认值只影响之后创建的聊天，
已有聊天及其冷恢复继续使用保存的值。`thread/start.config` 中同名字段可显式覆盖；
详细程度 `null` 使用模型默认，摘要 `null` 使用 `auto`。`thread/settings/update.summary`
和 `turn/start.summary` 更新当前聊天的摘要偏好，并保留到后续回合。

这些偏好受所选模型的明确能力声明约束：不支持的模型不会收到对应请求字段；摘要为
`none` 时省略请求的摘要字段。它们影响模型请求，与下面的推理显示开关各自独立。

新聊天的权限默认值保存在同一配置中：

```yaml
approval_policy: on-request # on-request、never 或 untrusted
sandbox_mode: read-only # read-only、workspace-write 或 danger-full-access
sandbox_workspace_write:
  network_access: false
```

权限与回复默认值在 `thread/start` 时共用一次配置快照；之后修改全局配置不改变已有
聊天或冷恢复的权限。显式 `permissions` 选择命名权限配置，显式 `sandbox` 或
`config.sandbox_mode` 可替代全局默认权限配置；`permissions` 与 `sandbox` 不可同时
指定。显式 `sandbox` 及回合沙盒覆盖会重置继承的网络放行，避免从旧策略意外扩大权限。
`network_access` 只作用于 `workspace-write`，不替代独立的受管网络授权。
受限策略必须使用可用的操作系统沙盒，否则明确拒绝执行；旧 `workspace_sandbox`
开关不能关闭请求指定的隔离策略。配置读写继续经过公共配置 API 及版本校验。

Desktop 的 `desktop.enabled-reasoning-efforts` 控制模型控件中可选的 `max`、`ultra`，
仅对模型目录明确支持的强度生效；默认关闭 `max`、启用 `ultra`。基础强度和模型声明的
`persistent`、自定义强度保持可用，不由该偏好伪造模型能力。关闭强度只筛选菜单选项，
保留已有聊天的当前选择与 canonical 设置；用户切换模型时，已关闭的强度回落到目标模型
仍可用的默认值。设置页逐行保存到同一
App Server 用户配置层，空数组显式关闭两项可选强度，`null` 恢复界面默认值。

原始推理显示使用同一用户配置中的顶层 `show_raw_agent_reasoning: true`，默认 false。
GUI/TUI 均只在显式开启后将 canonical `content` 接在摘要之后；实时增量、运行中恢复、
分页记录、完整记录与 TUI 导出遵守同一策略。它只影响显示，不改变服务端保存的
summary/content 或 Thread/Turn/Item 身份。TUI 在启动时读取配置，修改后重新启动；
GUI 经共享配置网关保存后更新当前展示，冷恢复也读取同一设置。无有效配置时保持隐藏。

非交互 `lime exec` 在 stderr 默认输出已完成 Item 的推理摘要；开启
`show_raw_agent_reasoning` 后优先输出原文，无原文时回到摘要。顶层
`hide_agent_reasoning: true` 可关闭 exec 的全部推理输出，优先于原文开关，默认 false。
这项隐藏策略仅作用于 exec human output；GUI/TUI 仍按前述摘要与原文规则显示。
工具的开始、结果和输出、计划、差异、警告/错误及结束时的 token 用量同样输出到 stderr。
token 用量排除缓存输入，使用最后一次服务端累计快照；失败/中断会显示原因，并分别以
1/130退出。stdout在管道中仅保留成功的最终回答；stdout/stderr都连接终端时最终回答
只在stderr展示一次。`exec --json`逐行实时输出Codex形状事件，无human文本或ANSI；
机器输出始终只保留推理摘要，不受raw/hide显示开关影响。`thread.started.thread_id`是
canonical身份，Item显示编号仅在本次输出内稳定。成功`turn.completed.usage`使用最后
服务端累计total，含缓存输入、cache write与reasoning output；失败输出error/turn.failed，
中断不输出成功终态。旧单结果envelope与独立jsonl参数已删除，事件schema随CLI npm包分发。
`lime exec --color auto|always|never`控制标签颜色；auto在支持颜色的stderr终端启用，
遵循NO_COLOR，always可显式覆盖。`--locale zh-CN|zh-TW|en-US|ja-JP|ko-KR`选择标签语言，
也可在root命令上指定；其次读取LIME_LOCALE、LC_ALL、LANG，默认英文。

`lime exec resume <thread-id|exact-name> "prompt"`恢复同一Thread并新建Turn；
`resume --last "prompt"`按最后更新时间选择当前cwd的未归档记录，`--all`取消cwd筛选。
UUID优先，名称精确匹配；last/name无匹配新建，实际恢复失败显式报错。
PROMPT是一个参数，多个单词加引号；省略或`-`从stdin读取，新会话同时给PROMPT/pipe
时追加stdin块，resume显式PROMPT不追加。支持UTF-8 BOM/UTF-16，不接受非法编码。
`--output-last-message`/`-o`只写成功最终消息，失败/中断保留旧文件，写失败返回1。
`lime exec fork <thread-id|exact-name>`分叉为新Thread，保留共享canonical历史和来源；
查源不限制cwd，未找到显式失败。无PROMPT仅分叉，不读取pipe，不启动Turn；JSON仅输出
thread.started，human显示新会话ID。显式PROMPT或`-`才发起新Turn；图片/-o/output-schema要求PROMPT。
`exec`/`exec resume`/`exec fork`均接受`-i/--image <FILE>`，单参数支持逗号列表及重复选项；
root图片先于子级图片，Text最后，由共享App Server/runtime读取和处理图片。
`--output-schema <FILE>`读取UTF-8 JSON，经既有turn/start.outputSchema只传给当前Turn；
resume/fork前后均可使用。文件不可读/非法JSON在连接前报错，无PROMPT的fork拒绝此选项。
`lime exec review --uncommitted|--base <BRANCH>|--commit <SHA>`或一条自定义指令走
共享review/start；target互斥，--title只能配commit，无target/空指令在连接前拒绝。
顶层`lime review`接受同一目标和指令，默认human输出；root连接/权限/locale可放在
review前继承。`--json`与`-o`使用`lime exec review`入口。
custom '-'读取stdin并trim；显式指令忽略pipe。审查复用同一JSON/human/最终文件输出，
review按Codex语义不消费root PROMPT、图片或output-schema。

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
和 Ctrl+J/M 由 `insert_newline` 插入换行，解绑不会回退硬编码换行。补全列表支持长按方向键与
Ctrl+P/N，松开按键不改变选择；Ctrl+J/K交回编辑器，Windows AltGr不触发列表导航。
本地会话空输入框按下 Left 打开 Agent Center；长按仍归编辑器，松开忽略。
只有当前 editor/Vim 的 `move_left` 仍绑定 Left 才显示和启用导航；重绑或解绑后同步关闭。
Vim Normal的空输入框按`/`进入Insert并显示命令补全；非空草稿继续Vim搜索。
若将Vim forward search显式改绑或解绑，旧`/`不会触发命令兼容回退；搜索chord保持搜索。
问答备注按纯文本编辑，命令、文件和技能文本保留原意；图片路径不会自动变成附件。
长粘贴显示紧凑占位符，提交发送完整正文；返回已接受问题可继续编辑，每题草稿和游标保留。
修改已接受的正文或选项后，需要再次按确认键接受；最后一题仍有未回答项时，可选择继续
提交或返回第一个未回答问题，未接受的草稿不会进入答案。确认页使用当前列表键位。
“以上都不是”可附加备注；选项名称与说明分别排版。所有已接受的备注（含自由输入）
按 Codex 使用 `user_note:` 编码，兜底选项发送 `None of the above`，服务端提供的选项名称保留原样。
备注和主输入共用换行规范化与Markdown引用粘贴，Vim备注的空`/`仍进入搜索。
终端未提供粘贴标记时，备注也检测快速输入；粘贴中的Enter/Tab保留在正文，长正文在空闲
刷新后显示紧凑占位符。切题前保存完整输入，提交时发送展开后的原文。
MCP 表单文本字段使用相同输入框，保留各字段草稿、游标和长粘贴原文；修改已确认字段后
需再次确认。窄屏长文本在编辑视口中换行并跟随游标，第一次 Ctrl+C 清空草稿，再次取消表单。
默认 Up/Down 在满足历史
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

### 网页搜索访问范围

`web_search` 为 `disabled`、`cached`、`indexed` 或 `live`，在「设置 → 配置」逐行保存。未配置时，完整访问的新聊天默认 `live`，其他沙箱默认 `cached`。每个新 Thread 保存有效模式；修改全局设置不改变已打开 Thread。`config/read` 返回由同一权限 profile 解析器推导的有效模式，layers 中保留未配置状态及原始 revision；前端不自行解释权限 profile。回合请求只能收窄 Thread 的访问范围，`auto/required` 调用意图不能扩大权限。本地搜索只支持缓存结果或实时访问；缓存未命中、索引后端不可用均明确失败，不自动联网。官方 Responses 路由按模式发送 hosted web search 标志。

旧 `web_search` 提供商表及其设置页已移除。`image_gen.image_search_pexels_api_key` 与 `image_search_pixabay_api_key` 仍归独立图像配置，通过配置页「打开配置文件」编辑；未迁入网页搜索访问模式，也未删除配置数据。

### 新聊天的默认推理档位

`model_reasoning_effort` 为新 Thread 的默认推理档位，支持 `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max`、`ultra` 和 `persistent`；未设置或空值沿用模型行为，实际可用值仍由模型能力决定。可信项目配置及显式 `thread/start.config` 可覆盖 User 层，创建时写入 canonical Thread；后续全局变化不改写既有聊天或冷恢复的设置。

「设置 → 配置 → 可用推理档位」关闭 `max` 或 `ultra` 时，若该值正是 User 层的新聊天默认，先使用现役 `model/list` 唯一默认模型声明的档位修正它，再保存菜单偏好。两个写入共享配置队列和 revision 检查；默认修正失败不隐藏该档位，偏好保存失败可重试。项目 scope 不改变这项 User 偏好的归属。
