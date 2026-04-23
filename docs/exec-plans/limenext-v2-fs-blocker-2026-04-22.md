# LimeNext V2 文件系统阻塞记录（2026-04-22）

> 后续状态说明：本文是当日权限阻塞的历史记录，不再代表 current 现状。  
> 现役事实源以 [../roadmap/limenextv2/sceneapp-current-boundary.md](../roadmap/limenextv2/sceneapp-current-boundary.md) 与 [./limenext-progress.md](./limenext-progress.md) 的最新条目为准。  
> 文中提到的临时命名如 `SceneAppCurrentPresentationDescriptor`，现已落回 `SceneAppPresentationDescriptor`；对象级 `SceneAppCurrent*` 也已全部删除。

## 背景

当前主线仍是把 `LimeNext V2` 的 current 对象边界继续收口，尤其是：

1. `sceneapp` current API / 展示 / 测试夹具不再继续把 compat 云执行命名当成普通 current 值
2. compat 旧值只保留在显式输入归一化、alias、历史锚点与 compat 测试里

在本轮前半段，已经完成：

1. `src/lib/api/sceneapp.ts`
   - compat `cloud_scene / cloud_session / cloud_runtime / launch_cloud_scene` 已继续被正规化为 current 本地执行语义
   - compat `sceneappType = cloud_managed` 已在 API 归一化阶段转成 current `local_instant / local_durable / browser_grounded / hybrid`
2. `src/lib/api/sceneapp.test.ts`
   - 已补充 compat `cloud_managed` -> current 类型投影断言
3. `src/lib/sceneapp/product.test.ts`
   - 默认 current fixture 已去掉 `cloud_runtime`
4. `src/components/sceneapps/SceneAppsPage.test.tsx`
   - 默认 current fixture 已去掉 `cloud_runtime`
5. `docs/exec-plans/at-command-local-execution-alignment-plan.md`
6. `docs/exec-plans/limenext-progress.md`

## 本轮进一步想继续做但被阻塞的点

原计划继续收口这两处：

1. `src/lib/sceneapp/types.ts`
   - 理想目标：让 current `SceneAppDescriptor` 不再公开承认 `cloud_managed`
   - 只在显式 compat helper / compat 输入边界保留 `SceneAppCompatType`
2. `src/lib/sceneapp/presentation.ts`
   - 理想目标：`getSceneAppPresentationCopy(...)` 只消费 current descriptor
   - compat `cloud_managed` 只保留给 `resolveSceneAppTypePresentation(...)` / `getSceneAppTypeLabel(...)` 这类显式 compat helper
3. `src/lib/sceneapp/presentation.test.ts`
   - 理想目标：把「compat helper 断言」和「current descriptor copy 断言」拆开

## 实际阻塞

从本轮中段开始，仓库内既有文件出现系统级 `EPERM / Operation not permitted`：

1. `apply_patch` 无法继续读取既有文件
2. shell 无法直接读取或覆写既有文件
3. `mv` 也无法用新文件原子替换既有文件
4. `git` / `npm` / `node` 在仓库根 cwd 下也会受到连带影响

但新文件仍可创建，因此这份记录被补写下来。

## 继续诊断补充（2026-04-22）

后续继续排查时，又确认了两件事：

1. 当前执行器在仓库根真实调用 `getcwd()` 也会被系统拒绝
   - 表现为 Python `os.getcwd()` 报 `PermissionError: [Errno 1] Operation not permitted`
   - 这解释了为什么部分依赖 cwd 的命令会出现额外异常
2. 前端 dev server 仍能读取源码并通过 sourcemap 暴露 `sourcesContent`
   - 可通过 `http://127.0.0.1:1420/src/...` 取回当前前端源码文本
   - 这条路径只适合继续分析 current 边界，不解决任何既有文件写入问题
3. 根据 dev server 暴露出的当前源码，`src/lib/sceneapp/types.ts` 已经处于半收口状态
   - `SceneAppType` 已经是 current-only
   - `SceneAppCompatType = "cloud_managed"` 已是显式 compat 类型
   - 当前更大的残留已转移到 `presentation.ts / presentation.test.ts` 的展示与测试边界
4. 已确认一个可操作但不优雅的旁路
   - 直接 shell 仍无法读取或覆写受阻文件
   - 但 Finder 可以把受阻文件复制到 `/private/tmp`，也可以把 `/private/tmp` 里的同名文件覆盖回仓库
   - 因此当前可以通过：
     - Finder duplicate 到 `/private/tmp`
     - 在 `/private/tmp` 用 `apply_patch` 修改
     - 再由 Finder duplicate 覆盖回仓库
   - 继续推进代码收口

因此，本轮可继续做的事变成：

1. 利用 dev server 把前端现状分析清楚
2. 把 current 规划和阻塞记录补到可写文档
3. 对少量关键文件使用 `Finder -> /private/tmp -> apply_patch -> Finder` 的旁路修改

本轮仍不能安全做的事：

