# `@limecloud/lime`

Lime 的官方命令行入口。CLI、TUI 和 Desktop 共用 App Server JSON-RPC、RuntimeCore 与 canonical Thread/Turn/Item，不包含独立任务 runtime。

本包只负责终端版本（CLI/TUI），不包含 Electron Desktop GUI。Desktop 请查看仓库根目录 README 的[版本选择与安装说明](https://github.com/limecloud/lime#choose-a-product-surface)。

## 安装

```bash
npm install -g @limecloud/lime
```

需要 Node.js 18 或更高版本。安装根包时会根据当前操作系统和 CPU 自动解析 optional platform package；无需单独下载或安装 `app-server`。

根 npm 包包含 launcher 和 `exec-events.schema.json`，并通过 optional dependency 安装当前平台的原生载荷；安装阶段不执行网络下载脚本。平台载荷原子包含 `lime`、`app-server`、`code-mode-host`、Windows sandbox helpers 和所需动态库，保证默认 TUI 与 `exec` 都进入同一 App Server 产品链。

macOS/Windows 平台包还包含 Computer Use 原生 helper 与严格资源清单，CLI 无需安装 Electron。
本机 WPS 使用原生办公通道；开启功能后，`--computer-use-target '<目标 JSON>'` 为当前连接
请求准确目标授权。系统权限和原生确认仍然生效，连接结束后需要重新授权。Windows 驱动与
各平台的实际支持范围以验收记录为准，包含 helper 不代表所有平台操作已验证。

当前发布目标为 macOS arm64/x64、Windows x64 与 Linux x64 GNU。尚无真实构建和运行证据的平台会明确拒绝启动，不发布空壳 optional package。

## 命令

```bash
# 默认启动交互式 TUI
lime

# 显式启动 TUI
lime tui

# 非交互运行
lime exec "review this diff"
lime exec --json "review this diff"
lime exec --json -o answer.txt "review this diff"
lime exec resume <thread-id> "continue the work"
lime exec resume --last "continue the work"
lime exec resume --last --all "continue the work"
lime exec fork <thread-id>
lime exec fork <thread-id> "continue on the fork"
lime exec -i screenshot.png "inspect this image"
lime exec --output-schema response.schema.json "return a structured response"
lime exec review --uncommitted
lime review --uncommitted
lime exec review --base main
lime exec review --commit <sha> --title "commit subject"
lime exec review "check error handling"

# Lime-native approval/sandbox controls (also accepted before exec/resume)
lime exec --sandbox workspace-write "review this diff"
lime exec --ask-for-approval on-request "run the checks"
lime exec --approve-for-me "apply the safe fixes"
lime exec --dangerously-bypass-approvals-and-sandbox "run in an externally sandboxed host"

# 只读检查 execpolicy prefix rules
lime execpolicy check --rules ./rules/policy.rules --pretty git push origin main

# 生成 shell completion
lime completion zsh > "${fpath[1]}/_lime"

# 恢复 canonical Thread
lime resume
lime resume <thread-id>

# App Server read/control surfaces
lime thread list
lime thread show <thread-id> --include-turns
lime mcp list
lime skills list
lime plugin marketplace add ./marketplace --json
lime plugin marketplace add owner/repo --ref main --sparse .agents --sparse plugins
lime plugin marketplace list --json
lime plugin marketplace upgrade
lime plugin marketplace remove <marketplace>
lime plugin list
lime plugin list --available --json -C ./workspace
lime plugin add <plugin-name>@<marketplace> -C ./workspace
lime plugin read <plugin-name>@<marketplace> --json
lime plugin search <term> --scope workspace -C ./workspace
lime plugin enable <plugin-name>@<marketplace>
lime plugin disable <plugin-name>@<marketplace>
lime plugin remove <plugin-name>@<marketplace>
```

`lime exec --json` 实时输出 Codex 形状的 JSONL 事件，每行一个事件：`thread.started`、`turn.started`、`item.started/updated/completed`、`turn.completed/failed` 与 `error`。成功终态包含最后一次服务端累计 token 用量；失败退出 1，中断退出 130 且不输出成功终态。Item 的 `item_0` 等编号仅用于本次输出，`thread.started.thread_id` 是可恢复的 canonical Thread ID。机器输出只包含推理摘要，忽略 human 显示开关，不输出推理原文。事件 schema 随根包分发；管理命令的 JSON 合同各自保持不变。`completion` 从同一命令树生成 bash、zsh、fish、PowerShell 和 elvish 脚本。

PROMPT 与 Codex 一致，是一个参数，多个单词请加引号。省略 PROMPT 或使用 `-` 时从 stdin 读取；新会话同时提供 PROMPT 和 pipe stdin 时，将 stdin 附加为 `<stdin>` 块。恢复会话时，显式 PROMPT 不追加 pipe 内容。stdin 接受 UTF-8（含 BOM）和带 BOM 的 UTF-16；非法编码显式失败。

`exec resume` 优先解析 UUID，否则按精确名称查找；`--last` 选择当前 cwd 内最近更新的未归档 Thread，`--all` 取消 cwd 筛选。找到后通过共享 `thread/resume` 发起新 Turn；没有 last/name 匹配时按 Codex 语义建立新 Thread，实际恢复请求失败则显式失败。`--output-last-message`（`-o`）将成功最终消息原文写入文件；失败或中断保持旧文件，文件写入失败返回 1 并输出错误。

`exec fork <thread-id|exact-name>` 通过共享 `thread/fork` 创建新 Thread，保留 canonical 历史和来源。查源不限制 cwd；未找到源显式失败。无 PROMPT 时只分叉，忽略 pipe，不启动 Turn；JSON 只输出 `thread.started`，human 显示新会话 ID。显式 PROMPT 或 `-` 才继续新 Turn，图片、`-o` 和 `--output-schema` 要求提供 PROMPT。`exec`、`exec resume` 和 `exec fork` 都支持 `-i/--image <FILE>`：单参数可用逗号列表，也可重复；root 图片先于子级图片，Text 最后，媒体由共享 runtime 处理。

`--output-schema <FILE>` 读取 UTF-8 JSON，并通过共享 `turn/start.outputSchema` 约束当前 Turn 的最终响应。选项可放在 resume/fork 前后；文件不可读或 JSON 非法时在建立连接前报错，不创建 Thread，不改全局设置。模型是否支持该约束由共享 provider owner 决定。

`exec review` 必须指定 `--uncommitted`、`--base <BRANCH>`、`--commit <SHA>` 或一条自定义审查指令；这些目标互斥，`--title` 只用于 commit。指令为 `-` 时读取 stdin 并去除首尾空白；显式指令忽略 pipe，空指令报错。审查通过共享 `review/start` 执行，CLI 不读取 git 或构建独立审查后端；JSON、human 和 `-o` 复用已有输出行为。按 Codex 语义，review 不消费 root PROMPT、图片或 output-schema。
顶层 `lime review` 复用同一目标、stdin 和审查执行，默认 human 输出；连接、权限与 locale
继承 root 参数。需要 JSON 或最后消息文件时使用 `lime exec review`。

插件管理通过与 Desktop 共用的 App Server JSON-RPC；正在按 Codex current 重构，合同与
未完成项见 `internal/roadmap/plugin/codex-contract.md` 和
`internal/exec-plans/codex-plugin-reconstruction.md`。当前 `plugin list` 发现用户目录、
当前工作目录和已配置的本地 marketplace；`-C <DIR>` 显式发现指定目录下的
`.agents/plugins/marketplace.json`。`--available` 仅允许和 `--json` 一起使用，用于表达需要同时
查看未安装条目的意图；JSON 默认只保留已安装条目，`--available` 才保留 catalog 返回的全部
installed/available 状态。
安装身份为 `name@marketplace`，启停走共享 `config/batchWrite`。旧 Plugin v3、独立 UI runtime、
私有 token 和 Connector 交付链已删除。安装与详情通过市场定位加插件名称请求，安装返回授权策略与
待授权 Apps；没有目录直装接口。本地四组公开合同已通过新产物验收。市场来源通过
`plugin marketplace add/list/upgrade/remove` 管理，共享 `marketplaces` 配置：本地市场引用源目录，
Git市场暂存验证后激活快照；移除市场不删除源目录或卸载插件。相对来源路径遵循 `-C`，Git支持
`owner/repo[@ref]`、HTTP(S)/SSH URL、`--ref` 与重复 `--sparse`。本地/Git公共接口和新产物CLI验收已通过；
托管配置、升级后的完整组件刷新、Desktop市场管理入口、远程marketplace、账号授权与两仓发布闭环
仍由P03/P04跟踪；CLI只消费同一App Server owner。

权限选项同样适用于默认 `lime`、`lime tui` 和 `lime resume`。`--approve-for-me` 的隐藏 alias
是 `--not-so-yolo`；危险绕过的 alias 是 `--yolo`。root 级权限参数会继承到 `exec`/`resume`，
子命令显式权限组覆盖 root。`--permissions <PROFILE>` 与显式 sandbox 互斥，冲突会在连接
App Server 前直接失败。

交互式 TUI 支持 `zh-CN`、`zh-TW`、`en-US`、`ja-JP`、`ko-KR`。可通过默认 `lime`、`lime tui` 或 `lime resume` 的 `--locale <LOCALE>` 指定；未指定时按 `LIME_LOCALE`、`LC_ALL`、`LANG` 解析，未知语言回退到 `en-US`。`exec` 与管理命令的 JSON 合同保持语言无关。

### TUI 按键配置

TUI 与 Desktop 共用 Lime 用户配置 owner。`lime`、`lime tui` 和独立 `lime resume` picker 会在
进入 alternate screen 前通过 App Server `config/read` 读取 `tui.keymap`，并在当前进程内冻结为
不可变 snapshot；修改后需重启 TUI。

```yaml
tui:
  keymap:
    global:
      find_transcript: ctrl-x f
    pager:
      find: [f3, /]
      page_down: [page-down, space, ctrl-f]
    agents:
      resume: []
```

当前支持的 context/action：

- `global`：`open_agents`、`open_transcript`、`find_transcript`
- `pager`：`scroll_up`、`scroll_down`、`page_up`、`page_down`、`half_page_up`、
  `half_page_down`、`jump_top`、`jump_bottom`、`close`、`close_transcript`、`find`
- `agents`：`resume`、`search`、`new_task`、`rename`、`stop`、`toggle_grouping`
- `list`：`move_up`、`move_down`、`move_left`、`move_right`、`page_up`、`page_down`、
  `jump_top`、`jump_bottom`、`accept`、`cancel`；当前 resume/fork、模型/推理强度 picker、
  `/subagents` 和 Agent Center 消费，其它选择器尚未接入。

`/subagents` 与模型选择共用底部无边框列表，默认定位当前 canonical 线程，显示 Agent 路径、
状态点和线程 ID。确认/返回提示来自真实配置；分页按实际可见条目计算，Ctrl+D 不再固定关闭。

会话列表的导航、确认/取消和底部提示使用同一配置 snapshot；显式 unbind 不回退 Enter/Esc。
默认 `Ctrl+F/Ctrl+B` 翻页，Tab 聚焦后用左右键或 `Ctrl+H/Ctrl+L` 改变筛选/状态/排序；旧
`Ctrl+F` 筛选、`Ctrl+S` 状态、`Ctrl+R` 排序不保留。可打印导航键优先编辑搜索；
`Ctrl+C`、`Ctrl+O/T/E`、Tab/Shift+Tab 和 Backspace 为 picker 保留，冲突配置显式拒绝。

值可为单个按键字符串、有序 alternatives 数组、最多两段且以空格分隔的 chord，或空数组
显式 unbind。未知字段、非法键名和同 context 冲突会 fail closed。composer/editor/Vim 尚未接入，
也没有 TUI 私有配置文件或按键环境变量。

本地连接默认启动同目录或 `PATH` 中的 `app-server`。可用 `LIME_APP_SERVER_BIN` 或 `--app-server <PATH>` 覆盖。需要连接远端 App Server 时使用 Codex 形状的参数：

```bash
lime exec --remote wss://cloud.example/rpc --remote-auth-token-env LIME_REMOTE_TOKEN "review this diff"
lime tui --remote ws://127.0.0.1:4500
```

远端 token 只从环境变量读取；token 连接要求 `wss://` 或 loopback `ws://`。当前仅提供 transport foundation，不代表生产 Cloud endpoint、租户或账号能力已启用。

## 发布

```bash
python3 scripts/build_npm_package.py \
  --package lime \
  --release-version 1.140.0 \
  --pack-output dist/lime-npm-1.140.0.tgz
```

平台包使用 `--package lime-<platform>-<arch> --vendor-src <vendor-root>` staging。`vendor-root` 必须使用 `vendor/<target-triple>/bin` 布局并包含完整 runtime payload。发布工作流先串行发布四个平台版本，最后发布 `@limecloud/lime` 根版本。
