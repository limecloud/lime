# 快速驱动

本地 helper 仅依赖 Python 标准库与阿里云官方 CLI，不购买、删除实例或保存密码。

改动 helper 后可在本地运行离线回归，不读取账号或调用云接口：

```bash
PYTHONDONTWRITEBYTECODE=1 python3 -m unittest discover \
  -s ".codex/skills/lime-windows-cloud-test/scripts" -p "test_*.py" -v
```

## 配置与复用

默认状态目录 `~/.local/share/lime-cloud-test/`；`LIME_WUYING_STATE_DIR` 可为一次任务选择独立目录。账号字段见 [default-template.json](default-template.json) 的 `account`，填写后保存为状态目录内 `account.json`。官方 CLI 依次从 `LIME_WUYING_CLI`、`account.cli_path`、PATH、状态目录 `tools/aliyun` 解析。

复用有效 OAuth profile，不创建新 AccessKey。若用户选择复用 Shou 的测试环境，只读其非敏感账号和 CLI/钥匙串引用，另建 Lime 的元数据与测试目录；不复制 `~/.aliyun/config.json`、不改原项目 active 文件。

```bash
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" --help
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" adopt "$LIME_TEST_DESKTOP_ID" \
  --cloud-root "C:/Users/Public/LimeTest-$LIME_TEST_RUN_ID" \
  --evidence-run "$LIME_TEST_RUN_ID"
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" status
```

变量取本次资源清单，`adopt` 会只读核对地域、用户、办公网络与按量计费。随后把本次预算、`retain_until` 和关机/释放选择记入技能外 `active-desktop.json`。既有本轮授权继续使用；历史 Shou 的 ¥5 预算、规格、账号名和保留偏好不是 Lime 的默认授权。

只有候选与验收步骤就绪、费用已获授权后执行 `start`。`start/stop` 有界等待 45 秒；仍在转换中则用 `status` 观察，不重复投递。

## 源码身份与 overlay

Windows 从可信仓库取得完整的目标 SHA，构建缓存放测试根下的固定目录。只测试发布候选时以该 SHA 为准，不把本机所有脏改动带入。需要测试工作树时先盘点 staged/unstaged/untracked，再用重复 `--include` 选择本轮文件：

```bash
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" overlay "$LIME_REPO" "$LIME_OVERLAY_ZIP" \
  --include "electron/cloudGuestInstallations.test.ts"
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" upload "$LIME_OVERLAY_ZIP" "overlay.zip"
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" run "$LIME_PREPARE_SCRIPT"
```

示例文件替换成本轮实际写集；不带 `--include` 会收集全部当前非忽略改动。overlay 包含 `UI-OVERLAY-MANIFEST.json` 和本地 companion manifest；删除项、符号链接会拒绝。远端先检查本机给出的 ZIP SHA256，再解压并逐文件校验；同时核对 HEAD，不能只相信包内自带清单。摘要只证明来源，不能代替测试。

`upload/download` 分块校验长度与 SHA256，路径必须在本轮 `cloud_root` 内。适合小型补丁和结构化证据；大型安装包、Node/Rust 工具链优先从已核对的官方/CI HTTPS 来源在云端直接下载并校验摘要，避免大量 RunCommand 传输。

## 执行

```bash
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" run "$LIME_TEST_SCRIPT" --timeout 120
```

默认传 `EndUserId` 在已登录用户下运行；`--system` 仅用于明确授权的机器工具准备。先导出 `whoami`、会话、OS/架构和工具链，GUI 还需确认桌面解锁。远程脚本非零退出或 `Dropped != 0` 都失败，不因 API 总状态成功而忽略。

长构建由用户会话启动远程本地作业，持续落盘日志、阶段和退出码，再通过短只读脚本轮询。保存 `InvokeId`；提交结果未知时沿该 ID 查询，不重发安装/卸载等变更。具体 Lime 命令见 [Windows 验收入口](windows-validation.md)。

## 连接与截图

使用 Computer Use 当前应用清单和截图。参考环境的无影控制台为 `com.aliyun.wuying.osx`，实际远程窗口可能在 `com.aliyun.wuying.viewer`；运行时核对，不能只看控制台列表判断连接失败。已登录会话优先复用；密码只通过已授权的安全存储接口填入客户端，不写入命令输出、日志或源码。

保存原始完整远程桌面截图，另存裁剪图时保留原图。对比 macOS 时核对同候选、同内容尺寸及状态；布局基线以 Lime 的设计事实源为准。

## 导出与收尾

```bash
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" download "evidence/summary.json" "$LIME_LOCAL_SUMMARY"
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" stop
python3 ".codex/skills/lime-windows-cloud-test/scripts/wuying.py" status
```

本地命令回执默认在状态目录 `evidence/<run-id>/commands/`；最终产品证据放仓库 `.lime/verification/<run-id>/` 并记录其外部回执路径。部分下载不能称完整，通过前必须核对摘要。

`stop` 从运行态提交 `StopCharging`，轮询 `Stopped`；输出分别记录实际状态、本次是否请求与计费尚未核实。实例原本 `Stopped` 时不会重新投递，也不能据此排除此前使用 `KeepCharging`。`DescribeDesktops` 不返回停机计费模式，结合本轮请求回执与控制台/账单核对；模式未知时报告计算费未证明停止，不通过重启修正。磁盘仍收费。

用户选择释放时按[无影接口](aliyun-cli.md)对本轮精确实例执行并确认不存在，不能把关机当作释放。未实际配置计时器就不宣称自动收尾。
