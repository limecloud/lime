use rusqlite::{Connection, DatabaseName};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const APP_DATA_DIR_NAME: &str = "lime";
const LEGACY_APP_DATA_DIR_NAME: &str = "proxycast";
const LEGACY_HOME_DIR_NAME: &str = ".proxycast";
const COMPAT_HOME_DIR_NAME: &str = ".lime";
const ASTER_RUNTIME_OVERRIDE_ENV: &str = "LIME_ASTER_ROOT";
const DATABASE_FILE_NAME: &str = "lime.db";
const LEGACY_DATABASE_FILE_NAME: &str = "proxycast.db";
const MIGRATION_MARKER_FILE: &str = ".migration_completed";
const USER_MEMORY_FILE_NAME: &str = "AGENTS.md";
const LEGACY_USER_MEMORY_FILE_NAMES: &[&str] = &["AGENTS.md", "AGENT.md", "instructions.md"];
const WORKSPACE_RUNTIME_DIR_NAME: &str = ".lime";
const WORKSPACE_LOCAL_RUNTIME_AGENTS_FILE_NAME: &str = "AGENTS.local.md";
const USER_SIGNAL_TABLES: &[&str] = &[
    "contents",
    "agent_sessions",
    "general_chat_sessions",
    "materials",
    "api_keys",
    "heartbeat_executions",
];
pub const WORKSPACE_LOCAL_RUNTIME_AGENTS_GITIGNORE_ENTRY: &str = ".lime/AGENTS.local.md";

pub fn preferred_data_dir() -> Result<PathBuf, String> {
    let dir = dirs::data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?
        .join(APP_DATA_DIR_NAME);
    fs::create_dir_all(&dir).map_err(|e| format!("无法创建应用数据目录 {}: {e}", dir.display()))?;
    Ok(dir)
}

pub fn legacy_home_dir() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "无法获取主目录".to_string())?
        .join(LEGACY_HOME_DIR_NAME))
}

fn legacy_app_data_dir() -> Result<PathBuf, String> {
    Ok(dirs::data_dir()
        .ok_or_else(|| "无法获取应用数据目录".to_string())?
        .join(LEGACY_APP_DATA_DIR_NAME))
}

fn compat_home_dir() -> Result<PathBuf, String> {
    Ok(dirs::home_dir()
        .ok_or_else(|| "无法获取主目录".to_string())?
        .join(COMPAT_HOME_DIR_NAME))
}

pub fn preferred_database_path() -> Result<PathBuf, String> {
    Ok(preferred_data_dir()?.join(DATABASE_FILE_NAME))
}

pub fn legacy_database_path() -> Result<PathBuf, String> {
    Ok(legacy_home_dir()?.join(LEGACY_DATABASE_FILE_NAME))
}

pub fn resolve_database_path() -> Result<PathBuf, String> {
    with_app_roots(resolve_database_path_from_source_roots)
}

pub fn resolve_logs_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("logs")
}

pub fn resolve_request_logs_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("request_logs")
}

pub fn resolve_projects_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("projects")
}

pub fn resolve_sessions_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("sessions")
}

pub fn resolve_skills_dir() -> Result<PathBuf, String> {
    resolve_runtime_subdir("skills")
}

pub fn resolve_aster_dir() -> Result<PathBuf, String> {
    if let Some(root) = resolve_aster_dir_override() {
        fs::create_dir_all(&root)
            .map_err(|error| format!("无法创建 Aster 运行时目录 {}: {error}", root.display()))?;
        return Ok(root);
    }
    resolve_runtime_subdir("aster")
}

pub fn resolve_project_skills_dir() -> Option<PathBuf> {
    std::env::current_dir()
        .ok()
        .map(|cwd| resolve_project_skills_dir_from_cwd(&cwd))
}

pub fn resolve_lime_skill_roots() -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();
    if let Some(project_dir) = resolve_project_skills_dir() {
        roots.push(project_dir);
    }
    roots.push(resolve_skills_dir()?);
    Ok(roots)
}

pub fn resolve_workspace_runtime_agents_path(working_dir: &Path) -> PathBuf {
    working_dir
        .join(WORKSPACE_RUNTIME_DIR_NAME)
        .join(USER_MEMORY_FILE_NAME)
}

