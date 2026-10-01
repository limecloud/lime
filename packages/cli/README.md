# `@limecloud/lime`

Lime 的官方命令行入口。CLI、TUI 和 Desktop 共用 App Server JSON-RPC、RuntimeCore 与 canonical Thread/Turn/Item，不包含独立任务 runtime。

本包只负责终端版本（CLI/TUI），不包含 Electron Desktop GUI。Desktop 请查看仓库根目录 README 的[版本选择与安装说明](https://github.com/limecloud/lime#choose-a-product-surface)。

## 安装

```bash
npm install -g @limecloud/lime
```

需要 Node.js 18 或更高版本。安装根包时会根据当前操作系统和 CPU 自动解析 optional platform package；无需单独下载或安装 `app-server`。

根 npm 包只包含 launcher，并通过 optional dependency 安装当前平台的原生载荷；安装阶段不执行网络下载脚本。平台载荷原子包含 `lime`、`app-server`、`code-mode-host`、Windows sandbox helpers 和所需动态库，保证默认 TUI 与 `exec` 都进入同一 App Server 产品链。

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
lime exec --jsonl "review this diff"

# Codex-shaped approval/sandbox controls (also accepted before exec/resume)
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
lime plugin list
lime plugin list --available --json --plugin-cwd ./workspace
lime plugin add ./path/to/plugin --marketplace workspace --source repo
lime plugin read <plugin-id> --json
lime plugin search <term> --scope workspace --plugin-cwd ./workspace
lime plugin enable <plugin-id>
lime plugin disable <plugin-id>
lime plugin remove <plugin-id>
```

`--json` 输出可读的稳定 JSON；`--jsonl` 输出单行 JSON envelope，二者互斥。`completion` 从同一命令树生成 bash、zsh、fish、PowerShell 和 elvish 脚本。

Plugin 管理只通过 App Server JSON-RPC 的当前 Plugin v3 catalog。`plugin list` 默认发现用户目录、
当前工作目录和已配置的本地 marketplace；`--plugin-cwd <DIR>` 显式发现指定目录下的
`.agents/plugins/marketplace.json`。`--available` 仅允许和 `--json` 一起使用，用于表达需要同时
查看未安装条目的意图；JSON 默认只保留已安装条目，`--available` 才保留 catalog 返回的全部
installed/available 状态。
Codex 的远程 marketplace、账号、缓存刷新和 marketplace add/remove/upgrade 不属于 Lime current，
不会由 CLI 伪造或绕过 App Server。

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
