use rusqlite::Connection;

const LEGACY_WORKSPACE_TYPE_MIGRATION_ALIASES: &[&str] = &[
    "social",
    "social-media",
    "knowledge",
    "planning",
    "document",
    "video",
    "drama",
    "poster",
    "music",
    "novel",
];

fn drop_retired_agent_runtime_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    for index_name in [
        "idx_a2ui_forms_session",
        "idx_a2ui_forms_message",
        "idx_agent_thread_incidents_turn_status",
        "idx_agent_thread_incidents_thread_status_detected",
        "idx_agent_turn_outcomes_thread_ended",
        "idx_agent_thread_items_thread",
        "idx_agent_thread_turns_session_started_desc",
        "idx_agent_thread_turns_session",
        "idx_agent_messages_session_id_desc",
        "idx_agent_messages_session",
    ] {
        conn.execute(&format!("DROP INDEX IF EXISTS {index_name}"), [])?;
    }

    for table_name in [
        "a2ui_forms",
        "agent_thread_incidents",
        "agent_turn_outcomes",
        "agent_thread_items",
        "agent_thread_turns",
        "agent_messages",
    ] {
        conn.execute(&format!("DROP TABLE IF EXISTS {table_name}"), [])?;
    }

    Ok(())
}

pub fn create_tables(conn: &Connection) -> Result<(), rusqlite::Error> {
    drop_retired_agent_runtime_tables(conn)?;

    // API Key Provider 配置表
    // _Requirements: 9.1_
    conn.execute(
        "CREATE TABLE IF NOT EXISTS api_key_providers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            type TEXT NOT NULL,
            api_host TEXT NOT NULL,
            is_system INTEGER NOT NULL DEFAULT 0,
            group_name TEXT NOT NULL,
            enabled INTEGER NOT NULL DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            api_version TEXT,
            project TEXT,
            location TEXT,
            region TEXT,
            models TEXT,
            prompt_cache_mode TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;

    // Migration: 添加 models 列（如果不存在）
    let _ = conn.execute("ALTER TABLE api_key_providers ADD COLUMN models TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE api_key_providers ADD COLUMN prompt_cache_mode TEXT",
        [],
    );

    // 创建 api_key_providers 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_api_key_providers_group ON api_key_providers(group_name)",
        [],
    )?;

    // API Key 条目表
    // _Requirements: 9.1, 9.2_
    conn.execute(
        "CREATE TABLE IF NOT EXISTS api_keys (
            id TEXT PRIMARY KEY,
            provider_id TEXT NOT NULL,
            api_key_encrypted TEXT NOT NULL,
            alias TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            usage_count INTEGER NOT NULL DEFAULT 0,
            error_count INTEGER NOT NULL DEFAULT 0,
            last_used_at TEXT,
            created_at TEXT NOT NULL,
            FOREIGN KEY (provider_id) REFERENCES api_key_providers(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // 创建 api_keys 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_api_keys_provider ON api_keys(provider_id)",
        [],
    )?;

    // Provider UI 状态表
    // _Requirements: 8.4_
    conn.execute(
        "CREATE TABLE IF NOT EXISTS provider_ui_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Providers 表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS providers (
            id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            name TEXT NOT NULL,
            settings_config TEXT NOT NULL,
            category TEXT,
            icon TEXT,
            icon_color TEXT,
            notes TEXT,
            created_at INTEGER,
            sort_index INTEGER,
            is_current INTEGER DEFAULT 0,
            PRIMARY KEY (id, app_type)
        )",
        [],
    )?;

    // MCP 服务器表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS mcp_servers (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            server_config TEXT NOT NULL,
            description TEXT,
            enabled_lime INTEGER DEFAULT 0,
            enabled_claude INTEGER DEFAULT 0,
            enabled_codex INTEGER DEFAULT 0,
            enabled_gemini INTEGER DEFAULT 0,
            created_at INTEGER
        )",
        [],
    )?;

    // Migration: 补齐历史 mcp_servers 表缺失的启用列与 created_at 字段
    let _ = conn.execute(
        "ALTER TABLE mcp_servers ADD COLUMN enabled_lime INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE mcp_servers ADD COLUMN enabled_claude INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE mcp_servers ADD COLUMN enabled_codex INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE mcp_servers ADD COLUMN enabled_gemini INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute("ALTER TABLE mcp_servers ADD COLUMN created_at INTEGER", []);

    // Prompts 表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS prompts (
            id TEXT NOT NULL,
            app_type TEXT NOT NULL,
            name TEXT NOT NULL,
            content TEXT NOT NULL,
            description TEXT,
            enabled INTEGER DEFAULT 0,
            created_at INTEGER,
            updated_at INTEGER,
            PRIMARY KEY (id, app_type)
        )",
        [],
    )?;

    // Migration: rename is_current to enabled if old column exists
    let _ = conn.execute(
        "ALTER TABLE prompts RENAME COLUMN is_current TO enabled",
        [],
    );

    // Migration: add updated_at column if it doesn't exist
    let _ = conn.execute("ALTER TABLE prompts ADD COLUMN updated_at INTEGER", []);

    // 设置表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        )",
        [],
    )?;

    // Skills 表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS skills (
            directory TEXT NOT NULL,
            app_type TEXT NOT NULL,
            installed INTEGER NOT NULL DEFAULT 0,
            installed_at INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (directory, app_type)
        )",
        [],
    )?;

    // Skill Repos 表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS skill_repos (
            owner TEXT NOT NULL,
            name TEXT NOT NULL,
            branch TEXT NOT NULL DEFAULT 'main',
            enabled INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (owner, name)
        )",
        [],
    )?;

    // 旧凭证池表：只读保留为后续 manifest 驱动迁移的 source
    conn.execute(
        "CREATE TABLE IF NOT EXISTS provider_pool_credentials (
            uuid TEXT PRIMARY KEY,
            provider_type TEXT NOT NULL,
            credential_data TEXT NOT NULL,
            name TEXT,
            is_healthy INTEGER DEFAULT 1,
            is_disabled INTEGER DEFAULT 0,
            check_health INTEGER DEFAULT 1,
            check_model_name TEXT,
            not_supported_models TEXT,
            usage_count INTEGER DEFAULT 0,
            error_count INTEGER DEFAULT 0,
            last_used INTEGER,
            last_error_time INTEGER,
            last_error_message TEXT,
            last_health_check_time INTEGER,
            last_health_check_model TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // 创建 provider_type 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_provider_pool_type ON provider_pool_credentials(provider_type)",
        [],
    )?;

    // Migration: 添加 Token 缓存字段
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN cached_access_token TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN cached_refresh_token TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN token_expiry_time TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN last_refresh_time TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN refresh_error_count INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN last_refresh_error TEXT",
        [],
    );

    // Migration: 添加凭证来源字段
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN source TEXT DEFAULT 'manual'",
        [],
    );

    // Migration: 添加代理URL字段 - 使用重建表结构的方式
    // 注意：这个迁移会重建整个表，所以 supported_models 列需要在这之后添加
    migrate_add_proxy_url_column(conn)?;

    // Migration: 添加支持的模型列表字段
    // 必须在 migrate_add_proxy_url_column 之后执行，因为那个函数可能会重建表
    let _ = conn.execute(
        "ALTER TABLE provider_pool_credentials ADD COLUMN supported_models TEXT",
        [],
    );

    // ============================================================================
    // Orchestrator 相关表
    // ============================================================================

    // 模型元数据表
    // 存储模型的静态信息，用于智能选择
    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_metadata (
            model_id TEXT PRIMARY KEY,
            provider_type TEXT NOT NULL,
            display_name TEXT NOT NULL,
            family TEXT,
            tier TEXT NOT NULL DEFAULT 'pro',
            context_length INTEGER,
            max_output_tokens INTEGER,
            cost_input_per_million REAL,
            cost_output_per_million REAL,
            supports_vision INTEGER DEFAULT 0,
            supports_tools INTEGER DEFAULT 0,
            supports_streaming INTEGER DEFAULT 1,
            is_deprecated INTEGER DEFAULT 0,
            release_date TEXT,
            description TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // 创建 model_metadata 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_metadata_provider
         ON model_metadata(provider_type)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_metadata_tier
         ON model_metadata(tier)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_metadata_family
         ON model_metadata(family)",
        [],
    )?;

    // 用户等级偏好表
    // 存储用户对每个服务等级的策略偏好
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_tier_preferences (
            tier_id TEXT PRIMARY KEY,
            strategy_id TEXT NOT NULL DEFAULT 'task_based',
            preferred_provider TEXT,
            fallback_enabled INTEGER DEFAULT 1,
            max_retries INTEGER DEFAULT 3,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // ============================================================================
    // Lime Connect 相关表
    // ============================================================================

    // ============================================================================
    // Model Registry 相关表
    // ============================================================================

    // 增强的模型注册表
    // 存储从 models.dev API 获取的模型数据 + 本地补充的国内模型数据
    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_registry (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            provider_id TEXT NOT NULL,
            provider_name TEXT NOT NULL,
            family TEXT,
            tier TEXT NOT NULL DEFAULT 'pro',
            capabilities TEXT NOT NULL DEFAULT '{}',
            pricing TEXT,
            limits TEXT NOT NULL DEFAULT '{}',
            status TEXT NOT NULL DEFAULT 'active',
            release_date TEXT,
            is_latest INTEGER DEFAULT 0,
            description TEXT,
            source TEXT NOT NULL DEFAULT 'local',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // 创建 model_registry 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_registry_provider ON model_registry(provider_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_registry_tier ON model_registry(tier)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_registry_family ON model_registry(family)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_registry_source ON model_registry(source)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_model_registry_status ON model_registry(status)",
        [],
    )?;

    // 用户模型偏好表
    // 存储用户的收藏、隐藏、使用统计等偏好
    conn.execute(
        "CREATE TABLE IF NOT EXISTS user_model_preferences (
            model_id TEXT PRIMARY KEY,
            is_favorite INTEGER DEFAULT 0,
            is_hidden INTEGER DEFAULT 0,
            custom_alias TEXT,
            usage_count INTEGER DEFAULT 0,
            last_used_at INTEGER,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // 创建 user_model_preferences 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_user_model_preferences_favorite ON user_model_preferences(is_favorite)",
        [],
    )?;

    // 模型同步状态表
    // 记录 models.dev API 同步状态
    conn.execute(
        "CREATE TABLE IF NOT EXISTS model_sync_state (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // ============================================================================
    // Agent 会话相关表
    // ============================================================================

    // Agent 会话表
    // 存储 Agent 对话会话的元数据
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_sessions (
            id TEXT PRIMARY KEY,
            model TEXT NOT NULL,
            system_prompt TEXT,
            title TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            working_dir TEXT,
            execution_strategy TEXT NOT NULL DEFAULT 'auto',
            session_type TEXT NOT NULL DEFAULT 'user',
            user_set_name INTEGER NOT NULL DEFAULT 0,
            extension_data_json TEXT NOT NULL DEFAULT '{}',
            total_tokens INTEGER,
            input_tokens INTEGER,
            output_tokens INTEGER,
            cached_input_tokens INTEGER,
            cache_creation_input_tokens INTEGER,
            accumulated_total_tokens INTEGER,
            accumulated_input_tokens INTEGER,
            accumulated_output_tokens INTEGER,
            schedule_id TEXT,
            recipe_json TEXT,
            user_recipe_values_json TEXT,
            provider_name TEXT,
            model_config_json TEXT,
            archived_at TEXT
        )",
        [],
    )?;

    // Migration: 添加 title 列（如果不存在）
    let _ = conn.execute("ALTER TABLE agent_sessions ADD COLUMN title TEXT", []);

    // Migration: 添加 working_dir 列（如果不存在）
    let _ = conn.execute("ALTER TABLE agent_sessions ADD COLUMN working_dir TEXT", []);

    // Migration: 添加 execution_strategy 列（如果不存在）
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN execution_strategy TEXT NOT NULL DEFAULT 'auto'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'user'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN user_set_name INTEGER NOT NULL DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN extension_data_json TEXT NOT NULL DEFAULT '{}'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN total_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN input_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN output_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN cached_input_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN cache_creation_input_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN accumulated_total_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN accumulated_input_tokens INTEGER",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN accumulated_output_tokens INTEGER",
        [],
    );
    let _ = conn.execute("ALTER TABLE agent_sessions ADD COLUMN schedule_id TEXT", []);
    let _ = conn.execute("ALTER TABLE agent_sessions ADD COLUMN recipe_json TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN user_recipe_values_json TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN provider_name TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE agent_sessions ADD COLUMN model_config_json TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE agent_sessions ADD COLUMN archived_at TEXT", []);
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_archived_updated_at
         ON agent_sessions(archived_at, updated_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_working_dir_archived_updated_at
         ON agent_sessions(working_dir, archived_at, updated_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_sessions_session_type_updated_at
         ON agent_sessions(session_type, updated_at DESC)",
        [],
    )?;

    // ============================================================================
    // Workspace 相关表
    // ============================================================================

    // Workspace 表
    // 存储 Workspace 元数据，用于组织和管理 AI Agent 的工作上下文
    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspaces (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            workspace_type TEXT NOT NULL DEFAULT 'persistent',
            root_path TEXT NOT NULL UNIQUE,
            is_default INTEGER DEFAULT 0,
            settings_json TEXT DEFAULT '{}',
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // 创建 workspaces 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_workspaces_root_path ON workspaces(root_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_workspaces_is_default ON workspaces(is_default)",
        [],
    )?;

    // ============================================================================
    // Browser Profile 相关表
    // ============================================================================

    conn.execute(
        "CREATE TABLE IF NOT EXISTS browser_profiles (
            id TEXT PRIMARY KEY,
            profile_key TEXT NOT NULL UNIQUE,
            name TEXT NOT NULL,
            description TEXT,
            site_scope TEXT,
            launch_url TEXT,
            transport_kind TEXT NOT NULL DEFAULT 'managed_cdp',
            profile_dir TEXT NOT NULL,
            managed_profile_dir TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT,
            archived_at TEXT
        )",
        [],
    )?;

    let _ = conn.execute(
        "ALTER TABLE browser_profiles ADD COLUMN transport_kind TEXT NOT NULL DEFAULT 'managed_cdp'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE browser_profiles ADD COLUMN managed_profile_dir TEXT",
        [],
    );
    let _ = conn.execute(
        "UPDATE browser_profiles
         SET managed_profile_dir = profile_dir
         WHERE transport_kind = 'managed_cdp'
           AND (managed_profile_dir IS NULL OR managed_profile_dir = '')",
        [],
    );

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_profiles_key ON browser_profiles(profile_key)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_profiles_archived ON browser_profiles(archived_at)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_profiles_updated ON browser_profiles(updated_at)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS browser_environment_presets (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            proxy_server TEXT,
            timezone_id TEXT,
            locale TEXT,
            accept_language TEXT,
            geolocation_lat REAL,
            geolocation_lng REAL,
            geolocation_accuracy_m REAL,
            user_agent TEXT,
            platform TEXT,
            viewport_width INTEGER,
            viewport_height INTEGER,
            device_scale_factor REAL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_used_at TEXT,
            archived_at TEXT
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_environment_presets_archived ON browser_environment_presets(archived_at)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_browser_environment_presets_updated ON browser_environment_presets(updated_at)",
        [],
    )?;

    // Migration: 添加项目管理相关字段到 workspaces 表
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN icon TEXT", []);
    let _ = conn.execute("ALTER TABLE workspaces ADD COLUMN color TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE workspaces ADD COLUMN is_favorite INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE workspaces ADD COLUMN is_archived INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE workspaces ADD COLUMN tags_json TEXT DEFAULT '[]'",
        [],
    );

    // Migration: 添加默认人设引用字段到 workspaces 表
    // _Requirements: 11.2_
    // 注意：SQLite 不支持 ALTER TABLE ADD COLUMN 带外键约束，
    // 外键约束通过应用层逻辑保证
    let _ = conn.execute(
        "ALTER TABLE workspaces ADD COLUMN default_persona_id TEXT",
        [],
    );

    // Migration: 旧主题工作台项目统一回落到 general
    let legacy_workspace_types = LEGACY_WORKSPACE_TYPE_MIGRATION_ALIASES
        .iter()
        .map(|value| format!("'{value}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let legacy_workspace_type_migration_sql = format!(
        "UPDATE workspaces
         SET workspace_type = 'general'
         WHERE workspace_type IN ({legacy_workspace_types})"
    );
    let _ = conn.execute(legacy_workspace_type_migration_sql.as_str(), []);

    // ============================================================================
    // 项目内容管理相关表
    // ============================================================================

    // 内容表
    // 存储项目下的内容（剧集、章节、帖子、文档等）
    conn.execute(
        "CREATE TABLE IF NOT EXISTS contents (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            title TEXT NOT NULL,
            content_type TEXT NOT NULL DEFAULT 'document',
            status TEXT NOT NULL DEFAULT 'draft',
            sort_order INTEGER NOT NULL DEFAULT 0,
            body TEXT NOT NULL DEFAULT '',
            word_count INTEGER NOT NULL DEFAULT 0,
            metadata_json TEXT,
            session_id TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // 创建 contents 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contents_project_id ON contents(project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contents_status ON contents(status)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_contents_sort_order ON contents(sort_order)",
        [],
    )?;

    // ============================================================================
    // 项目记忆系统相关表
    // ============================================================================

    // 角色表
    // 存储项目的角色设定
    conn.execute(
        "CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            name TEXT NOT NULL,
            aliases_json TEXT NOT NULL DEFAULT '[]',
            description TEXT,
            personality TEXT,
            background TEXT,
            appearance TEXT,
            relationships_json TEXT NOT NULL DEFAULT '[]',
            avatar_url TEXT,
            is_main INTEGER DEFAULT 0,
            sort_order INTEGER NOT NULL DEFAULT 0,
            extra_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // 创建 characters 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_characters_project_id ON characters(project_id)",
        [],
    )?;

    // 世界观表
    // 存储项目的世界观设定
    conn.execute(
        "CREATE TABLE IF NOT EXISTS world_building (
            project_id TEXT PRIMARY KEY,
            description TEXT NOT NULL DEFAULT '',
            era TEXT,
            locations TEXT,
            rules TEXT,
            extra_json TEXT,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES workspaces(id) ON DELETE CASCADE
        )",
        [],
    )?;

    // 大纲节点表
    // 存储项目的大纲结构
    conn.execute(
        "CREATE TABLE IF NOT EXISTS outline_nodes (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            parent_id TEXT,
            title TEXT NOT NULL,
            content TEXT,
            content_id TEXT,
            sort_order INTEGER NOT NULL DEFAULT 0,
            expanded INTEGER DEFAULT 1,
            extra_json TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY (project_id) REFERENCES workspaces(id) ON DELETE CASCADE,
            FOREIGN KEY (parent_id) REFERENCES outline_nodes(id) ON DELETE CASCADE,
            FOREIGN KEY (content_id) REFERENCES contents(id) ON DELETE SET NULL
        )",
        [],
    )?;

    // 创建 outline_nodes 索引
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_outline_nodes_project_id ON outline_nodes(project_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_outline_nodes_parent_id ON outline_nodes(parent_id)",
        [],
    )?;

    // 自动化任务表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS automation_jobs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            description TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            workspace_id TEXT NOT NULL,
            execution_mode TEXT NOT NULL,
            schedule_json TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            delivery_json TEXT NOT NULL,
            timeout_secs INTEGER,
            max_retries INTEGER NOT NULL DEFAULT 3,
            next_run_at TEXT,
            last_status TEXT,
            last_error TEXT,
            last_run_at TEXT,
            last_finished_at TEXT,
            running_started_at TEXT,
            consecutive_failures INTEGER NOT NULL DEFAULT 0,
            last_retry_count INTEGER NOT NULL DEFAULT 0,
            auto_disabled_until TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_delivery_json TEXT,
            deleted_at TEXT
        )",
        [],
    )?;
    let _ = conn.execute(
        "ALTER TABLE automation_jobs ADD COLUMN last_delivery_json TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE automation_jobs ADD COLUMN deleted_at TEXT", []);
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_automation_jobs_next_run_at ON automation_jobs(next_run_at)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_automation_jobs_workspace_id ON automation_jobs(workspace_id)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_automation_jobs_enabled_updated_at ON automation_jobs(enabled, updated_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_automation_jobs_deleted_at ON automation_jobs(deleted_at)",
        [],
    )?;

    // 统一执行追踪摘要表
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_runs (
            id TEXT PRIMARY KEY,
            source TEXT NOT NULL,
            source_ref TEXT,
            session_id TEXT,
            status TEXT NOT NULL,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            duration_ms INTEGER,
            error_code TEXT,
            error_message TEXT,
            metadata TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_source_started_at ON agent_runs(source, started_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_session_started_at ON agent_runs(session_id, started_at DESC)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_status_started_at ON agent_runs(status, started_at DESC)",
        [],
    )?;

    Ok(())
}

