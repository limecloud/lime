# 工具库

## 概述

前端工具库和 API 封装层。

## 目录结构

```
src/lib/
├── api/                # API 封装
│   ├── apiKeyProvider.ts
│   └── pluginUI.ts     # 插件元数据 API
├── config/             # 配置
│   └── providers.ts
├── types/              # 类型定义
│   └── provider.ts
├── errors/             # 错误处理
│   └── playwrightErrors.ts
├── tauri/              # Tauri 命令封装
├── utils/              # 工具函数
├── flowEventManager.ts # 流量事件管理
├── terminal-api.ts     # 终端 API
└── utils.ts            # 通用工具
```

## 核心模块

### Tauri 命令封装

```typescript
// src/lib/tauri/credentials.ts
export async function addCredential(provider: string, path: string) {
    return invoke<CredentialInfo>('add_credential', { provider, filePath: path });
}

export async function listCredentials() {
    return invoke<CredentialInfo[]>('list_credentials');
}
```

### 流量事件管理

```typescript
// src/lib/flowEventManager.ts
class FlowEventManager {
    private listeners: Map<string, Set<FlowEventListener>> = new Map();
    
    subscribe(event: string, listener: FlowEventListener) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, new Set());
        }
        this.listeners.get(event)!.add(listener);
        return () => this.listeners.get(event)?.delete(listener);
    }
    
    emit(event: string, data: any) {
        this.listeners.get(event)?.forEach(listener => listener(data));
    }
}

export const flowEventManager = new FlowEventManager();
```

### 工具函数

```typescript
// src/lib/utils.ts
export function cn(...classes: (string | undefined)[]) {
    return classes.filter(Boolean).join(' ');
}

export function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(ms: number) {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
}
```

## 相关文档

- [hooks.md](hooks.md) - React Hooks
- [components.md](components.md) - 组件系统
