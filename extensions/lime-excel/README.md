# Lime Excel 电脑操控

此目录是 Excel Office.js 加载项，操作当前已打开的工作簿，包含未保存的工作簿。不是离线 OOXML 编辑器。需要 Microsoft Excel 与 ExcelApi 1.1。

在 Lime「设置 → 集成 → 电脑操控」开启 Microsoft Excel，点击「管理 → 安装并打开」。安装器为本机生成独立证书、配对信息与 Lime.xml，并启动只绑定 loopback 的 HTTPS 适配器。安装器不会修改系统证书信任；按系统流程信任导出的 localhost 证书后，在 Excel 加载 Lime.xml。macOS 上已存在的 Excel 容器会收到本机 sideload manifest；Windows 通过 Office 的受信任加载项目录加载导出的 manifest。

在 Lime 管理页选择工作簿，再在 Excel 侧栏明确允许本次会话。关闭加载项或工作簿会使 heartbeat 到期，原有 session 与 target 不再可执行。授权绑定同一 App Server 连接、工作簿、回合和租约；CLI 与 Desktop 共用同一个工具 owner。

支持工作表发现、范围读取、值写入与公式写入；每次最多 1000 个单元格。写后必须实际读取结果。Office.js 不提供事务，写入或回读失败返回 outcome_unknown 并阻止后续写入，直到成功读取受影响范围；同一请求 ID 不重放写入。

此实现的 transport 是 Lime 本机 HTTPS 适配，与原版私有 transport 的源码可得性分开记录。本机尚未发现 Microsoft Excel，真实 Excel 与 Windows 验收必须在相应宿主上完成；协议测试不替代实机验收。
