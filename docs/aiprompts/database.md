# 数据库层

## 概述

使用 SQLite (rusqlite) 存储凭证元数据、流量记录等。

## 目录结构

```
src-tauri/src/database/
├── mod.rs          # 模块入口
├── schema.rs       # 表结构定义
├── migrations.rs   # 数据库迁移
└── dao/            # 数据访问对象
    ├── credential_dao.rs
    ├── flow_dao.rs
    └── config_dao.rs
```

## 表结构

### credentials

```sql
CREATE TABLE credentials (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    name TEXT NOT NULL,
    file_path TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

### token_cache

```sql
CREATE TABLE token_cache (
    credential_id TEXT PRIMARY KEY,
    access_token TEXT NOT NULL,
    refresh_token TEXT,
    expires_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    FOREIGN KEY (credential_id) REFERENCES credentials(id)
);
```

### flow_records

```sql
CREATE TABLE flow_records (
    id TEXT PRIMARY KEY,
    timestamp INTEGER NOT NULL,
    provider TEXT NOT NULL,
    model TEXT NOT NULL,
    request_json TEXT NOT NULL,
    response_json TEXT,
    status TEXT NOT NULL,
    latency_ms INTEGER,
    prompt_tokens INTEGER,
    completion_tokens INTEGER,
    created_at INTEGER NOT NULL
);

CREATE INDEX idx_flow_timestamp ON flow_records(timestamp);
```

## DAO 模式

```rust
pub struct CredentialDao {
    conn: Arc<Mutex<Connection>>,
}

impl CredentialDao {
    pub fn insert(&self, credential: &Credential) -> Result<()>;
    pub fn find_by_id(&self, id: &str) -> Result<Option<Credential>>;
    pub fn find_all(&self) -> Result<Vec<Credential>>;
    pub fn update(&self, credential: &Credential) -> Result<()>;
    pub fn delete(&self, id: &str) -> Result<()>;
}
```

## 数据库迁移

```rust
pub fn run_migrations(conn: &Connection) -> Result<()> {
    let version = get_schema_version(conn)?;
    
    if version < 1 {
        conn.execute_batch(include_str!("migrations/001_initial.sql"))?;
    }
    if version < 2 {
        conn.execute_batch(include_str!("migrations/002_add_flow.sql"))?;
    }
    
    set_schema_version(conn, CURRENT_VERSION)?;
    Ok(())
}
```

## 相关文档

- [services.md](services.md) - 业务服务
- [credential-pool.md](credential-pool.md) - 凭证池退役说明
