//! 调度器迁移模块
//!
//! 本模块提供旧格式调度任务到新格式的迁移功能，确保向后兼容性。
//!
//! ## 功能
//!
//! - `LegacyScheduledJob`: 旧格式任务结构体
//! - `migrate_legacy_job()`: 单个任务迁移
//! - `migrate_storage_file()`: 存储文件迁移
//! - 版本检测逻辑
//!
//! ## 需求映射
//!
//! - **Requirement 8.1**: 支持加载旧格式 ScheduledJob
//! - **Requirement 8.2**: 为新字段应用默认值
//! - **Requirement 8.3**: 迁移旧 cron 到 ScheduleType::Cron
//! - **Requirement 8.4**: 保留现有 job ID

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::io;
use std::path::Path;

use super::types::{CronPayload, JobState, ScheduleType, ScheduledJob, SessionTarget, WakeMode};

// ============================================================================
// 存储文件版本
// ============================================================================

/// 当前存储格式版本
pub const CURRENT_VERSION: u32 = 2;

/// 旧版本（无版本字段或版本为 1）
pub const LEGACY_VERSION: u32 = 1;

// ============================================================================
// LegacyScheduledJob 结构体
// ============================================================================

/// 旧格式调度任务
///
/// 用于反序列化旧版本的调度任务数据。旧格式只包含基本字段：
/// - `id`: 任务 ID
/// - `cron`: Cron 表达式
/// - `source`: Recipe 源文件路径
/// - `paused`: 是否暂停
/// - `last_run`: 上次执行时间
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::migration::LegacyScheduledJob;
///
/// let json = r#"{
///     "id": "daily-report",
///     "cron": "0 0 9 * * *",
///     "source": "/path/to/recipe.md",
///     "paused": false
/// }"#;
///
/// let legacy: LegacyScheduledJob = serde_json::from_str(json).unwrap();
/// assert_eq!(legacy.id, "daily-report");
/// ```
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct LegacyScheduledJob {
    /// 任务 ID
    pub id: String,

    /// Cron 表达式
    pub cron: String,

    /// Recipe 源文件路径
    pub source: String,

    /// 是否暂停
    #[serde(default)]
    pub paused: bool,

    /// 上次执行时间
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_run: Option<DateTime<Utc>>,
}

// ============================================================================
// 存储文件结构
// ============================================================================

/// 新版本存储文件结构
///
/// 包含版本号和任务列表，用于版本检测和迁移。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageFile {
    /// 存储格式版本
    #[serde(default = "default_version")]
    pub version: u32,

    /// 调度任务列表
    pub jobs: Vec<ScheduledJob>,
}

fn default_version() -> u32 {
    CURRENT_VERSION
}

impl Default for StorageFile {
    fn default() -> Self {
        Self {
            version: CURRENT_VERSION,
            jobs: Vec::new(),
        }
    }
}

/// 旧版本存储文件结构
///
/// 用于反序列化旧版本的存储文件。
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LegacyStorageFile {
    /// 存储格式版本（可能不存在）
    #[serde(default)]
    pub version: Option<u32>,

    /// 调度任务列表
    pub jobs: Vec<LegacyScheduledJob>,
}

// ============================================================================
// 版本检测
// ============================================================================

/// 存储文件版本信息
#[derive(Debug, Clone, PartialEq)]
pub enum StorageVersion {
    /// 当前版本（v2）
    Current,
    /// 旧版本（v1 或无版本）
    Legacy,
    /// 未知版本
    Unknown(u32),
}

/// 检测存储文件版本
///
/// 通过解析 JSON 文件的 version 字段来检测版本。
///
/// # 参数
/// - `path`: 存储文件路径
///
/// # 返回值
/// - `Ok(StorageVersion)`: 检测到的版本
/// - `Err`: 文件读取或解析错误
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::migration::{detect_version, StorageVersion};
///
/// let version = detect_version("/path/to/schedules.json")?;
/// match version {
///     StorageVersion::Current => println!("当前版本，无需迁移"),
///     StorageVersion::Legacy => println!("旧版本，需要迁移"),
///     StorageVersion::Unknown(v) => println!("未知版本: {}", v),
/// }
/// ```
pub fn detect_version(path: impl AsRef<Path>) -> io::Result<StorageVersion> {
    let content = fs::read_to_string(path)?;
    detect_version_from_str(&content)
}

