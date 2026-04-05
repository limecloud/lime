# lib

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

前端工具库和 API 封装层。
包含 Tauri 命令封装、工具函数和服务类。

## 文件索引

- `artifact/` - Artifact 系统核心库（Requirements 1.1-1.5）
  - `types.ts` - Artifact 类型定义
- `writeFile/` - WriteFile 标签解析器
  - `parser.ts` - `<write_file>` 标签流式解析器
  - `index.ts` - 模块导出
- `api/` - API 调用封装
  - `apiKeyProvider.ts` - API Key Provider API 封装（Requirements 9.1）
  - `pluginUI.ts` - 插件 UI API（Requirements 3.1）
- `config/` - 配置模块
  - `providers.ts` - System Provider 预设配置（Requirements 3.1-3.6）
- `types/` - 类型定义模块
  - `provider.ts` - API Key Provider 系统类型定义（Requirements 5.1）
- `errors/` - 错误处理模块
  - `playwrightErrors.ts` - Playwright 登录错误处理（Requirements 5.1, 5.2, 5.3, 5.4）
- `tauri/` - Tauri 命令封装
- `utils/` - 通用工具函数
  - `apiKeyValidation.ts` - API Key 格式验证（Requirements 3.8）
  - `syntaxHighlight.ts` - 语法高亮工具
- `flowEventManager.ts` - 流量事件管理器
- `notificationService.ts` - 通知服务
- `terminal-api.ts` - 终端核心能力 API 封装（Terminal Core）
- `webview-api.ts` - Webview 管理 API（Tauri 2.x multiwebview）
- `utils.ts` - 通用工具函数

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