pub fn resolve_workspace_local_runtime_agents_path(working_dir: &Path) -> PathBuf {
    working_dir
        .join(WORKSPACE_RUNTIME_DIR_NAME)
        .join(WORKSPACE_LOCAL_RUNTIME_AGENTS_FILE_NAME)
}

pub fn resolve_user_memory_path() -> Result<PathBuf, String> {
    let preferred_root = compat_home_dir()?;
    let mut legacy_roots = Vec::new();

    for root in [
        preferred_data_dir()?,
        legacy_app_data_dir()?,
        legacy_home_dir()?,
    ] {
        if !legacy_roots.iter().any(|existing| existing == &root) {
            legacy_roots.push(root);
        }
    }

    resolve_user_memory_path_from_source_roots(&preferred_root, &legacy_roots)
}

pub fn best_effort_user_memory_path() -> PathBuf {
    resolve_user_memory_path().unwrap_or_else(|_| fallback_user_memory_path())
}

pub fn resolve_default_project_dir() -> Result<PathBuf, String> {
    with_app_roots(resolve_default_project_dir_from_source_roots)
}

pub fn migrate_managed_project_path_to_preferred(path: &Path) -> Result<Option<PathBuf>, String> {
    with_app_roots(|preferred_root, legacy_roots| {
        migrate_managed_project_path_to_preferred_from_source_roots(
            path,
            preferred_root,
            legacy_roots,
        )
    })
}

pub fn best_effort_runtime_subdir(subdir: &str) -> PathBuf {
    resolve_runtime_subdir(subdir).unwrap_or_else(|_| fallback_runtime_subdir(subdir))
}

pub fn best_effort_app_data_file(file_name: &str) -> PathBuf {
    preferred_data_dir()
        .unwrap_or_else(|_| fallback_app_data_dir())
        .join(file_name)
}

pub fn migrate_legacy_install_data() -> Result<(), String> {
    let _ = resolve_database_path()?;

    for (label, action) in [
        ("logs", resolve_logs_dir as fn() -> Result<PathBuf, String>),
        (
            "request_logs",
            resolve_request_logs_dir as fn() -> Result<PathBuf, String>,
        ),
        (
            "projects",
            resolve_projects_dir as fn() -> Result<PathBuf, String>,
        ),
        (
            "sessions",
            resolve_sessions_dir as fn() -> Result<PathBuf, String>,
        ),
        (
            "skills",
            resolve_skills_dir as fn() -> Result<PathBuf, String>,
        ),
        (
            "user_memory",
            resolve_user_memory_path as fn() -> Result<PathBuf, String>,
        ),
    ] {
        if let Err(error) = action() {
            tracing::warn!("[路径迁移] 启动迁移 {} 失败: {}", label, error);
        }
    }

    Ok(())
}

fn with_app_roots<T>(
    resolver: impl FnOnce(&Path, &[PathBuf]) -> Result<T, String>,
) -> Result<T, String> {
    let preferred_root = preferred_data_dir()?;
    let legacy_roots = migration_source_roots()?;
    resolver(&preferred_root, &legacy_roots)
}

fn resolve_runtime_subdir(subdir: &str) -> Result<PathBuf, String> {
    with_app_roots(|preferred_root, legacy_roots| {
        resolve_subdir_with_legacy_copy_from_source_roots(preferred_root, legacy_roots, subdir)
    })
}

fn fallback_runtime_subdir(subdir: &str) -> PathBuf {
    fallback_app_data_dir().join(subdir)
}

