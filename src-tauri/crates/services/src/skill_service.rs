use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock};
use reqwest::Client;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::timeout;

use proxycast_core::models::{
    resolve_skill_source_kind, AppType, Skill, SkillMetadata, SkillRepo, SkillState,
};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const REMOTE_SKILLS_CACHE_TTL: Duration = Duration::from_secs(300);
const REMOTE_SKILLS_ERROR_CACHE_TTL: Duration = Duration::from_secs(120);

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct RepoCacheKey {
    owner: String,
    name: String,
    branch: String,
}

impl From<&SkillRepo> for RepoCacheKey {
    fn from(value: &SkillRepo) -> Self {
        Self {
            owner: value.owner.clone(),
            name: value.name.clone(),
            branch: value.branch.clone(),
        }
    }
}

#[derive(Debug, Clone)]
enum RepoCacheValue {
    Skills(Vec<Skill>),
    Error(String),
}

#[derive(Debug, Clone)]
struct RepoCacheEntry {
    value: RepoCacheValue,
    fetched_at: Instant,
}

impl RepoCacheEntry {
    fn success(skills: Vec<Skill>) -> Self {
        Self {
            value: RepoCacheValue::Skills(skills),
            fetched_at: Instant::now(),
        }
    }

    fn error(message: String) -> Self {
        Self {
            value: RepoCacheValue::Error(message),
            fetched_at: Instant::now(),
        }
    }

    fn is_fresh(&self) -> bool {
        let ttl = match self.value {
            RepoCacheValue::Skills(_) => REMOTE_SKILLS_CACHE_TTL,
            RepoCacheValue::Error(_) => REMOTE_SKILLS_ERROR_CACHE_TTL,
        };

        self.fetched_at.elapsed() < ttl
    }
}

pub struct SkillService {
    client: Client,
    repo_cache: RwLock<HashMap<RepoCacheKey, RepoCacheEntry>>,
    inflight_fetches: Mutex<HashMap<RepoCacheKey, Arc<tokio::sync::Notify>>>,
}

impl SkillService {
    pub fn new() -> Result<Self> {
        let client = Client::builder()
            .timeout(DOWNLOAD_TIMEOUT)
            .build()
            .context("Failed to create HTTP client")?;

        Ok(Self {
            client,
            repo_cache: RwLock::new(HashMap::new()),
            inflight_fetches: Mutex::new(HashMap::new()),
        })
    }

    /// 获取技能安装目录
    fn get_skills_dir(app_type: &AppType) -> Result<PathBuf> {
        let home = dirs::home_dir().ok_or_else(|| anyhow!("Failed to get home directory"))?;

        let skills_dir = match app_type {
            AppType::Claude => home.join(".claude").join("skills"),
            AppType::Codex => home.join(".codex").join("skills"),
            AppType::Gemini => home.join(".gemini").join("skills"),
            AppType::ProxyCast => home.join(".proxycast").join("skills"),
        };

        Ok(skills_dir)
    }