/// 从 JSON 字符串检测版本
///
/// # 参数
/// - `content`: JSON 字符串
///
/// # 返回值
/// - `Ok(StorageVersion)`: 检测到的版本
/// - `Err`: 解析错误
pub fn detect_version_from_str(content: &str) -> io::Result<StorageVersion> {
    // 尝试解析版本字段
    #[derive(Deserialize)]
    struct VersionOnly {
        #[serde(default)]
        version: Option<u32>,
    }

    let version_info: VersionOnly =
        serde_json::from_str(content).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

    Ok(match version_info.version {
        Some(v) if v == CURRENT_VERSION => StorageVersion::Current,
        Some(v) if v == LEGACY_VERSION => StorageVersion::Legacy,
        Some(v) => StorageVersion::Unknown(v),
        None => StorageVersion::Legacy, // 无版本字段视为旧版本
    })
}

/// 检查是否需要迁移
///
/// # 参数
/// - `path`: 存储文件路径
///
/// # 返回值
/// - `Ok(true)`: 需要迁移
/// - `Ok(false)`: 不需要迁移
/// - `Err`: 文件读取或解析错误
pub fn needs_migration(path: impl AsRef<Path>) -> io::Result<bool> {
    let path = path.as_ref();

    // 文件不存在，不需要迁移
    if !path.exists() {
        return Ok(false);
    }

    let version = detect_version(path)?;
    Ok(matches!(version, StorageVersion::Legacy))
}

// ============================================================================
// 迁移函数
// ============================================================================

/// 迁移旧格式任务到新格式
///
/// 将 `LegacyScheduledJob` 转换为 `ScheduledJob`，应用以下转换规则：
///
/// - `id`: 保持不变（**Requirement 8.4**）
/// - `name`: 使用 ID 作为名称
/// - `enabled`: 取 `!paused` 的值
/// - `schedule`: 从 cron 字符串转换为 `ScheduleType::Cron`（**Requirement 8.3**）
/// - `payload`: 从 source 路径转换为 `CronPayload::AgentTurn`
/// - 其他字段使用默认值（**Requirement 8.2**）
///
/// # 参数
/// - `legacy`: 旧格式任务
///
/// # 返回值
/// 新格式的 `ScheduledJob`
///
/// # 示例
///
/// ```rust
/// use aster::scheduler::migration::{LegacyScheduledJob, migrate_legacy_job};
/// use chrono::Utc;
///
/// let legacy = LegacyScheduledJob {
///     id: "daily-report".to_string(),
///     cron: "0 0 9 * * *".to_string(),
///     source: "/path/to/recipe.md".to_string(),
///     paused: false,
///     last_run: None,
/// };
///
/// let job = migrate_legacy_job(&legacy);
///
/// assert_eq!(job.id, "daily-report");
/// assert_eq!(job.name, "daily-report");
/// assert!(job.enabled);
/// assert!(job.source.is_some());
/// assert!(job.cron.is_some());
/// ```
pub fn migrate_legacy_job(legacy: &LegacyScheduledJob) -> ScheduledJob {
    let now_ms = Utc::now().timestamp_millis();

    ScheduledJob {
        // 保留原始 ID（Requirement 8.4）
        id: legacy.id.clone(),
        agent_id: None,
        // 使用 ID 作为名称
        name: legacy.id.clone(),
        description: None,
        // 从 paused 转换为 enabled
        enabled: !legacy.paused,
        delete_after_run: false,
        created_at_ms: now_ms,
        updated_at_ms: now_ms,
        // 从 cron 字符串迁移到 ScheduleType::Cron（Requirement 8.3）
        schedule: ScheduleType::from_legacy_cron(&legacy.cron),
        session_target: SessionTarget::Main,
        wake_mode: WakeMode::Now,
        // 从 source 路径迁移到 CronPayload::AgentTurn
        payload: CronPayload::from_legacy_recipe(&legacy.source),
        isolation: None,
        delivery: None,
        // 迁移上次执行时间
        state: JobState {
            last_run_at_ms: legacy.last_run.map(|dt| dt.timestamp_millis()),
            ..Default::default()
        },
        // 保留原始字段用于向后兼容
        source: Some(legacy.source.clone()),
        cron: Some(legacy.cron.clone()),
    }
}