fn resolve_aster_dir_override() -> Option<PathBuf> {
    std::env::var(ASTER_RUNTIME_OVERRIDE_ENV)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn fallback_user_memory_path() -> PathBuf {
    dirs::home_dir()
        .map(|home| home.join(COMPAT_HOME_DIR_NAME))
        .unwrap_or_else(|| fallback_app_data_dir().join(COMPAT_HOME_DIR_NAME))
        .join(USER_MEMORY_FILE_NAME)
}

fn resolve_project_skills_dir_from_cwd(cwd: &Path) -> PathBuf {
    cwd.join(".agents").join("skills")
}

fn fallback_app_data_dir() -> PathBuf {
    std::env::temp_dir().join(APP_DATA_DIR_NAME)
}

fn migration_source_roots() -> Result<Vec<PathBuf>, String> {
    let mut roots = Vec::new();

    for root in [
        legacy_app_data_dir()?,
        legacy_home_dir()?,
        compat_home_dir()?,
    ] {
        if !roots.iter().any(|existing| existing == &root) {
            roots.push(root);
        }
    }

    Ok(roots)
}

fn resolve_default_project_dir_from_source_roots(
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let default_dir = resolve_subdir_with_legacy_copy_from_source_roots(
        preferred_root,
        legacy_roots,
        "projects",
    )?
    .join("default");
    fs::create_dir_all(&default_dir)
        .map_err(|e| format!("无法创建默认项目目录 {}: {e}", default_dir.display()))?;
    Ok(default_dir)
}

#[cfg(test)]
fn resolve_default_project_dir_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    resolve_default_project_dir_from_source_roots(preferred_root, &[legacy_root.to_path_buf()])
}

#[cfg(test)]
fn resolve_aster_dir_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    resolve_subdir_with_legacy_copy_from_source_roots(
        preferred_root,
        &[legacy_root.to_path_buf()],
        "aster",
    )
}

fn resolve_user_memory_path_from_source_roots(
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    let preferred_path = preferred_root.join(USER_MEMORY_FILE_NAME);
    if preferred_path.exists() {
        return Ok(preferred_path);
    }

    let legacy_path = LEGACY_USER_MEMORY_FILE_NAMES
        .iter()
        .flat_map(|file_name| legacy_roots.iter().map(move |root| root.join(file_name)))
        .find(|path| path.exists());
    let Some(legacy_path) = legacy_path else {
        return Ok(preferred_path);
    };

    if let Some(parent) = preferred_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建用户记忆目录 {}: {e}", parent.display()))?;
    }

    match fs::copy(&legacy_path, &preferred_path) {
        Ok(_) => Ok(preferred_path),
        Err(error) => {
            tracing::warn!(
                "[路径迁移] 用户记忆文件迁移失败，回退旧路径 {}: {}",
                legacy_path.display(),
                error
            );
            Ok(legacy_path)
        }
    }
}

#[cfg(test)]
fn resolve_user_memory_path_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    resolve_user_memory_path_from_source_roots(preferred_root, &[legacy_root.to_path_buf()])
}

fn resolve_database_path_from_source_roots(
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Result<PathBuf, String> {
    fs::create_dir_all(preferred_root)
        .map_err(|e| format!("无法创建数据库目录 {}: {e}", preferred_root.display()))?;

    let preferred_path = preferred_root.join(DATABASE_FILE_NAME);
    let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
    let preferred_signal = inspect_database_signal(&preferred_path);
    let legacy_path = select_best_legacy_database_candidate(preferred_root, legacy_roots);

    if let Some(legacy_path) = legacy_path.as_ref() {
        let legacy_signal = inspect_database_signal(legacy_path);
        let should_migrate = if marker_path.exists() {
            should_replace_preferred_with_legacy(
                preferred_path.as_path(),
                preferred_signal.as_ref(),
                legacy_path.as_path(),
                legacy_signal.as_ref(),
            )
        } else if !preferred_path.exists() {
            true
        } else {
            should_replace_preferred_with_legacy(
                preferred_path.as_path(),
                preferred_signal.as_ref(),
                legacy_path.as_path(),
                legacy_signal.as_ref(),
            )
        };

        if should_migrate {
            let result = migrate_or_fallback_to_legacy(legacy_path, &preferred_path);
            if result
                .as_ref()
                .map(|path| path == &preferred_path)
                .unwrap_or(false)
            {
                write_migration_marker(&marker_path);
            }
            return result;
        }
    }

    // 无可迁移旧库 → 新安装或已迁移完成
    write_migration_marker(&marker_path);
    Ok(preferred_path)
}

#[cfg(test)]
fn resolve_database_path_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
) -> Result<PathBuf, String> {
    resolve_database_path_from_source_roots(preferred_root, &[legacy_root.to_path_buf()])
}

fn write_migration_marker(marker_path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_default();
    if let Err(e) = fs::write(marker_path, timestamp) {
        tracing::warn!(
            "[路径迁移] 写入迁移标记失败 {}（下次启动会重新检测）: {e}",
            marker_path.display()
        );
    }
}

