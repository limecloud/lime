# 浏览器原生补丁

状态：候选，未编译、未进入产品运行时。当前产品仍使用 stock Electron，原生范围清理、密码、Autofill、扩展和导入均不能据此标记完成。

原生构建的只读预检入口：

```bash
node "scripts/electron/browser-engine-preflight.mjs" --target "darwin-arm64"
node "scripts/electron/browser-engine-preflight.mjs" --target "win32-x64"
```

默认完整源码位置为原仓库内 `.lime/browser-engine/src/{electron,...}`；可用 `--checkout` 指定仓库内的其它位置，拒绝外部目录和符号链接逃逸。脚本不下载、不安装、不更改系统设置或源码；退出 2 表示构建条件未满足。输出包括实际工具探测、源码 revision、补丁完整性、保守的 200 GiB 新 checkout/构建空间预算及结构化 GN/Ninja 构建计划。空间预算是本工程预留值，不冒充上游 macOS/Windows 官方最低要求。

macOS 必须有完整 Xcode；Windows 必须在具备 MSVC/SDK 的原生构建环境执行。源码/环境预检成功只允许继续编译，不证明任何浏览器服务完成。当前构建计划只覆盖现有清理补丁；密码、联系人 Autofill、Profile 导入与完整扩展仍需在同一 BrowserContext 接入组件并通过原生回归。Forge 在获得并验证实际自定义引擎分发包前继续使用 stock Electron，不能拿现有 Windows workflow 的 main 构建代替本地未提交候选。

`clear-data-since.patch` 固定针对 Electron commit `22bbbc9f265d4b6f138f6dc7451891241037a780`（v42.3.3），对应 Chromium commit `e1d853ded38ac7d1c5a4c83f3e30dfbf76b10c34`。补丁只扩展原 Session/BrowsingDataRemover 调用链，不引入第二 Profile 或数据服务。

新增原生方法：`session.clearDataSince(since, options)`。`since` 是非负、有限、整数的 Unix 毫秒；`options.dataTypes` 必须显式提供已知类型的非空数组。缺失、畸形、未知类型或无法精确表示的时间在任何删除启动前同步抛出 TypeError。现有 `clearData()` 保持全时段合同。原生独立方法使 stock runtime 显式缺失该能力，不能靠向旧 `clearData()` 传递会被忽略的参数检测支持。

这是一条下界到 `base::Time::Max()` 的原生删除路径，适配产品的最近一小时／一天／七天／四周；全部时间继续使用 `clearData()`。时间、origin 和注册域过滤始终交给同一个 Chromium BrowserContext。历史和下载仍由 Lime 既有 owner 管理，产品接线不得使用 Chromium 下载管理器替代 Lime 下载记录。

时间范围保留 Chromium 原生粒度：Cookie 按创建时间；localStorage 按 storage key 最后修改时间整站删除；Quota 数据按最后修改的 bucket 整桶删除。localStorage 清理还会清除匹配的 sessionStorage，后者没有时间过滤；cache 清理会附带使无时间过滤能力的 CORS preflight、内存资源、BFCache 等失效。不能将此方法解释为“每一个 key／缓存条目都按时间精确删除”。参考安装包 Owl 的内部算法仍未知，本补丁不证明与其原生实现一致。

补丁同时更新上游 Session 声明、文档和 `spec/api-session-spec.ts`。原生回归包含非法参数零删除、Cookie 时间内外保留、注册域过滤、跨 Session 隔离、并发任务以及真实 HTTP 缓存回源计数。未编译时这些回归均为未运行，语法／类型检查不能替代原生测试。

在已按官方 DEPS 和完整 Electron patch series 准备的 checkout 内执行：

```bash
git apply --check "/absolute/path/to/lime/electron/patches/clear-data-since.patch"
git apply "/absolute/path/to/lime/electron/patches/clear-data-since.patch"
```

随后按该 revision 的官方构建和 spec runner 生成类型、构建并运行新增 `ses.clearDataSince()` 回归，以及原 `ses.clearData()` 回归。这里不提供未经验证的构建成功命令；本机只有有界源码，尚无完整 Xcode/GN 工具链。

运行时探针要求一个尚不存在的绝对目录作为隔离数据目录，只创建内存 Session，不执行清理、不读取个人 Profile。它将实际 Electron/Chromium 版本与方法存在性输出为 JSON：

```bash
"/absolute/path/to/Electron" "/absolute/path/to/lime/electron/patches/probe-clear-data.cjs" "/absolute/path/to/new-probe-profile"
```

exit 2 表示缺少方法；exit 0 仅表示绑定存在，不证明 native 回归、清理成功或产品 UI 验收。取得实际二进制、原生测试和平台证据后，才允许修改 BrowserDataHost 的能力声明和产品接线。源锁、适配结果、stock 探针及本轮边界记录在 [本轮验证目录](../../internal/exec-plans/artifacts/codex-in-app-browser-20261022/native-clear-range-20261023/)。
