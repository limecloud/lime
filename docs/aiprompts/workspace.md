# Workspace 设计文档

## 概述

Workspace 是 Lime 应用层的概念，用于组织和管理 AI Agent 的工作上下文。它是对 Aster 框架 `Session.working_dir` 的命名和配置包装，不修改 Aster 框架本身。

## 设计背景

### 行业调研

基于对 Cursor、Claude Code、Manus、AI21 等产品的调研，总结出以下关键洞察：

| 来源 | 核心观点 |
|------|---------|
| Manus (philschmid.de) | "Share memory by communicating, don't communicate by sharing memory" |
| AI21 | "Agents that only read can share an environment. Agents that write need isolation" |
| Cursor | Shadow Workspace 实现后台 AI 迭代，不影响用户体验 |
| Claude Code | 通过 `--add-dir` 支持多目录，`CLAUDE.md` 实现层级配置 |

### 核心原则

1. **读共享，写隔离** - 只读操作可以共享环境，写操作需要隔离
2. **最小有效 context** - 只传递必要的 context，避免 context pollution
3. **Workspace = 边界** - 文件系统边界 + context 边界 + 配置边界

## 文件工作区优先规则

对 Lime 的通用工作区，真实文件是第一事实源，`artifact` 只作为增强层存在。

固定实施规则：

1. 用户显式打开项目文件、导出 Markdown、历史任务里的真实文件时，右侧预览必须直接消费真实文件内容，不得先合成 `artifact` 再打开。
2. `artifact` 继续承担结构化增量写入、工具过程增强、viewer 能力增强，但不能反向定义“当前主稿是什么”。
3. 当通用工作区正在预览一个具名真实文件时，默认 artifact 自动选中必须让位，避免画布漂移到 `*.artifact.json` 或其他包装稿。
4. Markdown 预览要以当前文件路径作为基准解析相对图片路径，保证同目录 `images/` 等资源能直接渲染。
5. 文件标题、默认预览、工作台下载/打开动作应尽量保留项目内相对路径；只有在实际读取磁盘时才解析绝对路径。

## 架构设计

### 层级关系

```
┌─────────────────────────────────────────────────────────────────┐
│                    Lime (应用层)                            │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Workspace 管理                                             ││
│  │  - WorkspaceManager: CRUD 操作                              ││
│  │  - WorkspaceSettings: workspace 级配置                      ││
│  │  - 通过 working_dir 关联 Aster Session                      ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    Aster (框架层) - 不修改                       │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │  Session 管理                                               ││
│  │  - SessionManager: Session CRUD                             ││
│  │  - Session.working_dir: 工作目录                            ││
│  │  - Conversation: 对话历史                                   ││
│  │  - EnhancedContextManager: context 压缩                     ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### 与 Aster Session 的关系

- Workspace 通过 `root_path` 与 Aster `Session.working_dir` 关联
- 一个 Workspace 可以包含多个 Session（同一 working_dir）
- Lime 按 Workspace 分组显示 Session 列表



## 数据模型

### Workspace 类型定义

```rust
// lime/src-tauri/src/workspace/types.rs

use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use chrono::{DateTime, Utc};

/// Workspace 唯一标识
pub type WorkspaceId = String;

/// Workspace 类型
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum WorkspaceType {
    #[default]
    Persistent,  // 持久化 workspace
    Temporary,   // 临时 workspace（自动清理）
}

/// Workspace 元数据
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Workspace {
    pub id: WorkspaceId,
    pub name: String,
    pub workspace_type: WorkspaceType,
    pub root_path: PathBuf,           // 对应 Aster Session.working_dir
    pub is_default: bool,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub settings: WorkspaceSettings,
}

/// Workspace 级别设置
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct WorkspaceSettings {
    pub mcp_config: Option<serde_json::Value>,  // workspace 级 MCP 配置
    pub default_provider: Option<String>,        // 默认 provider
    pub auto_compact: bool,                      // 是否允许运行时自动压缩上下文；关闭后只保留手动压缩
}
```

### 数据库 Schema

```sql
-- lime 应用数据库
CREATE TABLE workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    workspace_type TEXT NOT NULL DEFAULT 'persistent',
    root_path TEXT NOT NULL UNIQUE,  -- 对应 Aster Session.working_dir
    is_default BOOLEAN DEFAULT FALSE,
    settings_json TEXT DEFAULT '{}',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_workspaces_root_path ON workspaces(root_path);
```



## 核心接口

### WorkspaceManager

```rust
// lime/src-tauri/src/workspace/manager.rs

impl WorkspaceManager {
    /// 创建新 workspace
    pub async fn create(&self, name: String, root_path: PathBuf) -> Result<Workspace>;
    
    /// 获取 workspace
    pub async fn get(&self, id: &WorkspaceId) -> Result<Workspace>;
    
    /// 列出所有 workspace
    pub async fn list(&self) -> Result<Vec<Workspace>>;
    
    /// 更新 workspace
    pub async fn update(&self, id: &WorkspaceId, updates: WorkspaceUpdate) -> Result<Workspace>;
    
    /// 删除 workspace
    pub async fn delete(&self, id: &WorkspaceId) -> Result<()>;
    
    /// 设置默认 workspace
    pub async fn set_default(&self, id: &WorkspaceId) -> Result<()>;
    