fn migrate_or_fallback_to_legacy(
    legacy_path: &Path,
    preferred_path: &Path,
) -> Result<PathBuf, String> {
    match migrate_legacy_database(legacy_path, preferred_path) {
        Ok(()) => {
            tracing::info!(
                "[路径迁移] 数据库已从旧路径迁移到 {}",
                preferred_path.display()
            );
            Ok(preferred_path.to_path_buf())
        }
        Err(error) => {
            tracing::warn!(
                "[路径迁移] 数据库迁移失败，回退旧路径 {}: {}",
                legacy_path.display(),
                error
            );
            Ok(legacy_path.to_path_buf())
        }
    }
}

fn resolve_subdir_with_legacy_copy_from_source_roots(
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
    subdir: &str,
) -> Result<PathBuf, String> {
    let preferred_dir = preferred_root.join(subdir);
    fs::create_dir_all(&preferred_dir)
        .map_err(|e| format!("无法创建目录 {}: {e}", preferred_dir.display()))?;

    let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
    if marker_path.exists() && dir_has_entries(&preferred_dir) {
        return Ok(preferred_dir);
    }

    for legacy_root in legacy_roots {
        let legacy_dir = legacy_root.join(subdir);
        if legacy_dir.exists() {
            copy_dir_contents_if_missing(&legacy_dir, &preferred_dir)?;
        }
    }

    Ok(preferred_dir)
}

#[cfg(test)]
fn resolve_subdir_with_legacy_copy_from_roots(
    preferred_root: &Path,
    legacy_root: &Path,
    subdir: &str,
) -> Result<PathBuf, String> {
    resolve_subdir_with_legacy_copy_from_source_roots(
        preferred_root,
        &[legacy_root.to_path_buf()],
        subdir,
    )
}

fn migrate_managed_project_path_to_preferred_from_source_roots(
    path: &Path,
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    let preferred_projects_root = preferred_root.join("projects");
    fs::create_dir_all(&preferred_projects_root).map_err(|e| {
        format!(
            "无法创建当前项目目录 {}: {e}",
            preferred_projects_root.display()
        )
    })?;

    if let Ok(relative_path) = path.strip_prefix(&preferred_projects_root) {
        return Ok(Some(preferred_projects_root.join(relative_path)));
    }

    for legacy_root in legacy_roots {
        let legacy_projects_root = legacy_root.join("projects");
        let Ok(relative_path) = path.strip_prefix(&legacy_projects_root) else {
            continue;
        };

        let target_path = preferred_projects_root.join(relative_path);
        fs::create_dir_all(&target_path)
            .map_err(|e| format!("无法创建项目目录 {}: {e}", target_path.display()))?;

        if path.exists() && path.is_dir() {
            copy_dir_contents_if_missing(path, &target_path)?;
        }

        return Ok(Some(target_path));
    }

    Ok(None)
}