/// 迁移：添加proxy_url列到provider_pool_credentials表
/// 使用重建表结构的方式确保数据完整性
fn migrate_add_proxy_url_column(conn: &Connection) -> Result<(), rusqlite::Error> {
    // 检查是否已经存在proxy_url列
    let mut stmt = conn.prepare("PRAGMA table_info(provider_pool_credentials)")?;
    let column_info: Vec<String> = stmt
        .query_map([], |row| {
            let column_name: String = row.get(1)?;
            Ok(column_name)
        })?
        .collect::<Result<Vec<_>, _>>()?;

    // 如果proxy_url列已存在，跳过迁移
    if column_info.contains(&"proxy_url".to_string()) {
        return Ok(());
    }

    tracing::info!("开始迁移：添加proxy_url列到provider_pool_credentials表");

    // 开始事务
    conn.execute("BEGIN TRANSACTION", [])?;

    let migration_result = (|| -> Result<(), rusqlite::Error> {
        // 1. 备份现有数据
        conn.execute(
            "CREATE TABLE provider_pool_credentials_backup AS
             SELECT * FROM provider_pool_credentials",
            [],
        )?;

        // 2. 删除原表
        conn.execute("DROP TABLE provider_pool_credentials", [])?;

        // 3. 重建表结构（包含proxy_url列和supported_models列）
        conn.execute(
            "CREATE TABLE provider_pool_credentials (
                uuid TEXT PRIMARY KEY,
                provider_type TEXT NOT NULL,
                credential_data TEXT NOT NULL,
                name TEXT,
                is_healthy INTEGER DEFAULT 1,
                is_disabled INTEGER DEFAULT 0,
                check_health INTEGER DEFAULT 1,
                check_model_name TEXT,
                not_supported_models TEXT,
                supported_models TEXT,
                usage_count INTEGER DEFAULT 0,
                error_count INTEGER DEFAULT 0,
                last_used INTEGER,
                last_error_time INTEGER,
                last_error_message TEXT,
                last_health_check_time INTEGER,
                last_health_check_model TEXT,
                proxy_url TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                cached_access_token TEXT,
                cached_refresh_token TEXT,
                token_expiry_time TEXT,
                last_refresh_time TEXT,
                refresh_error_count INTEGER DEFAULT 0,
                last_refresh_error TEXT,
                source TEXT DEFAULT 'manual'
            )",
            [],
        )?;

        // 4. 恢复数据（proxy_url和supported_models默认为NULL）
        conn.execute(
            "INSERT INTO provider_pool_credentials (
                uuid, provider_type, credential_data, name, is_healthy, is_disabled,
                check_health, check_model_name, not_supported_models, supported_models, usage_count,
                error_count, last_used, last_error_time, last_error_message,
                last_health_check_time, last_health_check_model, proxy_url,
                created_at, updated_at, cached_access_token, cached_refresh_token,
                token_expiry_time, last_refresh_time, refresh_error_count,
                last_refresh_error, source
            ) SELECT
                uuid, provider_type, credential_data, name, is_healthy, is_disabled,
                check_health, check_model_name, not_supported_models, NULL as supported_models, usage_count,
                error_count, last_used, last_error_time, last_error_message,
                last_health_check_time, last_health_check_model, NULL as proxy_url,
                created_at, updated_at, cached_access_token, cached_refresh_token,
                token_expiry_time, last_refresh_time, refresh_error_count,
                last_refresh_error, source
            FROM provider_pool_credentials_backup",
            [],
        )?;

        // 5. 重建索引
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_provider_pool_type ON provider_pool_credentials(provider_type)",
            [],
        )?;

        // 6. 删除备份表
        conn.execute("DROP TABLE provider_pool_credentials_backup", [])?;

        Ok(())
    })();

    match migration_result {
        Ok(()) => {
            conn.execute("COMMIT", [])?;
            tracing::info!("proxy_url列迁移成功完成");
            Ok(())
        }
        Err(e) => {
            conn.execute("ROLLBACK", [])?;
            tracing::error!("proxy_url列迁移失败，已回滚: {}", e);
            Err(e)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_not_create_retired_persona_or_publish_tables_or_change_existing_rows() {
        let fresh = Connection::open_in_memory().unwrap();
        create_tables(&fresh).expect("初始化现役表");
        let retired_tables: i64 = fresh
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('personas', 'publish_configs')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retired_tables, 0, "新库不得恢复项目人设或平台发布配置");

        let legacy = Connection::open_in_memory().unwrap();
        legacy
            .execute_batch(
                "CREATE TABLE personas (id TEXT PRIMARY KEY, payload TEXT);
                 INSERT INTO personas VALUES ('persona', 'retain-persona');
                 CREATE TABLE publish_configs (id TEXT PRIMARY KEY, payload TEXT);
                 INSERT INTO publish_configs VALUES ('publish', 'retain-publish');",
            )
            .unwrap();
        create_tables(&legacy).expect("初始化不能修改存量人设或发布配置表");
        for (query, expected) in [
            (
                "SELECT payload FROM personas WHERE id = 'persona'",
                "retain-persona",
            ),
            (
                "SELECT payload FROM publish_configs WHERE id = 'publish'",
                "retain-publish",
            ),
        ] {
            let retained: String = legacy.query_row(query, [], |row| row.get(0)).unwrap();
            assert_eq!(retained, expected, "代码退役不得清理用户数据");
        }
    }

    #[test]
    fn should_not_create_retired_material_catalog_or_change_existing_rows() {
        let fresh = Connection::open_in_memory().unwrap();
        create_tables(&fresh).expect("初始化现役表");
        let count: i64 = fresh.query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name IN ('materials', 'gallery_material_metadata')",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 0, "新库不得恢复素材catalog");

        let legacy = Connection::open_in_memory().unwrap();
        legacy
            .execute(
                "CREATE TABLE materials (id TEXT PRIMARY KEY, payload TEXT)",
                [],
            )
            .unwrap();
        legacy
            .execute("INSERT INTO materials VALUES ('legacy', 'retain')", [])
            .unwrap();
        create_tables(&legacy).expect("初始化不能修改存量素材表");
        let retained: String = legacy
            .query_row(
                "SELECT payload FROM materials WHERE id = 'legacy'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(retained, "retain", "代码退役不得清理用户数据");
    }

    #[test]
    fn should_not_create_or_migrate_retired_gallery_metadata() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute("CREATE TABLE poster_material_metadata (value TEXT)", [])
            .unwrap();
        conn.execute("INSERT INTO poster_material_metadata VALUES ('keep')", [])
            .unwrap();

        create_tables(&conn).expect("初始化现役表");

        let gallery_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sqlite_master WHERE name = 'gallery_material_metadata'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(gallery_count, 0, "不得恢复图库表或索引");
        let retained: String = conn
            .query_row("SELECT value FROM poster_material_metadata", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(retained, "keep", "退役不修改现存用户表");
    }

    #[test]
    fn should_upgrade_legacy_browser_profile_table_with_transport_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE browser_profiles (
                id TEXT PRIMARY KEY,
                profile_key TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                description TEXT,
                site_scope TEXT,
                launch_url TEXT,
                profile_dir TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                last_used_at TEXT,
                archived_at TEXT
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO browser_profiles (
                id, profile_key, name, description, site_scope, launch_url, profile_dir,
                created_at, updated_at, last_used_at, archived_at
            ) VALUES (?1, ?2, ?3, NULL, NULL, ?4, ?5, ?6, ?6, NULL, NULL)",
            (
                "profile-1",
                "shop_us",
                "美区资料",
                "https://seller.example.com/",
                "/tmp/lime/chrome_profiles/shop_us",
                "2026-03-15T00:00:00Z",
            ),
        )
        .unwrap();

        create_tables(&conn).expect("应成功升级旧版 browser_profiles 表");

        let mut columns = conn.prepare("PRAGMA table_info(browser_profiles)").unwrap();
        let column_names = columns
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert!(column_names.iter().any(|name| name == "transport_kind"));
        assert!(column_names
            .iter()
            .any(|name| name == "managed_profile_dir"));

        let upgraded = conn
            .query_row(
                "SELECT transport_kind, managed_profile_dir
                 FROM browser_profiles
                 WHERE id = ?1",
                ["profile-1"],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?)),
            )
            .unwrap();
        assert_eq!(upgraded.0, "managed_cdp");
        assert_eq!(
            upgraded.1.as_deref(),
            Some("/tmp/lime/chrome_profiles/shop_us")
        );
    }

    #[test]
    fn should_upgrade_legacy_mcp_servers_table_with_enablement_columns() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE mcp_servers (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                server_config TEXT NOT NULL,
                description TEXT,
                enabled_claude INTEGER DEFAULT 0
            )",
            [],
        )
        .unwrap();

        create_tables(&conn).expect("应成功升级旧版 mcp_servers 表");

        let mut columns = conn.prepare("PRAGMA table_info(mcp_servers)").unwrap();
        let column_names = columns
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(column_names.iter().any(|name| name == "enabled_lime"));
        assert!(column_names.iter().any(|name| name == "enabled_codex"));
        assert!(column_names.iter().any(|name| name == "enabled_gemini"));
        assert!(column_names.iter().any(|name| name == "created_at"));
    }

    #[test]
    fn should_drop_retired_reliability_projection_tables() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE agent_thread_incidents (
                id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                turn_id TEXT,
                item_id TEXT,
                incident_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                status TEXT NOT NULL,
                title TEXT NOT NULL,
                details_json TEXT,
                detected_at TEXT NOT NULL,
                cleared_at TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();
        conn.execute(
            "CREATE TABLE agent_turn_outcomes (
                turn_id TEXT PRIMARY KEY,
                thread_id TEXT NOT NULL,
                outcome_type TEXT NOT NULL,
                summary TEXT NOT NULL,
                primary_cause TEXT,
                retryable INTEGER NOT NULL,
                details_json TEXT,
                ended_at TEXT NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )
        .unwrap();

        create_tables(&conn).expect("应成功清理 retired reliability projection 表");

        let mut tables = conn
            .prepare(
                "SELECT name
                 FROM sqlite_master
                 WHERE type = 'table'
                   AND name IN ('agent_turn_outcomes', 'agent_thread_incidents')
                 ORDER BY name",
            )
            .unwrap();
        let table_names = tables
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();

        assert!(table_names.is_empty());
    }
}