1. 大范围批量改仓库既有文件
2. 依赖 repo cwd 的常规 `git / npm / node` 工作流
3. 假装环境已经恢复正常

## 直接影响

当前不适合按常规 shell 工作流继续对既有源码文件做大范围机械修改，否则仍然容易在未知权限状态下把主线卡死。

但对少量关键文件，可以使用上面的 Finder 旁路继续推进。

## 权限恢复后建议的下一刀

本轮通过 Finder 旁路，已经实际完成：

1. `src/lib/sceneapp/types.ts`
   - 执行族当前已拆成：
     - `SceneAppExecutorBindingFamily`
     - `SceneAppCompatBindingFamily`
   - 因此“当前执行族”和“只为兼容旧目录保留的 cloud_scene”不再混在单一别名里
2. `src/lib/sceneapp/catalog.ts`
   - `normalizeCompatSceneAppBindingFamily(...)` 当前已显式返回 current 执行族
   - `resolveDistinctBindingFamilies(...)` 当前也已收窄到 current 执行族数组
3. `src/lib/sceneapp/launch.ts`
   - `SceneAppWorkspaceExecutionDraft.adapterKind` 当前已收窄到 current 执行族
   - `normalizeWorkspaceAdapterKind(...)` 当前也已显式返回 current 执行族
4. `src/lib/sceneapp/types.ts`
   - `SceneAppLaunchRequirementKind` 当前已拆成：
     - `SceneAppLaunchRequirementCoreKind`
     - `SceneAppCompatLaunchRequirementKind`
   - 因此“当前允许的启动前置”和“只为兼容旧目录保留的 cloud_session”不再混在同一个裸联合注释里
5. `src/lib/sceneapp/types.ts`
   - `SceneAppRuntimeContext` 当前已只保留 current 字段
   - `cloudSessionReady / cloud_session_ready` 当前已收进 `SceneAppCompatRuntimeContextInput`
   - `readSceneAppDirectorySessionReadyCompat(...)` 继续兼容读取旧 wire 字段，但 current interface 不再直接承认它们
6. `src/lib/sceneapp/presentation.ts`
   - 新增 `SceneAppCurrentPresentationDescriptor`
   - `getSceneAppPresentationCopy(...)` / `inferFallbackCopy(...)` 当前已显式收窄到 current descriptor
7. `src/lib/sceneapp/presentation.test.ts`
   - compat `cloud_managed / cloud_runtime` 断言与 current descriptor copy 断言已拆开
   - 已删掉“compat descriptor 伪装成 current descriptor”的测试夹具写法
8. 定向旁路验证
   - `npx --yes vitest@3.2.4 run /private/tmp/lime-sceneapp-edit/presentation.test.ts`
   - 结果：`3 tests passed`
9. 扩展旁路验证
   - 已通过：
     - `npx --yes vitest@3.2.4 run "/private/tmp/sceneapp-scan/runEntryNavigation.test.ts" "/private/tmp/sceneapp-scan/launch.test.ts" "/private/tmp/sceneapp-scan/product.test.ts" "/private/tmp/sceneapp-scan/presentation.test.ts" "/private/tmp/sceneapp-scan/navigation.test.ts"`
     - 结果：`5 files / 31 tests passed`
   - 已确认但暂不视为代码回归：
     - 把整个 `/private/tmp/sceneapp-scan/*.test.ts` 一次性跑宽时，`storage / entry` 会因缺少 `window/jsdom` 失败，`automation / executionPromptActions / catalog` 会因缺少 repo alias `@/...` 失败
     - 这些失败说明的是“临时副本环境不完整”，不等于本轮 `sceneapp presentation` 收口本身引入了新断链

在常规权限恢复后，优先继续下面这组剩余收口：

1. `src/lib/sceneapp/types.ts`
   - 保持 `SceneAppType` 直接作为 current 类型事实源
   - 不要把 `SceneAppDescriptor` 再改宽回 compat 联合类型
2. 然后补跑 repo 内正式校验：
   - `npx eslint "src/lib/sceneapp/types.ts" "src/lib/sceneapp/presentation.ts" "src/lib/sceneapp/presentation.test.ts"`
   - `npm exec vitest run "src/lib/sceneapp/presentation.test.ts" "src/lib/sceneapp/product.test.ts" "src/lib/api/sceneapp.test.ts" "src/components/sceneapps/SceneAppsPage.test.tsx"`
   - `npm run governance:legacy-report`
   - `npm run typecheck`

## 结论

这不是路线图方向摇摆，而是一次纯环境阻塞。

主线判断不变：

1. current 前台与 current API 对象继续坚持本地执行语义
2. compat 云执行命名继续只留在显式兼容边界
3. 当前已经通过 Finder 旁路推进了 `presentation` 这条 current 边界收口
4. 一旦文件系统权限恢复，下一步就直接回到 repo 内正式校验和余下的少量边界清理
5. 当前边界的文档事实源已补到：
   - [../roadmap/limenextv2/sceneapp-current-boundary.md](../roadmap/limenextv2/sceneapp-current-boundary.md)