#[cfg(test)]
pub(crate) fn migrate_managed_project_path_to_preferred_from_roots(
    path: &Path,
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Result<Option<PathBuf>, String> {
    migrate_managed_project_path_to_preferred_from_source_roots(path, preferred_root, legacy_roots)
}

fn dir_has_entries(path: &Path) -> bool {
    fs::read_dir(path)
        .ok()
        .and_then(|mut entries| entries.next())
        .is_some()
}

fn select_best_legacy_database_candidate(
    preferred_root: &Path,
    legacy_roots: &[PathBuf],
) -> Option<PathBuf> {
    let mut candidates = vec![preferred_root.join(LEGACY_DATABASE_FILE_NAME)];

    for legacy_root in legacy_roots {
        candidates.push(legacy_root.join(LEGACY_DATABASE_FILE_NAME));
    }
    for legacy_root in legacy_roots {
        candidates.push(legacy_root.join(DATABASE_FILE_NAME));
    }

    let mut deduped = Vec::new();
    for candidate in candidates {
        if !deduped
            .iter()
            .any(|existing: &PathBuf| existing == &candidate)
        {
            deduped.push(candidate);
        }
    }

    let mut best: Option<(usize, DatabaseSignal, PathBuf)> = None;
    for (priority, candidate) in deduped.into_iter().enumerate() {
        let Some(signal) = inspect_database_signal(&candidate) else {
            continue;
        };
        if !signal.has_schema && signal.user_signal == 0 {
            continue;
        }

        let should_replace = match best.as_ref() {
            None => true,
            Some((best_priority, best_signal, _)) => {
                signal.user_signal > best_signal.user_signal
                    || (signal.user_signal == best_signal.user_signal
                        && signal.has_schema
                        && !best_signal.has_schema)
                    || (signal.user_signal == best_signal.user_signal
                        && signal.has_schema == best_signal.has_schema
                        && priority < *best_priority)
            }
        };

        if should_replace {
            best = Some((priority, signal, candidate));
        }
    }

    best.map(|(_, _, path)| path)
}

fn migrate_legacy_database(legacy_path: &Path, preferred_path: &Path) -> Result<(), String> {
    if let Some(parent) = preferred_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("无法创建数据库目录 {}: {e}", parent.display()))?;
    }

    let source = Connection::open(legacy_path)
        .map_err(|e| format!("打开旧数据库失败 {}: {e}", legacy_path.display()))?;
    source
        .busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|e| format!("设置旧数据库 busy_timeout 失败: {e}"))?;
    let _ = source.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");

    backup_existing_database(preferred_path)?;
    remove_database_with_sidecars(preferred_path)?;

    match source.backup(DatabaseName::Main, preferred_path, None) {
        Ok(()) => Ok(()),
        Err(error) => {
            let _ = remove_database_with_sidecars(preferred_path);
            Err(format!(
                "复制旧数据库 {} -> {} 失败: {error}",
                legacy_path.display(),
                preferred_path.display()
            ))
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DatabaseSignal {
    user_signal: u64,
    has_schema: bool,
}

fn inspect_database_signal(path: &Path) -> Option<DatabaseSignal> {
    if !path.exists() {
        return None;
    }

    let conn = Connection::open(path).ok()?;
    let has_schema = conn
        .query_row(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'",
            [],
            |row| row.get::<_, u64>(0),
        )
        .ok()
        .map(|count| count > 0)
        .unwrap_or(false);

    let user_signal = USER_SIGNAL_TABLES
        .iter()
        .map(|table| {
            let sql = format!("SELECT COUNT(*) FROM {table}");
            conn.query_row(&sql, [], |row| row.get::<_, u64>(0))
                .unwrap_or(0)
        })
        .sum();

    Some(DatabaseSignal {
        user_signal,
        has_schema,
    })
}

fn should_replace_preferred_with_legacy(
    preferred_path: &Path,
    preferred_signal: Option<&DatabaseSignal>,
    legacy_path: &Path,
    legacy_signal: Option<&DatabaseSignal>,
) -> bool {
    let Some(legacy_signal) = legacy_signal else {
        return false;
    };

    let Some(preferred_signal) = preferred_signal else {
        return true;
    };

    if !preferred_signal.has_schema && legacy_signal.has_schema {
        tracing::warn!(
            "[路径迁移] 当前数据库 {} 无有效 schema，准备回退旧库 {}",
            preferred_path.display(),
            legacy_path.display()
        );
        return true;
    }

    if preferred_signal.user_signal == 0 && legacy_signal.user_signal > 0 {
        tracing::warn!(
            "[路径迁移] 当前数据库 {} 缺少用户数据，检测到旧库 {} 含历史数据，准备自动恢复",
            preferred_path.display(),
            legacy_path.display()
        );
        return true;
    }

    false
}

fn backup_existing_database(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }

    let suffix = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or_default();
    let backup_path = path.with_file_name(format!(
        "{DATABASE_FILE_NAME}.bootstrap-backup-{suffix}.bak"
    ));
    fs::copy(path, &backup_path).map_err(|e| {
        format!(
            "备份当前数据库失败 {} -> {}: {e}",
            path.display(),
            backup_path.display()
        )
    })?;
    Ok(())
}

fn remove_database_with_sidecars(path: &Path) -> Result<(), String> {
    if path.exists() {
        fs::remove_file(path)
            .map_err(|e| format!("删除旧数据库文件失败 {}: {e}", path.display()))?;
    }

    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{}", path.display(), suffix));
        if sidecar.exists() {
            fs::remove_file(&sidecar)
                .map_err(|e| format!("删除数据库伴生文件失败 {}: {e}", sidecar.display()))?;
        }
    }

    Ok(())
}