/// 迁移存储文件
///
/// 读取旧格式存储文件，将所有任务迁移到新格式，并返回新的存储文件结构。
///
/// # 参数
/// - `path`: 存储文件路径
///
/// # 返回值
/// - `Ok(StorageFile)`: 迁移后的存储文件
/// - `Err`: 文件读取或解析错误
///
/// # 行为说明
///
/// 1. 检测文件版本
/// 2. 如果是当前版本，直接加载并返回
/// 3. 如果是旧版本，逐个迁移任务
/// 4. 返回新版本的存储文件（不自动写入）
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::migration::migrate_storage_file;
///
/// let storage = migrate_storage_file("/path/to/schedules.json")?;
/// println!("迁移了 {} 个任务", storage.jobs.len());
/// ```
pub fn migrate_storage_file(path: impl AsRef<Path>) -> io::Result<StorageFile> {
    let path = path.as_ref();
    let content = fs::read_to_string(path)?;

    migrate_storage_from_str(&content)
}

/// 从 JSON 字符串迁移存储文件
///
/// # 参数
/// - `content`: JSON 字符串
///
/// # 返回值
/// - `Ok(StorageFile)`: 迁移后的存储文件
/// - `Err`: 解析错误
pub fn migrate_storage_from_str(content: &str) -> io::Result<StorageFile> {
    let version = detect_version_from_str(content)?;

    match version {
        StorageVersion::Current => {
            // 当前版本，直接解析
            let storage: StorageFile = serde_json::from_str(content)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
            Ok(storage)
        }
        StorageVersion::Legacy => {
            // 旧版本，需要迁移
            let legacy: LegacyStorageFile = serde_json::from_str(content)
                .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;

            let jobs: Vec<ScheduledJob> = legacy.jobs.iter().map(migrate_legacy_job).collect();

            Ok(StorageFile {
                version: CURRENT_VERSION,
                jobs,
            })
        }
        StorageVersion::Unknown(v) => Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("不支持的存储文件版本: {}", v),
        )),
    }
}

/// 保存存储文件
///
/// 将存储文件序列化为 JSON 并写入文件。
///
/// # 参数
/// - `path`: 存储文件路径
/// - `storage`: 存储文件结构
///
/// # 返回值
/// - `Ok(())`: 保存成功
/// - `Err`: 写入错误
pub fn save_storage_file(path: impl AsRef<Path>, storage: &StorageFile) -> io::Result<()> {
    let content = serde_json::to_string_pretty(storage)
        .map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))?;
    fs::write(path, content)
}

/// 迁移并保存存储文件
///
/// 读取旧格式存储文件，迁移所有任务，并写回文件。
///
/// # 参数
/// - `path`: 存储文件路径
///
/// # 返回值
/// - `Ok(usize)`: 迁移的任务数量
/// - `Err`: 文件读写或解析错误
///
/// # 示例
///
/// ```rust,ignore
/// use aster::scheduler::migration::migrate_and_save;
///
/// let count = migrate_and_save("/path/to/schedules.json")?;
/// println!("成功迁移 {} 个任务", count);
/// ```
pub fn migrate_and_save(path: impl AsRef<Path>) -> io::Result<usize> {
    let path = path.as_ref();

    // 检查是否需要迁移
    if !needs_migration(path)? {
        return Ok(0);
    }

    // 迁移存储文件
    let storage = migrate_storage_file(path)?;
    let count = storage.jobs.len();

    // 保存迁移后的文件
    save_storage_file(path, &storage)?;

    Ok(count)
}