    /// 仅列出内置 + 本地技能（不访问远程仓库，速度快）
    pub fn list_local_skills(
        &self,
        app_type: &AppType,
        _installed_states: &HashMap<String, SkillState>,
    ) -> Result<Vec<Skill>> {
        let mut all_skills: HashMap<String, Skill> = HashMap::new();

        // 扫描本地目录
        let skills_dir = Self::get_skills_dir(app_type)?;
        if skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let directory = entry.file_name().to_string_lossy().to_string();
                        let key = format!("local:{directory}");
                        let skill_md = entry.path().join("SKILL.md");
                        let (name, description) = if skill_md.exists() {
                            self.parse_skill_metadata(&skill_md)
                                .map(|m| {
                                    (
                                        m.name.unwrap_or_else(|| directory.clone()),
                                        m.description.unwrap_or_default(),
                                    )
                                })
                                .unwrap_or_else(|_| (directory.clone(), String::new()))
                        } else {
                            (directory.clone(), String::new())
                        };

                        all_skills.insert(
                            key.clone(),
                            Skill {
                                key,
                                name,
                                description,
                                directory: directory.clone(),
                                readme_url: None,
                                installed: true,
                                source_kind: resolve_skill_source_kind(app_type, &directory),
                                repo_owner: None,
                                repo_name: None,
                                repo_branch: None,
                            },
                        );
                    }
                }
            }
        }

        let mut skills: Vec<Skill> = all_skills.into_values().collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(skills)
    }

    /// 列出所有技能
    pub async fn list_skills(
        &self,
        app_type: &AppType,
        repos: &[SkillRepo],
        installed_states: &HashMap<String, SkillState>,
    ) -> Result<Vec<Skill>> {
        let mut all_skills: HashMap<String, Skill> = HashMap::new();

        // 1. 从启用的仓库获取技能
        let enabled_repos: Vec<_> = repos.iter().filter(|r| r.enabled).collect();

        for repo in enabled_repos {
            match timeout(DOWNLOAD_TIMEOUT, self.fetch_skills_from_repo_cached(repo)).await {
                Ok(Ok(remote_skills)) => {
                    for mut skill in remote_skills {
                        let app_key = format!(
                            "{}:{}",
                            app_type.to_string().to_lowercase(),
                            skill.directory
                        );
                        skill.installed = installed_states
                            .get(&app_key)
                            .map(|state| state.installed)
                            .unwrap_or(false);
                        all_skills.insert(skill.key.clone(), skill);
                    }
                }
                Ok(Err(e)) => {
                    tracing::warn!(
                        "Failed to fetch skills from {}/{}: {}",
                        repo.owner,
                        repo.name,
                        e
                    );
                }
                Err(_) => {
                    tracing::warn!("Timeout fetching skills from {}/{}", repo.owner, repo.name);
                }
            }
        }

        // 2. 添加本地已安装但不在任何仓库中的技能
        let skills_dir = Self::get_skills_dir(app_type)?;
        if skills_dir.exists() {
            if let Ok(entries) = fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        let directory = entry.file_name().to_string_lossy().to_string();

                        // 检查是否已有相同 directory 的 skill（按 directory 去重）
                        let already_exists = all_skills.values().any(|s| s.directory == directory);

                        if !already_exists {
                            let key = format!("local:{directory}");
                            let skill_md = entry.path().join("SKILL.md");
                            let (name, description) = if skill_md.exists() {
                                self.parse_skill_metadata(&skill_md)
                                    .map(|m| {
                                        (
                                            m.name.unwrap_or_else(|| directory.clone()),
                                            m.description.unwrap_or_default(),
                                        )
                                    })
                                    .unwrap_or_else(|_| (directory.clone(), String::new()))
                            } else {
                                (directory.clone(), String::new())
                            };

                            all_skills.insert(
                                key.clone(),
                                Skill {
                                    key,
                                    name,
                                    description,
                                    directory: directory.clone(),
                                    readme_url: None,
                                    installed: true,
                                    source_kind: resolve_skill_source_kind(app_type, &directory),
                                    repo_owner: None,
                                    repo_name: None,
                                    repo_branch: None,
                                },
                            );
                        }
                    }
                }
            }
        }

        // 3. 排序并返回
        let mut skills: Vec<Skill> = all_skills.into_values().collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));

        Ok(skills)
    }

    async fn fetch_skills_from_repo_cached(&self, repo: &SkillRepo) -> Result<Vec<Skill>> {
        let cache_key = RepoCacheKey::from(repo);

        if let Some(cached) = self.read_cached_repo_result(&cache_key) {
            return cached;
        }

        let (notify, is_leader) = {
            let mut inflight = self.inflight_fetches.lock();
            if let Some(existing) = inflight.get(&cache_key) {
                (existing.clone(), false)
            } else {
                let notify = Arc::new(tokio::sync::Notify::new());
                inflight.insert(cache_key.clone(), notify.clone());
                (notify, true)
            }
        };

        if !is_leader {
            notify.notified().await;
            if let Some(cached) = self.read_cached_repo_result(&cache_key) {
                return cached;
            }
            return Err(anyhow!(
                "技能仓库缓存同步失败: {}/{}@{}",
                repo.owner,
                repo.name,
                repo.branch
            ));
        }

        let result = self
            .fetch_skills_from_repo_uncached(repo)
            .await
            .map_err(|error| error.to_string());

        {
            let mut cache = self.repo_cache.write();
            let entry = match &result {
                Ok(skills) => RepoCacheEntry::success(skills.clone()),
                Err(error) => RepoCacheEntry::error(error.clone()),
            };
            cache.insert(cache_key.clone(), entry);
        }

        self.inflight_fetches.lock().remove(&cache_key);
        notify.notify_waiters();

        result.map_err(|error| anyhow!(error))
    }

    fn read_cached_repo_result(&self, cache_key: &RepoCacheKey) -> Option<Result<Vec<Skill>>> {
        let cached = self.repo_cache.read().get(cache_key).cloned()?;
        if !cached.is_fresh() {
            self.repo_cache.write().remove(cache_key);
            return None;
        }

        Some(match cached.value {
            RepoCacheValue::Skills(skills) => Ok(skills),
            RepoCacheValue::Error(error) => Err(anyhow!(error)),
        })
    }

    /// 从仓库获取技能列表
    async fn fetch_skills_from_repo_uncached(&self, repo: &SkillRepo) -> Result<Vec<Skill>> {
        let mut last_error = None;

        for branch in Self::build_branch_candidates(&repo.branch) {
            match self.fetch_skills_from_branch(repo, &branch).await {
                Ok(skills) => return Ok(skills),
                Err(error) => {
                    if branch != repo.branch {
                        tracing::warn!(
                            "[SkillService] 仓库 {}/{} 分支 {} 不可用，回退 {} 仍失败: {}",
                            repo.owner,
                            repo.name,
                            repo.branch,
                            branch,
                            error
                        );
                    }
                    last_error = Some(error);
                }
            }
        }

        Err(last_error.unwrap_or_else(|| {
            anyhow!(
                "Failed to fetch skills from {}/{}@{}",
                repo.owner,
                repo.name,
                repo.branch
            )
        }))
    }

    async fn fetch_skills_from_branch(&self, repo: &SkillRepo, branch: &str) -> Result<Vec<Skill>> {
        let zip_url = format!(
            "https://github.com/{}/{}/archive/refs/heads/{}.zip",
            repo.owner, repo.name, branch
        );

        let response = self
            .client
            .get(&zip_url)
            .send()
            .await
            .context("Failed to download repository")?;

        if !response.status().is_success() {
            return Err(anyhow!("HTTP {}: {}", response.status(), zip_url));
        }

        let bytes = response.bytes().await.context("Failed to read response")?;
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).context("Failed to open ZIP archive")?;

        let mut skills = Vec::new();
        let repo_key_prefix = format!("{}/{}:", repo.owner, repo.name);

        for i in 0..archive.len() {
            let mut file = archive.by_index(i).context("Failed to read ZIP entry")?;
            let file_path = file.name().to_string();

            if file_path.ends_with("/SKILL.md") || file_path.ends_with("\\SKILL.md") {
                let path = Path::new(&file_path);
                let directory = path
                    .parent()
                    .and_then(|p| p.file_name())
                    .and_then(|n| n.to_str())
                    .unwrap_or("unknown")
                    .to_string();

                let mut content = String::new();
                use std::io::Read;
                file.read_to_string(&mut content)
                    .context("Failed to read SKILL.md")?;

                let metadata = self.parse_skill_metadata_from_content(&content)?;
                let name = metadata.name.unwrap_or_else(|| directory.clone());
                let description = metadata.description.unwrap_or_default();
                let key = format!("{repo_key_prefix}{directory}");
                let readme_url = path.parent().map(|parent| {
                    format!(
                        "https://github.com/{}/{}/blob/{}/{}/SKILL.md",
                        repo.owner,
                        repo.name,
                        branch,
                        parent.to_str().unwrap_or("")
                    )
                });

                skills.push(Skill {
                    key,
                    name,
                    description,
                    directory,
                    readme_url,
                    installed: false,
                    source_kind: proxycast_core::models::SkillSourceKind::Other,
                    repo_owner: Some(repo.owner.clone()),
                    repo_name: Some(repo.name.clone()),
                    repo_branch: Some(branch.to_string()),
                });
            }
        }

        Ok(skills)
    }

    fn build_branch_candidates(branch: &str) -> Vec<String> {
        let normalized = branch.trim();
        if normalized.eq_ignore_ascii_case("main") {
            vec!["main".to_string(), "master".to_string()]
        } else if normalized.eq_ignore_ascii_case("master") {
            vec!["master".to_string(), "main".to_string()]
        } else {
            vec![normalized.to_string()]
        }
    }

    /// 安装技能
    pub async fn install_skill(
        &self,
        app_type: &AppType,
        repo_owner: &str,
        repo_name: &str,
        repo_branch: &str,
        directory: &str,
    ) -> Result<()> {
        let skills_dir = Self::get_skills_dir(app_type)?;
        fs::create_dir_all(&skills_dir).context("Failed to create skills directory")?;

        let target_dir = skills_dir.join(directory);
        if target_dir.exists() {
            fs::remove_dir_all(&target_dir).context("Failed to remove existing skill")?;
        }

        // 尝试多个分支
        let branches = if repo_branch == "main" {
            vec!["main", "master"]
        } else {
            vec![repo_branch]
        };

        let mut last_error = None;

        for branch in branches {
            let zip_url = format!(
                "https://github.com/{repo_owner}/{repo_name}/archive/refs/heads/{branch}.zip"
            );

            match self
                .download_and_extract(&zip_url, &target_dir, directory)
                .await
            {
                Ok(_) => return Ok(()),
                Err(e) => {
                    last_error = Some(e);
                    continue;
                }
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow!("Failed to install skill")))
    }

    /// 下载并解压技能
    async fn download_and_extract(
        &self,
        zip_url: &str,
        target_dir: &Path,
        directory: &str,
    ) -> Result<()> {
        let response = self
            .client
            .get(zip_url)
            .send()
            .await
            .context("Failed to download")?;

        if !response.status().is_success() {
            return Err(anyhow!("HTTP {}", response.status()));
        }

        let bytes = response.bytes().await.context("Failed to read response")?;
        let cursor = std::io::Cursor::new(bytes);
        let mut archive = zip::ZipArchive::new(cursor).context("Failed to open ZIP")?;

        // 查找技能目录
        let skill_prefix = format!("/{directory}/");
        let mut found = false;

        for i in 0..archive.len() {
            let mut file = archive.by_index(i)?;
            let file_path = file.name().to_string();

            if file_path.contains(&skill_prefix) {
                found = true;
                let relative_path = file_path
                    .split(&skill_prefix)
                    .nth(1)
                    .unwrap_or("")
                    .to_string();

                if !relative_path.is_empty() {
                    let output_path = target_dir.join(&relative_path);

                    if file.is_dir() {
                        fs::create_dir_all(&output_path)?;
                    } else {
                        if let Some(parent) = output_path.parent() {
                            fs::create_dir_all(parent)?;
                        }
                        let mut output_file = fs::File::create(&output_path)?;
                        std::io::copy(&mut file, &mut output_file)?;
                    }
                }
            }
        }

        if !found {
            return Err(anyhow!("Skill directory not found in archive"));
        }

        Ok(())
    }

    /// 卸载技能
    pub fn uninstall_skill(app_type: &AppType, directory: &str) -> Result<()> {
        let skills_dir = Self::get_skills_dir(app_type)?;
        let target_dir = skills_dir.join(directory);

        if target_dir.exists() {
            fs::remove_dir_all(&target_dir).context("Failed to remove skill directory")?;
        }

        Ok(())
    }

    /// 解析技能元数据
    fn parse_skill_metadata(&self, path: &Path) -> Result<SkillMetadata> {
        let content = fs::read_to_string(path).context("Failed to read SKILL.md")?;
        self.parse_skill_metadata_from_content(&content)
    }

    /// 从内容解析技能元数据
    fn parse_skill_metadata_from_content(&self, content: &str) -> Result<SkillMetadata> {
        let content = content.trim_start_matches('\u{feff}');
        let parts: Vec<&str> = content.splitn(3, "---").collect();

        if parts.len() < 3 {
            return Ok(SkillMetadata {
                name: None,
                description: None,
            });
        }

        let front_matter = parts[1].trim();
        let meta: SkillMetadata =
            serde_yaml::from_str(front_matter).context("Failed to parse YAML front matter")?;

        Ok(meta)
    }

    /// 清空技能仓库缓存
    pub fn refresh_cache(&self) {
        self.repo_cache.write().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::SkillService;

    #[test]
    fn build_branch_candidates_should_include_main_master_fallback() {
        assert_eq!(
            SkillService::build_branch_candidates("main"),
            vec!["main".to_string(), "master".to_string()]
        );
        assert_eq!(
            SkillService::build_branch_candidates("master"),
            vec!["master".to_string(), "main".to_string()]
        );
        assert_eq!(
            SkillService::build_branch_candidates("release"),
            vec!["release".to_string()]
        );
    }
}