fn copy_dir_contents_if_missing(from: &Path, to: &Path) -> Result<(), String> {
    let entries =
        fs::read_dir(from).map_err(|e| format!("读取目录失败 {}: {e}", from.display()))?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("读取目录项失败 {}: {e}", from.display()))?;
        let source_path = entry.path();
        let target_path = to.join(entry.file_name());

        if source_path.is_dir() {
            fs::create_dir_all(&target_path)
                .map_err(|e| format!("创建目录失败 {}: {e}", target_path.display()))?;
            copy_dir_contents_if_missing(&source_path, &target_path)?;
            continue;
        }

        if target_path.exists() {
            continue;
        }

        fs::copy(&source_path, &target_path).map_err(|e| {
            format!(
                "复制文件失败 {} -> {}: {e}",
                source_path.display(),
                target_path.display()
            )
        })?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[test]
    fn resolve_database_path_migrates_legacy_database() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        fs::create_dir_all(&legacy_root).unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute(
            "CREATE TABLE sample (id INTEGER PRIMARY KEY, name TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO sample (name) VALUES ('lime')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_root.join(DATABASE_FILE_NAME));
        assert!(resolved.exists());

        let migrated = Connection::open(resolved).unwrap();
        let name: String = migrated
            .query_row("SELECT name FROM sample LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(name, "lime");
    }

    #[test]
    fn resolve_logs_dir_copies_legacy_files() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        let legacy_logs = legacy_root.join("logs");
        fs::create_dir_all(&legacy_logs).unwrap();
        fs::write(legacy_logs.join("lime.log"), "legacy log").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "logs")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("logs"));
        assert_eq!(
            fs::read_to_string(resolved.join("lime.log")).unwrap(),
            "legacy log"
        );
    }

    #[test]
    fn resolve_projects_dir_copies_legacy_project_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        let legacy_project_dir = legacy_root.join("projects").join("legacy-project");
        fs::create_dir_all(&legacy_project_dir).unwrap();
        fs::write(legacy_project_dir.join("note.md"), "legacy project").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "projects")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("projects"));
        assert_eq!(
            fs::read_to_string(resolved.join("legacy-project").join("note.md")).unwrap(),
            "legacy project"
        );
    }

    #[test]
    fn resolve_sessions_dir_copies_legacy_session_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        let legacy_session_dir = legacy_root
            .join("sessions")
            .join("legacy-session")
            .join("files");
        fs::create_dir_all(&legacy_session_dir).unwrap();
        fs::write(legacy_session_dir.join("note.md"), "legacy session").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "sessions")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("sessions"));
        assert_eq!(
            fs::read_to_string(
                resolved
                    .join("legacy-session")
                    .join("files")
                    .join("note.md")
            )
            .unwrap(),
            "legacy session"
        );
    }

    #[test]
    fn resolve_skills_dir_copies_legacy_skill_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        let legacy_skill_dir = legacy_root.join("skills").join("legacy-skill");
        fs::create_dir_all(&legacy_skill_dir).unwrap();
        fs::write(legacy_skill_dir.join("SKILL.md"), "legacy skill").unwrap();

        let resolved =
            resolve_subdir_with_legacy_copy_from_roots(&preferred_root, &legacy_root, "skills")
                .unwrap();

        assert_eq!(resolved, preferred_root.join("skills"));
        assert_eq!(
            fs::read_to_string(resolved.join("legacy-skill").join("SKILL.md")).unwrap(),
            "legacy skill"
        );
    }

    #[test]
    fn resolve_aster_dir_copies_legacy_runtime_directories() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        let legacy_aster_dir = legacy_root.join("aster").join("state").join("logs");
        fs::create_dir_all(&legacy_aster_dir).unwrap();
        fs::write(legacy_aster_dir.join("runtime.log"), "legacy runtime").unwrap();

        let resolved = resolve_aster_dir_from_roots(&preferred_root, &legacy_root).unwrap();

        assert_eq!(resolved, preferred_root.join("aster"));
        assert_eq!(
            fs::read_to_string(resolved.join("state").join("logs").join("runtime.log")).unwrap(),
            "legacy runtime"
        );
    }

    #[test]
    fn resolve_project_skills_dir_from_cwd_builds_agents_skills_path() {
        let cwd = Path::new("/tmp/workspace");
        let resolved = resolve_project_skills_dir_from_cwd(cwd);
        assert_eq!(resolved, cwd.join(".agents").join("skills"));
    }

    #[test]
    fn resolve_workspace_runtime_agents_path_builds_workspace_file_path() {
        let workspace_root = Path::new("/tmp/workspace");
        let resolved = resolve_workspace_runtime_agents_path(workspace_root);
        assert_eq!(
            resolved,
            workspace_root
                .join(WORKSPACE_RUNTIME_DIR_NAME)
                .join(USER_MEMORY_FILE_NAME)
        );
    }

    #[test]
    fn resolve_workspace_local_runtime_agents_path_builds_workspace_local_file_path() {
        let workspace_root = Path::new("/tmp/workspace");
        let resolved = resolve_workspace_local_runtime_agents_path(workspace_root);
        assert_eq!(
            resolved,
            workspace_root
                .join(WORKSPACE_RUNTIME_DIR_NAME)
                .join(WORKSPACE_LOCAL_RUNTIME_AGENTS_FILE_NAME)
        );
    }

    #[test]
    fn resolve_user_memory_path_copies_legacy_agents_file() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("home").join(".lime");
        let legacy_root = temp.path().join("appdata").join("lime");
        fs::create_dir_all(&legacy_root).unwrap();
        fs::write(legacy_root.join("AGENTS.md"), "legacy agents").unwrap();

        let resolved = resolve_user_memory_path_from_roots(&preferred_root, &legacy_root).unwrap();

        let expected = preferred_root.join("AGENTS.md");
        assert_eq!(resolved, expected);
        assert_eq!(fs::read_to_string(expected).unwrap(), "legacy agents");
    }

    #[test]
    fn resolve_user_memory_path_copies_legacy_agent_file() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("home").join(".lime");
        let legacy_root = temp.path().join("appdata").join("lime");
        fs::create_dir_all(&legacy_root).unwrap();
        fs::write(legacy_root.join("AGENT.md"), "legacy agent").unwrap();

        let resolved = resolve_user_memory_path_from_roots(&preferred_root, &legacy_root).unwrap();

        let expected = preferred_root.join("AGENTS.md");
        assert_eq!(resolved, expected);
        assert_eq!(fs::read_to_string(expected).unwrap(), "legacy agent");
    }

    #[test]
    fn resolve_default_project_dir_creates_default_subdirectory() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");

        let resolved =
            resolve_default_project_dir_from_roots(&preferred_root, &legacy_root).unwrap();

        assert_eq!(resolved, preferred_root.join("projects").join("default"));
        assert!(resolved.exists());
        assert!(resolved.is_dir());
    }

    #[test]
    fn migrate_managed_project_path_to_preferred_remaps_proxycast_home_project() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let legacy_project = legacy_root.join("projects").join("default");
        fs::create_dir_all(&legacy_project).unwrap();
        fs::write(legacy_project.join("index.md"), "# legacy").unwrap();

        let resolved = migrate_managed_project_path_to_preferred_from_roots(
            &legacy_project,
            &preferred_root,
            &[legacy_root],
        )
        .unwrap();

        let expected = preferred_root.join("projects").join("default");
        assert_eq!(resolved, Some(expected.clone()));
        assert_eq!(
            fs::read_to_string(expected.join("index.md")).unwrap(),
            "# legacy"
        );
    }

    #[test]
    fn migrate_managed_project_path_to_preferred_ignores_custom_project() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".proxycast");
        let custom_project = temp.path().join("workspace").join("demo");

        let resolved = migrate_managed_project_path_to_preferred_from_roots(
            &custom_project,
            &preferred_root,
            &[legacy_root],
        )
        .unwrap();

        assert_eq!(resolved, None);
    }

    #[test]
    fn fallback_runtime_subdir_uses_lime_temp_namespace() {
        let fallback = fallback_runtime_subdir("logs");
        assert!(fallback.ends_with(Path::new(APP_DATA_DIR_NAME).join("logs")));
    }

    #[test]
    fn resolve_database_path_replaces_bootstrap_db_with_legacy_data() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE agent_sessions (id INTEGER PRIMARY KEY, name TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        let conn = Connection::open(resolved).unwrap();
        let count: u64 = conn
            .query_row("SELECT COUNT(*) FROM contents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn resolve_database_path_keeps_preferred_when_it_has_user_data() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        preferred_conn
            .execute("INSERT INTO contents (title) VALUES ('preferred')", [])
            .unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        let conn = Connection::open(resolved).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM contents LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "preferred");
    }

    #[test]
    fn resolve_database_path_recovers_from_legacy_when_marker_exists_but_new_db_is_empty() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        fs::create_dir_all(&preferred_root).unwrap();
        fs::create_dir_all(&legacy_root).unwrap();

        // preferred 库为空（只有 schema）
        let preferred_db = preferred_root.join(DATABASE_FILE_NAME);
        let preferred_conn = Connection::open(&preferred_db).unwrap();
        preferred_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        drop(preferred_conn);

        // 旧库有数据
        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let legacy_conn = Connection::open(&legacy_db).unwrap();
        legacy_conn
            .execute(
                "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
                [],
            )
            .unwrap();
        legacy_conn
            .execute("INSERT INTO contents (title) VALUES ('legacy')", [])
            .unwrap();
        drop(legacy_conn);

        // 写入标记文件 → 模拟已迁移过
        fs::write(preferred_root.join(MIGRATION_MARKER_FILE), "1700000000").unwrap();

        // 即使标记已存在，只要新库仍是空壳，也应自动恢复旧库数据
        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_db);

        let conn = Connection::open(&resolved).unwrap();
        let count: u64 = conn
            .query_row("SELECT COUNT(*) FROM contents", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    #[test]
    fn resolve_database_path_migrates_proxycast_appdata_database_on_first_lime_launch() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_appdata_root = temp.path().join("appdata").join("proxycast");
        fs::create_dir_all(&legacy_appdata_root).unwrap();

        let legacy_db = legacy_appdata_root.join(LEGACY_DATABASE_FILE_NAME);
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute(
            "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO contents (title) VALUES ('proxycast legacy')",
            [],
        )
        .unwrap();
        drop(conn);

        let resolved =
            resolve_database_path_from_source_roots(&preferred_root, &[legacy_appdata_root])
                .unwrap();
        assert_eq!(resolved, preferred_root.join(DATABASE_FILE_NAME));

        let conn = Connection::open(&resolved).unwrap();
        let title: String = conn
            .query_row("SELECT title FROM contents LIMIT 1", [], |row| row.get(0))
            .unwrap();
        assert_eq!(title, "proxycast legacy");
    }

    #[test]
    fn resolve_database_path_writes_marker_after_successful_migration() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        fs::create_dir_all(&legacy_root).unwrap();

        let legacy_db = legacy_root.join(DATABASE_FILE_NAME);
        let conn = Connection::open(&legacy_db).unwrap();
        conn.execute(
            "CREATE TABLE contents (id INTEGER PRIMARY KEY, title TEXT)",
            [],
        )
        .unwrap();
        conn.execute("INSERT INTO contents (title) VALUES ('data')", [])
            .unwrap();
        drop(conn);

        let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
        assert!(!marker_path.exists());

        let _ = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();

        // 迁移成功后标记文件应存在
        assert!(marker_path.exists());
    }

    #[test]
    fn resolve_database_path_writes_marker_for_fresh_install() {
        let temp = tempdir().unwrap();
        let preferred_root = temp.path().join("appdata").join("lime");
        let legacy_root = temp.path().join("home").join(".lime");
        // 不创建 legacy_root → 模拟全新安装

        let marker_path = preferred_root.join(MIGRATION_MARKER_FILE);
        assert!(!marker_path.exists());

        let resolved = resolve_database_path_from_roots(&preferred_root, &legacy_root).unwrap();
        assert_eq!(resolved, preferred_root.join(DATABASE_FILE_NAME));

        // 全新安装也应写标记
        assert!(marker_path.exists());
    }
}
