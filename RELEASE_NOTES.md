## Lime v0.95.1

### ✨ 主要更新

- **云端账户闭环接入收口**：个人中心统一承接登录、会话刷新和退出，Providers 页改成只消费这份云端会话，不再额外维护独立登录表单
- **Google 一键登录回流桌面端**：桌面 OAuth 回调支持拿到 session token 后立即补拉 bootstrap、写回本地会话，并把登录成功后的跳转路径带回客户端
- **云端 Provider 最终态改为服务端驱动**：客户端不再猜测接入模式、配置模式、模型来源和开发者入口，而是直接消费 control-plane 返回的最终态字段
- **模型目录与默认来源同步治理**：默认来源切到云端时，内部 compat `lime-hub` Provider 会自动同步网关地址、品牌名和服务端模型目录；切回本地时会清空云端模型目录，避免旧配置残留
- **本地 / 第三方 Provider 面板重新分层**：设置页把“云端入口”和“本地 / 第三方开发者配置”拆开，云端消费态、套餐状态和模型目录单独展示，避免与 API Key 管理混在一起
- **服务技能目录接入云端 bootstrap**：启动时与 OAuth 登录完成后都会同步服务技能目录，保障客户端在登录后即可直接拿到云端下发的技能目录
- **OEM 运行时配置继续去硬编码**：默认桌面客户端标识改成中性 `desktop-client`，品牌、域名与登录入口继续由运行时配置文件注入，方便后续打包替换

### ⚠️ 兼容性说明

- 现网包发布仍由 `v*` tag 触发，`RELEASE_NOTES.md` 会直接作为 GitHub Release 正文；只推 `main` 不会自动出包
- 云端登录、模型目录和服务技能目录都依赖运行时注入的控制面 / Gateway 域名与租户配置；打包前请确认 `public/oem-runtime-config.js` 已替换为目标环境值
- 云端默认来源与开发者 API Key 模式现在由服务端治理；如果后台关闭开发者入口，客户端仍会保留本地 / 第三方 Provider 管理，但不会再把云端入口误当作普通 API Key Provider 展示

### 🔗 依赖同步

- 应用版本同步提升到 `v0.95.1`，覆盖 `package.json`、Tauri 配置与 Rust workspace/package 入口
- 云端运行时默认客户端标识调整为 `desktop-client`，供不同品牌包在打包阶段覆写

### 🧪 测试

- 发布前执行：`npm run verify:app-version`
- 发布前执行：`npm test -- src/hooks/useOemLimeHubProviderSync.test.tsx src/lib/oemCloudSession.test.ts src/hooks/useOemCloudAccess.test.tsx src/components/settings-v2/agent/providers/index.test.tsx src/components/settings-v2/account/user-center-session/index.test.tsx src/lib/api/oemCloudControlPlane.test.ts src/lib/api/oemCloudRuntime.test.ts`
- 发布前执行：`npm run governance:legacy-report`
- 发布前执行：`npm run test:contracts`

### 📝 文档

- 发布说明随 `RELEASE_NOTES.md` 更新，供 GitHub Release 工作流直接读取
- 运行时配置示例随 `public/oem-runtime-config.js` 一并更新，避免桌面 OAuth 客户端标识继续写死旧品牌值

---

**完整变更**: v0.95.0...v0.95.1