// ============================================================================
// 单元测试
// ============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    // ------------------------------------------------------------------------
    // LegacyScheduledJob 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_legacy_job_deserialize_minimal() {
        let json = r#"{
            "id": "test-job",
            "cron": "0 0 9 * * *",
            "source": "/path/to/recipe.md"
        }"#;

        let legacy: LegacyScheduledJob = serde_json::from_str(json).unwrap();

        assert_eq!(legacy.id, "test-job");
        assert_eq!(legacy.cron, "0 0 9 * * *");
        assert_eq!(legacy.source, "/path/to/recipe.md");
        assert!(!legacy.paused); // 默认值
        assert!(legacy.last_run.is_none());
    }

    #[test]
    fn test_legacy_job_deserialize_full() {
        let json = r#"{
            "id": "daily-report",
            "cron": "0 30 8 * * *",
            "source": "/home/user/recipes/report.md",
            "paused": true,
            "lastRun": "2024-01-15T09:00:00Z"
        }"#;

        let legacy: LegacyScheduledJob = serde_json::from_str(json).unwrap();

        assert_eq!(legacy.id, "daily-report");
        assert_eq!(legacy.cron, "0 30 8 * * *");
        assert_eq!(legacy.source, "/home/user/recipes/report.md");
        assert!(legacy.paused);
        assert!(legacy.last_run.is_some());
    }

    #[test]
    fn test_legacy_job_serialize() {
        let legacy = LegacyScheduledJob {
            id: "test-job".to_string(),
            cron: "0 0 9 * * *".to_string(),
            source: "/path/to/recipe.md".to_string(),
            paused: false,
            last_run: None,
        };

        let json = serde_json::to_string(&legacy).unwrap();

        assert!(json.contains("\"id\":\"test-job\""));
        assert!(json.contains("\"cron\":\"0 0 9 * * *\""));
        assert!(json.contains("\"source\":\"/path/to/recipe.md\""));
    }

    // ------------------------------------------------------------------------
    // 版本检测测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_detect_version_current() {
        let json = r#"{"version": 2, "jobs": []}"#;
        let version = detect_version_from_str(json).unwrap();
        assert_eq!(version, StorageVersion::Current);
    }

    #[test]
    fn test_detect_version_legacy_explicit() {
        let json = r#"{"version": 1, "jobs": []}"#;
        let version = detect_version_from_str(json).unwrap();
        assert_eq!(version, StorageVersion::Legacy);
    }

    #[test]
    fn test_detect_version_legacy_no_version() {
        let json = r#"{"jobs": []}"#;
        let version = detect_version_from_str(json).unwrap();
        assert_eq!(version, StorageVersion::Legacy);
    }

    #[test]
    fn test_detect_version_unknown() {
        let json = r#"{"version": 99, "jobs": []}"#;
        let version = detect_version_from_str(json).unwrap();
        assert_eq!(version, StorageVersion::Unknown(99));
    }

    // ------------------------------------------------------------------------
    // migrate_legacy_job 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_migrate_legacy_job_basic() {
        let legacy = LegacyScheduledJob {
            id: "daily-report".to_string(),
            cron: "0 0 9 * * *".to_string(),
            source: "/path/to/recipe.md".to_string(),
            paused: false,
            last_run: None,
        };

        let job = migrate_legacy_job(&legacy);

        // Requirement 8.4: 保留原始 ID
        assert_eq!(job.id, "daily-report");
        // 使用 ID 作为名称
        assert_eq!(job.name, "daily-report");
        // enabled = !paused
        assert!(job.enabled);
        // Requirement 8.3: 迁移到 ScheduleType::Cron
        match &job.schedule {
            ScheduleType::Cron { expr, tz } => {
                assert_eq!(expr, "0 0 9 * * *");
                assert!(tz.is_none());
            }
            _ => panic!("Expected Cron schedule type"),
        }
        // 保留原始字段
        assert_eq!(job.source, Some("/path/to/recipe.md".to_string()));
        assert_eq!(job.cron, Some("0 0 9 * * *".to_string()));
    }

    #[test]
    fn test_migrate_legacy_job_paused() {
        let legacy = LegacyScheduledJob {
            id: "paused-job".to_string(),
            cron: "0 0 12 * * *".to_string(),
            source: "/path/to/recipe.md".to_string(),
            paused: true,
            last_run: None,
        };

        let job = migrate_legacy_job(&legacy);

        // paused = true -> enabled = false
        assert!(!job.enabled);
    }

    #[test]
    fn test_migrate_legacy_job_with_last_run() {
        let last_run = Utc::now() - chrono::Duration::hours(1);
        let legacy = LegacyScheduledJob {
            id: "job-with-history".to_string(),
            cron: "0 0 9 * * *".to_string(),
            source: "/path/to/recipe.md".to_string(),
            paused: false,
            last_run: Some(last_run),
        };

        let job = migrate_legacy_job(&legacy);

        // 迁移 last_run 到 state.last_run_at_ms
        assert_eq!(job.state.last_run_at_ms, Some(last_run.timestamp_millis()));
    }

    #[test]
    fn test_migrate_legacy_job_default_values() {
        let legacy = LegacyScheduledJob {
            id: "test".to_string(),
            cron: "0 0 9 * * *".to_string(),
            source: "/path/to/recipe.md".to_string(),
            paused: false,
            last_run: None,
        };

        let job = migrate_legacy_job(&legacy);

        // Requirement 8.2: 新字段使用默认值
        assert!(job.agent_id.is_none());
        assert!(job.description.is_none());
        assert!(!job.delete_after_run);
        assert_eq!(job.session_target, SessionTarget::Main);
        assert_eq!(job.wake_mode, WakeMode::Now);
        assert!(job.isolation.is_none());
        assert!(job.delivery.is_none());
    }

    #[test]
    fn test_migrate_legacy_job_payload() {
        let legacy = LegacyScheduledJob {
            id: "test".to_string(),
            cron: "0 0 9 * * *".to_string(),
            source: "/home/user/recipes/daily.md".to_string(),
            paused: false,
            last_run: None,
        };

        let job = migrate_legacy_job(&legacy);

        // payload 应该是 AgentTurn，message 为 source 路径
        match &job.payload {
            CronPayload::AgentTurn { message, .. } => {
                assert_eq!(message, "/home/user/recipes/daily.md");
            }
            _ => panic!("Expected AgentTurn payload"),
        }
    }

    // ------------------------------------------------------------------------
    // migrate_storage_from_str 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_migrate_storage_current_version() {
        let json = r#"{
            "version": 2,
            "jobs": [
                {
                    "id": "test-job",
                    "name": "Test Job",
                    "enabled": true,
                    "deleteAfterRun": false,
                    "createdAtMs": 1704067200000,
                    "updatedAtMs": 1704067200000,
                    "schedule": {
                        "kind": "cron",
                        "expr": "0 0 9 * * *"
                    },
                    "payload": {
                        "kind": "agentTurn",
                        "message": "Do something"
                    },
                    "state": {}
                }
            ]
        }"#;

        let storage = migrate_storage_from_str(json).unwrap();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert_eq!(storage.jobs.len(), 1);
        assert_eq!(storage.jobs[0].id, "test-job");
        assert_eq!(storage.jobs[0].name, "Test Job");
    }

    #[test]
    fn test_migrate_storage_legacy_version() {
        let json = r#"{
            "version": 1,
            "jobs": [
                {
                    "id": "legacy-job",
                    "cron": "0 0 9 * * *",
                    "source": "/path/to/recipe.md",
                    "paused": false
                }
            ]
        }"#;

        let storage = migrate_storage_from_str(json).unwrap();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert_eq!(storage.jobs.len(), 1);
        assert_eq!(storage.jobs[0].id, "legacy-job");
        assert_eq!(storage.jobs[0].name, "legacy-job");
        assert!(storage.jobs[0].enabled);
    }

    #[test]
    fn test_migrate_storage_no_version() {
        let json = r#"{
            "jobs": [
                {
                    "id": "old-job",
                    "cron": "0 30 8 * * *",
                    "source": "/path/to/old-recipe.md",
                    "paused": true
                }
            ]
        }"#;

        let storage = migrate_storage_from_str(json).unwrap();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert_eq!(storage.jobs.len(), 1);
        assert_eq!(storage.jobs[0].id, "old-job");
        assert!(!storage.jobs[0].enabled); // paused = true -> enabled = false
    }

    #[test]
    fn test_migrate_storage_multiple_jobs() {
        let json = r#"{
            "jobs": [
                {
                    "id": "job-1",
                    "cron": "0 0 9 * * *",
                    "source": "/path/to/recipe1.md",
                    "paused": false
                },
                {
                    "id": "job-2",
                    "cron": "0 0 18 * * *",
                    "source": "/path/to/recipe2.md",
                    "paused": true
                }
            ]
        }"#;

        let storage = migrate_storage_from_str(json).unwrap();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert_eq!(storage.jobs.len(), 2);

        assert_eq!(storage.jobs[0].id, "job-1");
        assert!(storage.jobs[0].enabled);

        assert_eq!(storage.jobs[1].id, "job-2");
        assert!(!storage.jobs[1].enabled);
    }

    #[test]
    fn test_migrate_storage_unknown_version() {
        let json = r#"{"version": 99, "jobs": []}"#;

        let result = migrate_storage_from_str(json);

        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(err.to_string().contains("不支持的存储文件版本"));
    }

    #[test]
    fn test_migrate_storage_empty_jobs() {
        let json = r#"{"jobs": []}"#;

        let storage = migrate_storage_from_str(json).unwrap();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert!(storage.jobs.is_empty());
    }

    // ------------------------------------------------------------------------
    // StorageFile 测试
    // ------------------------------------------------------------------------

    #[test]
    fn test_storage_file_default() {
        let storage = StorageFile::default();

        assert_eq!(storage.version, CURRENT_VERSION);
        assert!(storage.jobs.is_empty());
    }

    #[test]
    fn test_storage_file_serialize() {
        let storage = StorageFile {
            version: CURRENT_VERSION,
            jobs: vec![],
        };

        let json = serde_json::to_string(&storage).unwrap();

        assert!(json.contains(&format!("\"version\":{}", CURRENT_VERSION)));
        assert!(json.contains("\"jobs\":[]"));
    }
}

