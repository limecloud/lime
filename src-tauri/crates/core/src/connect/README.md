# connect

<!-- 一旦我所属的文件夹有所变化，请更新我 -->

## 架构说明

Lime Connect 模块，实现中转商生态合作方案。
通过 Deep Link 协议实现一键配置功能，支持中转商品牌展示。
API Key 直接集成到 API Key Provider 主路径，不再进入旧凭证池系统。

## 功能概述

1. **Deep Link 处理** - 解析 `lime://connect` 协议 URL
2. **中转商注册表** - 从 GitHub 加载和管理中转商信息
3. **统计回调** - 向中转商发送配置结果回调（Webhook）

## 文件索引

- `mod.rs` - 模块入口，导出子模块
- `deep_link.rs` - Deep Link URL 解析器 ✅
  - `ConnectPayload` - 解析结果结构体
  - `DeepLinkError` - 错误类型枚举
  - `parse_deep_link()` - URL 解析函数
- `registry.rs` - 中转商注册表管理 ✅
  - `RelayRegistry` - 注册表管理器
  - `RelayInfo` - 中转商信息结构体
  - `RelayBranding` - 品牌信息
  - `RelayLinks` - 相关链接
  - `RelayApi` - API 配置
  - `RelayContact` - 联系方式
  - `RelayFeatures` - 功能特性
  - `RelayWebhook` - Webhook 配置
  - `RegistryError` - 错误类型
- `webhook.rs` - 统计回调服务 ✅
  - `CallbackPayload` - 回调数据结构
  - `CallbackStatus` - 回调状态枚举（success/cancelled/error）
  - `WebhookSender` - 回调发送器（支持重试）
  - `send_success_callback()` - 发送成功回调
  - `send_cancelled_callback()` - 发送取消回调
  - `send_error_callback()` - 发送错误回调

## 相关需求

- Requirements 1.x - Deep Link 协议处理
- Requirements 2.x - 中转商注册表管理
- Requirements 4.x - API Key 存储（已集成到 API Key Provider）
- Requirements 5.3 - 统计回调（Webhook）

## 更新提醒

任何文件变更后，请更新此文档和相关的上级文档。
