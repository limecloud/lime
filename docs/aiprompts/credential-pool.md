# 凭证池管理

## 概述

凭证池管理系统实现多凭证轮询负载均衡、健康检查和自动 Token 刷新。

## 核心组件

```
src-tauri/src/
├── credential/              # 凭证池核心
│   ├── mod.rs
│   ├── pool.rs              # 凭证池实现
│   └── health.rs            # 健康检查
└── services/
    ├── provider_pool_service.rs  # 池服务
    └── token_cache_service.rs    # Token 缓存
```

## 凭证池架构

```
┌─────────────────────────────────────────────────────────────────┐
│                    ProviderPoolService                           │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                    Credential Pool                           ││
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐        ││
│  │  │ Cred 1  │  │ Cred 2  │  │ Cred 3  │  │ Cred N  │        ││
│  │  │ Healthy │  │ Healthy │  │ Expired │  │ Healthy │        ││
│  │  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘        ││
│  │       │            │            │            │              ││
│  │       └────────────┴────────────┴────────────┘              ││
│  │                         │                                    ││
│  │                    Round Robin                               ││
│  └─────────────────────────┼───────────────────────────────────┘│
│                            │                                     │
│  ┌─────────────────────────┼───────────────────────────────────┐│
│  │              Health Checker (定时任务)                       ││
│  │  - Token 过期检查                                            ││
│  │  - 自动刷新                                                  ││
│  │  - 不健康凭证剔除                                            ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

## 负载均衡策略

### Round Robin (轮询)

```rust
pub struct RoundRobinPool {
    credentials: Vec<CredentialEntry>,
    current_index: AtomicUsize,
}

impl RoundRobinPool {
    pub fn next(&self) -> Option<&CredentialEntry> {
        let healthy: Vec<_> = self.credentials
            .iter()
            .filter(|c| c.is_healthy())
            .collect();

        if healthy.is_empty() {
            return None;
        }

        let index = self.current_index
            .fetch_add(1, Ordering::Relaxed) % healthy.len();
        Some(healthy[index])
    }
}
```

### 权重轮询 (可选)

```rust
pub struct WeightedPool {
    credentials: Vec<(CredentialEntry, u32)>,  // (凭证, 权重)
}
```

## 健康检查

### 检查项目

| 检查项     | 说明               | 频率         |
| ---------- | ------------------ | ------------ |
| Token 过期 | 检查 expires_at    | 每次请求前   |
| Token 刷新 | 尝试刷新过期 Token | Token 过期时 |
| API 可用性 | 发送测试请求       | 定时 (5分钟) |

### 健康状态

```rust
pub enum HealthStatus {
    Healthy,                    // 健康
    TokenExpired,               // Token 过期
    TokenRefreshing,            // 正在刷新
    RefreshFailed(String),      // 刷新失败
    Unhealthy(String),          // 不健康
    Disabled,                   // 已禁用
}
```

### 自动恢复

```rust
// 健康检查任务
async fn health_check_task(pool: Arc<ProviderPoolService>) {
    loop {
        for credential in pool.credentials() {
            match credential.health_status() {
                HealthStatus::TokenExpired => {
                    // 尝试刷新
                    if let Err(e) = pool.refresh_token(&credential).await {
                        credential.set_status(HealthStatus::RefreshFailed(e));
                    }
                }
                HealthStatus::RefreshFailed(_) => {
                    // 重试刷新 (最多 3 次)
                    if credential.retry_count() < 3 {
                        pool.retry_refresh(&credential).await;
                    }
                }
                _ => {}
            }
        }

        tokio::time::sleep(Duration::from_secs(300)).await;
    }
}
```

## Token 缓存

### 缓存策略

```rust
pub struct TokenCacheService {
    cache: DashMap<String, CachedToken>,
}

struct CachedToken {
    access_token: String,
    expires_at: i64,
    refresh_token: String,
}

impl TokenCacheService {
    pub async fn get_or_refresh(&self, credential_id: &str) -> Result<String> {
        if let Some(cached) = self.cache.get(credential_id) {
            if !cached.is_expired() {
                return Ok(cached.access_token.clone());
            }
        }

        // 刷新并缓存
        let new_token = self.refresh(credential_id).await?;
        self.cache.insert(credential_id.to_string(), new_token.clone());
        Ok(new_token.access_token)
    }
}
```

### 数据库持久化

```sql
CREATE TABLE token_cache (
    credential_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

## 凭证生命周期

```
┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐
│ 上传    │ ──▶ │ 验证    │ ──▶ │ 激活    │ ──▶ │ 使用中  │
└─────────┘     └─────────┘     └─────────┘     └────┬────┘
                                                     │
                    ┌────────────────────────────────┘
                    │
                    ▼
              ┌─────────┐     ┌─────────┐     ┌─────────┐
              │ 过期    │ ──▶ │ 刷新    │ ──▶ │ 恢复    │
              └─────────┘     └────┬────┘     └─────────┘
                                   │
                                   ▼ (失败)
                             ┌─────────┐
                             │ 禁用    │
                             └─────────┘
```

## API 接口

### Tauri Commands

```rust
#[tauri::command]
async fn add_credential(provider: String, path: String) -> Result<()>;

#[tauri::command]
async fn remove_credential(id: String) -> Result<()>;

#[tauri::command]
async fn list_credentials() -> Result<Vec<CredentialInfo>>;

#[tauri::command]
async fn refresh_credential(id: String) -> Result<()>;

#[tauri::command]
async fn get_pool_status() -> Result<PoolStatus>;
```

## 相关文档

- [providers.md](providers.md) - Provider 系统
- [services.md](services.md) - 业务服务
- [database.md](database.md) - 数据库层

## 运行时路径与调试

- 凭证文件默认存放在应用数据目录下的 `lime/credentials/`
- `~/Library/Application Support/lime/credentials/` 只作为 macOS 示例，Windows 必须使用对应的应用数据目录
- `request_logs`、日志目录等运行时路径也应通过统一 `app_paths` / 系统目录 API 获取，不要在实现里写死
- 需要排查 Kiro 凭证加载时，可使用 `debug_kiro_credentials` 对应命令进行诊断；具体命令边界以 `docs/aiprompts/commands.md` 和 Rust 注册表为准