// ============================================================================
// 属性测试 (Property-Based Tests)
// ============================================================================

#[cfg(test)]
mod property_tests {
    use super::*;
    use proptest::prelude::*;

    // ------------------------------------------------------------------------
    // 生成器 (Generators)
    // ------------------------------------------------------------------------

    /// 生成有效的任务 ID
    ///
    /// 任务 ID 应该是非空的字母数字字符串，可包含连字符
    fn arb_job_id() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9-]{0,30}".prop_filter("非空 ID", |s| !s.is_empty())
    }

    /// 生成有效的 Cron 表达式
    ///
    /// 使用常见的 6 字段 cron 格式
    fn arb_valid_cron_expr() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("0 0 9 * * *".to_string()),   // 每天 9:00
            Just("0 30 8 * * *".to_string()),  // 每天 8:30
            Just("0 0 12 * * *".to_string()),  // 每天 12:00
            Just("0 */5 * * * *".to_string()), // 每 5 分钟
            Just("0 0 0 * * 1".to_string()),   // 每周一 0:00
            Just("0 0 18 * * *".to_string()),  // 每天 18:00
            Just("0 15 10 * * *".to_string()), // 每天 10:15
            Just("0 0 */2 * * *".to_string()), // 每 2 小时
        ]
    }

    /// 生成有效的源文件路径
    fn arb_source_path() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("/path/to/recipe.md".to_string()),
            Just("/home/user/recipes/daily.md".to_string()),
            Just("recipes/report.md".to_string()),
            Just("/var/aster/tasks/backup.md".to_string()),
            "[a-z/]{5,50}\\.md".prop_filter("有效路径", |s| !s.is_empty()),
        ]
    }

    /// 生成可选的上次执行时间
    fn arb_last_run() -> impl Strategy<Value = Option<DateTime<Utc>>> {
        prop_oneof![
            Just(None),
            // 生成过去 30 天内的随机时间
            (1i64..2592000i64)
                .prop_map(|secs| { Some(Utc::now() - chrono::Duration::seconds(secs)) }),
        ]
    }

    /// 生成 LegacyScheduledJob
    fn arb_legacy_job() -> impl Strategy<Value = LegacyScheduledJob> {
        (
            arb_job_id(),
            arb_valid_cron_expr(),
            arb_source_path(),
            proptest::bool::ANY,
            arb_last_run(),
        )
            .prop_map(|(id, cron, source, paused, last_run)| LegacyScheduledJob {
                id,
                cron,
                source,
                paused,
                last_run,
            })
    }

    /// 生成多个 LegacyScheduledJob
    fn arb_legacy_jobs() -> impl Strategy<Value = Vec<LegacyScheduledJob>> {
        prop::collection::vec(arb_legacy_job(), 0..10)
    }

    // ------------------------------------------------------------------------
    // Property 8: 旧格式迁移
    // ------------------------------------------------------------------------

    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        /// Property 8.1: 迁移后 schedule 字段为 ScheduleType::Cron
        ///
        /// **Validates: Requirements 8.3**
        ///
        /// *For any* 旧格式 ScheduledJob（仅包含 cron 字符串），
        /// 迁移后 schedule 字段应为 ScheduleType::Cron
        #[test]
        fn prop_migration_schedule_is_cron(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            match &job.schedule {
                ScheduleType::Cron { expr, tz } => {
                    // cron 表达式应该与原始值相同
                    prop_assert_eq!(expr, &legacy.cron);
                    // 时区默认为 None
                    prop_assert!(tz.is_none());
                }
                _ => prop_assert!(false, "迁移后 schedule 应为 Cron 类型"),
            }
        }

        /// Property 8.2: 迁移后原始 job ID 保持不变
        ///
        /// **Validates: Requirements 8.4**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后 ID 应保持不变
        #[test]
        fn prop_migration_preserves_job_id(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            prop_assert_eq!(
                &job.id,
                &legacy.id,
                "迁移后 job ID 应保持不变"
            );
        }

        /// Property 8.3: 迁移后新字段有合理的默认值
        ///
        /// **Validates: Requirements 8.1, 8.2**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后新字段应有合理的默认值
        #[test]
        fn prop_migration_applies_default_values(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            // 新字段应有默认值
            prop_assert!(job.agent_id.is_none(), "agent_id 应为 None");
            prop_assert!(job.description.is_none(), "description 应为 None");
            prop_assert!(!job.delete_after_run, "delete_after_run 应为 false");
            prop_assert_eq!(job.session_target, SessionTarget::Main, "session_target 应为 Main");
            prop_assert_eq!(job.wake_mode, WakeMode::Now, "wake_mode 应为 Now");
            prop_assert!(job.isolation.is_none(), "isolation 应为 None");
            prop_assert!(job.delivery.is_none(), "delivery 应为 None");

            // 时间戳应该是合理的值（大于 0）
            prop_assert!(job.created_at_ms > 0, "created_at_ms 应大于 0");
            prop_assert!(job.updated_at_ms > 0, "updated_at_ms 应大于 0");
        }

        /// Property 8.4: 迁移后 enabled 与 paused 相反
        ///
        /// **Validates: Requirements 8.1, 8.2**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后 enabled = !paused
        #[test]
        fn prop_migration_enabled_inverse_of_paused(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            prop_assert_eq!(
                job.enabled,
                !legacy.paused,
                "enabled 应与 paused 相反"
            );
        }

        /// Property 8.5: 迁移后 name 使用原始 ID
        ///
        /// **Validates: Requirements 8.2**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后 name 应使用原始 ID
        #[test]
        fn prop_migration_name_uses_id(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            prop_assert_eq!(
                &job.name,
                &legacy.id,
                "name 应使用原始 ID"
            );
        }

        /// Property 8.6: 迁移后保留原始字段用于向后兼容
        ///
        /// **Validates: Requirements 8.1**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后应保留 source 和 cron 字段
        #[test]
        fn prop_migration_preserves_legacy_fields(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            prop_assert_eq!(
                job.source,
                Some(legacy.source.clone()),
                "source 字段应保留"
            );
            prop_assert_eq!(
                job.cron,
                Some(legacy.cron.clone()),
                "cron 字段应保留"
            );
        }

        /// Property 8.7: 迁移后 payload 为 AgentTurn 类型
        ///
        /// **Validates: Requirements 8.2**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后 payload 应为 AgentTurn
        #[test]
        fn prop_migration_payload_is_agent_turn(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            prop_assert!(
                job.payload.is_agent_turn(),
                "payload 应为 AgentTurn 类型"
            );
            prop_assert_eq!(
                job.payload.get_text(),
                &legacy.source,
                "payload message 应为原始 source"
            );
        }

        /// Property 8.8: 迁移后 last_run 正确转换
        ///
        /// **Validates: Requirements 8.1, 8.2**
        ///
        /// *For any* 旧格式 ScheduledJob，迁移后 last_run 应正确转换到 state.last_run_at_ms
        #[test]
        fn prop_migration_last_run_converted(legacy in arb_legacy_job()) {
            let job = migrate_legacy_job(&legacy);

            match legacy.last_run {
                Some(last_run) => {
                    prop_assert_eq!(
                        job.state.last_run_at_ms,
                        Some(last_run.timestamp_millis()),
                        "last_run 应正确转换为毫秒时间戳"
                    );
                }
                None => {
                    prop_assert!(
                        job.state.last_run_at_ms.is_none(),
                        "无 last_run 时 state.last_run_at_ms 应为 None"
                    );
                }
            }
        }

        /// Property 8.9: 批量迁移保留所有任务
        ///
        /// **Validates: Requirements 8.1, 8.4**
        ///
        /// *For any* 旧格式存储文件，迁移后任务数量应保持不变
        #[test]
        fn prop_migration_preserves_all_jobs(jobs in arb_legacy_jobs()) {
            let legacy_storage = LegacyStorageFile {
                version: Some(LEGACY_VERSION),
                jobs: jobs.clone(),
            };

            let json = serde_json::to_string(&legacy_storage).unwrap();
            let migrated = migrate_storage_from_str(&json).unwrap();

            prop_assert_eq!(
                migrated.jobs.len(),
                jobs.len(),
                "迁移后任务数量应保持不变"
            );

            // 验证每个任务的 ID 都被保留
            for (i, legacy_job) in jobs.iter().enumerate() {
                prop_assert_eq!(
                    &migrated.jobs[i].id,
                    &legacy_job.id,
                    "任务 {} 的 ID 应保持不变",
                    i
                );
            }
        }

        /// Property 8.10: 迁移后版本号为当前版本
        ///
        /// **Validates: Requirements 8.1**
        ///
        /// *For any* 旧格式存储文件，迁移后版本号应为 CURRENT_VERSION
        #[test]
        fn prop_migration_updates_version(jobs in arb_legacy_jobs()) {
            let legacy_storage = LegacyStorageFile {
                version: Some(LEGACY_VERSION),
                jobs,
            };

            let json = serde_json::to_string(&legacy_storage).unwrap();
            let migrated = migrate_storage_from_str(&json).unwrap();

            prop_assert_eq!(
                migrated.version,
                CURRENT_VERSION,
                "迁移后版本号应为 CURRENT_VERSION"
            );
        }

        /// Property 8.11: 无版本字段的存储文件也能正确迁移
        ///
        /// **Validates: Requirements 8.1**
        ///
        /// *For any* 无版本字段的旧格式存储文件，应能正确迁移
        #[test]
        fn prop_migration_handles_no_version(jobs in arb_legacy_jobs()) {
            let legacy_storage = LegacyStorageFile {
                version: None,  // 无版本字段
                jobs: jobs.clone(),
            };

            let json = serde_json::to_string(&legacy_storage).unwrap();
            let migrated = migrate_storage_from_str(&json).unwrap();

            prop_assert_eq!(
                migrated.version,
                CURRENT_VERSION,
                "无版本字段时迁移后版本号应为 CURRENT_VERSION"
            );
            prop_assert_eq!(
                migrated.jobs.len(),
                jobs.len(),
                "无版本字段时任务数量应保持不变"
            );
        }
    }
}