    /// 获取默认 workspace
    pub async fn get_default(&self) -> Result<Option<Workspace>>;
    
    /// 获取 workspace 下的所有 sessions（通过 working_dir 关联）
    pub async fn list_sessions(&self, workspace_id: &WorkspaceId) -> Result<Vec<Session>> {
        let workspace = self.get(workspace_id).await?;
        
        // 使用 Aster 的 SessionManager，按 working_dir 过滤
        let all_sessions = aster::session::SessionManager::list_sessions().await?;
        
        Ok(all_sessions
            .into_iter()
            .filter(|s| s.working_dir == workspace.root_path)
            .collect())
    }
    
    /// 在 workspace 中创建新 session
    pub async fn create_session(
        &self, 
        workspace_id: &WorkspaceId, 
        name: String
    ) -> Result<Session> {
        let workspace = self.get(workspace_id).await?;
        
        // 使用 Aster 的 SessionManager
        aster::session::SessionManager::create_session(
            workspace.root_path.clone(),
            name,
            aster::session::SessionType::User,
        ).await
    }
}
```

### Tauri 命令

```rust
// lime/src-tauri/src/commands/workspace_cmd.rs

#[tauri::command]
pub async fn workspace_create(name: String, root_path: String) -> Result<Workspace, String>;

#[tauri::command]
pub async fn workspace_list() -> Result<Vec<Workspace>, String>;

#[tauri::command]
pub async fn workspace_get(id: String) -> Result<Workspace, String>;

#[tauri::command]
pub async fn workspace_update(id: String, updates: WorkspaceUpdate) -> Result<Workspace, String>;

#[tauri::command]
pub async fn workspace_delete(id: String) -> Result<(), String>;

#[tauri::command]
pub async fn workspace_set_default(id: String) -> Result<(), String>;

#[tauri::command]
pub async fn workspace_list_sessions(workspace_id: String) -> Result<Vec<SessionInfo>, String>;

#[tauri::command]
pub async fn workspace_create_session(workspace_id: String, name: String) -> Result<String, String>;
```



## 目录结构

```
~/.aster/                              # Aster 框架目录（不修改）
├── config/
├── data/
│   └── sessions/
│       └── sessions.db                # Aster 管理的 session 数据库
└── state/

~/Library/Application Support/lime/  # Lime 应用目录
├── lime.db                       # 应用数据库（包含 workspaces 表）
├── credentials/                       # 凭证文件
└── workspaces/                        # workspace 级配置
    ├── default/
    │   └── mcp.json                   # workspace 级 MCP 配置
    └── my-project/
        └── mcp.json
```

## 前端组件

### WorkspaceSelector

```typescript
// lime/src/components/workspace/WorkspaceSelector.tsx

interface Workspace {
  id: string;
  name: string;
  rootPath: string;
  isDefault: boolean;
  workspaceType: 'persistent' | 'temporary';
}

export function WorkspaceSelector() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [current, setCurrent] = useState<Workspace | null>(null);
  
  useEffect(() => {
    invoke('workspace_list').then(setWorkspaces);
    invoke('workspace_get_default').then(setCurrent);
  }, []);
  
  const switchWorkspace = async (id: string) => {
    await invoke('workspace_set_default', { id });
    const ws = workspaces.find(w => w.id === id);
    setCurrent(ws || null);
    // 触发 session 列表刷新
  };
  
  return (
    <Select value={current?.id} onValueChange={switchWorkspace}>
      {workspaces.map(ws => (
        <SelectItem key={ws.id} value={ws.id}>
          <FolderIcon /> {ws.name}
        </SelectItem>
      ))}
      <SelectItem value="__new__">
        <PlusIcon /> 添加工作目录...
      </SelectItem>
    </Select>
  );
}
```

## 实现优先级

### Phase 1: 基础功能
1. 数据库 schema 迁移
2. WorkspaceManager 核心 CRUD
3. Tauri 命令实现
4. WorkspaceSelector 组件

### Phase 2: 集成功能
1. Session 列表按 Workspace 分组
2. 创建 Session 时自动关联当前 Workspace
3. Workspace 级别的 MCP 配置

### Phase 3: 高级功能
1. 临时 Workspace 支持
2. Workspace 导入/导出
3. Workspace 级别的 Provider 配置

## 设计决策

| 决策点 | 选择 | 理由 |
|--------|------|------|
| Workspace 存储位置 | Lime 应用层 | 不修改 Aster 框架，保持框架通用性 |
| 与 Session 关系 | 通过 working_dir 关联 | 利用 Aster 现有字段，无需修改框架 |
| 配置存储 | 独立目录 + 数据库 | 配置文件便于编辑，元数据存数据库 |
| 默认 Workspace | 支持 | 新 Session 自动关联默认 Workspace |

## 参考资料

- [Context Engineering for AI Agents](https://www.philschmid.de/context-engineering-part-2) - Manus 团队经验
- [Scaling State-Modifying AI Agents with MCP Workspaces](https://www.ai21.com/blog/stateful-agent-workspaces-mcp) - AI21 的 MCP Workspace 扩展
- [Iterating with shadow workspaces](https://www.cursor.com/blog/shadow-workspace) - Cursor 的 Shadow Workspace 实现
- [Managing Claude Code's Context](https://www.cometapi.com/managing-claude-codes-context/) - Claude Code 的 Context 管理
