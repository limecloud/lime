use anyhow::{anyhow, Context, Result};
use parking_lot::{Mutex, RwLock};
use reqwest::Client;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::time::timeout;

use lime_core::app_paths;
use lime_core::models::{
    parse_skill_manifest_from_content as parse_manifest_content, resolve_skill_source_kind,
    summarize_skill_resources_dir, AppType, ParsedSkillManifest, Skill, SkillCatalogSource,
    SkillPackageInspection, SkillRepo, SkillResourceSummary, SkillSourceKind,
    SkillStandardCompliance, SkillState,
};

const DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(60);
const REMOTE_SKILLS_LIST_TIMEOUT: Duration = Duration::from_secs(8);
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

struct InflightFetchGuard<'a> {
    inflight_fetches: &'a Mutex<HashMap<RepoCacheKey, Arc<tokio::sync::Notify>>>,
    cache_key: RepoCacheKey,
    notify: Arc<tokio::sync::Notify>,
}

impl Drop for InflightFetchGuard<'_> {
    fn drop(&mut self) {
        self.inflight_fetches.lock().remove(&self.cache_key);
        self.notify.notify_waiters();
    }
}

struct RemoteSkillArchiveEntry {
    directory: String,
    content: String,
    readme_parent: String,
    files: HashMap<PathBuf, Vec<u8>>,
    resource_summary: SkillResourceSummary,
}

#[derive(Debug, Clone)]
struct CatalogSkillRoot {
    source: SkillCatalogSource,
    path: PathBuf,
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

    fn get_skills_dir(app_type: &AppType) -> Result<PathBuf> {
        let skills_dir = match app_type {
            AppType::Lime => app_paths::resolve_skills_dir().map_err(|e| anyhow!(e))?,
            AppType::Claude => dirs::home_dir()
                .ok_or_else(|| anyhow!("Failed to get home directory"))?
                .join(".claude")
                .join("skills"),
            AppType::Codex => dirs::home_dir()
                .ok_or_else(|| anyhow!("Failed to get home directory"))?
                .join(".codex")
                .join("skills"),
            AppType::Gemini => dirs::home_dir()
                .ok_or_else(|| anyhow!("Failed to get home directory"))?
                .join(".gemini")
                .join("skills"),
        };

        Ok(skills_dir)
    }

    fn get_catalog_roots(app_type: &AppType) -> Result<Vec<CatalogSkillRoot>> {
        match app_type {
            AppType::Lime => {
                let mut roots = Vec::new();
                if let Some(project_dir) = app_paths::resolve_project_skills_dir() {
                    roots.push(CatalogSkillRoot {
                        source: SkillCatalogSource::Project,
                        path: project_dir,
                    });
                }
                roots.push(CatalogSkillRoot {
                    source: SkillCatalogSource::User,
                    path: app_paths::resolve_skills_dir().map_err(|e| anyhow!(e))?,
                });
                Ok(roots)
            }
            _ => Ok(vec![CatalogSkillRoot {
                source: SkillCatalogSource::User,
                path: Self::get_skills_dir(app_type)?,
            }]),
        }
    }

    pub fn list_local_skills(
        &self,
        app_type: &AppType,
        _installed_states: &HashMap<String, SkillState>,
    ) -> Result<Vec<Skill>> {
        let mut all_skills: HashMap<String, Skill> = HashMap::new();
        let roots = Self::get_catalog_roots(app_type)?;
        self.collect_local_skills(app_type, &roots, &mut all_skills)?;

        let mut skills: Vec<Skill> = all_skills.into_values().collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(skills)
    }

    pub async fn list_skills(
        &self,
        app_type: &AppType,
        repos: &[SkillRepo],
        installed_states: &HashMap<String, SkillState>,
    ) -> Result<Vec<Skill>> {
        let mut all_skills: HashMap<String, Skill> = HashMap::new();
        let roots = Self::get_catalog_roots(app_type)?;
        self.collect_local_skills(app_type, &roots, &mut all_skills)?;

        for repo in repos.iter().filter(|repo| repo.enabled) {
            match self.fetch_skills_from_repo_cached(repo).await {
                Ok(remote_skills) => {
                    for mut skill in remote_skills {
                        if all_skills
                            .values()
                            .any(|existing| existing.directory == skill.directory)
                        {
                            continue;
                        }
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
                Err(error) => {
                    tracing::info!(
                        "[SkillService] 远程技能仓库 {}/{} 暂时不可用，已跳过: {}",
                        repo.owner,
                        repo.name,
                        error
                    );
                }
            }
        }

        let mut skills: Vec<Skill> = all_skills.into_values().collect();
        skills.sort_by(|a, b| a.name.cmp(&b.name));
        Ok(skills)
    }

    fn collect_local_skills(
        &self,
        app_type: &AppType,
        roots: &[CatalogSkillRoot],
        all_skills: &mut HashMap<String, Skill>,
    ) -> Result<()> {
        for root in roots {
            if !root.path.exists() {
                continue;
            }

            let mut entries = fs::read_dir(&root.path)
                .with_context(|| {
                    format!("Failed to read skills directory {}", root.path.display())
                })?
                .flatten()
                .collect::<Vec<_>>();
            entries.sort_by_key(|entry| entry.file_name().to_string_lossy().to_string());

            for entry in entries {
                if !entry.path().is_dir() {
                    continue;
                }

                let directory = entry.file_name().to_string_lossy().to_string();
                if all_skills
                    .values()
                    .any(|skill| skill.directory == directory)
                {
                    continue;
                }

                let skill_md = entry.path().join("SKILL.md");
                if !skill_md.is_file() {
                    continue;
                }

                let key = format!("local:{directory}");
                let resource_summary = summarize_skill_resources_dir(&entry.path());
                let source_kind = resolve_skill_source_kind(app_type, &directory);

                let skill = self.build_skill_from_file(
                    &skill_md,
                    key,
                    directory,
                    true,
                    source_kind,
                    root.source,
                    None,
                    None,
                    None,
                    None,
                    resource_summary,
                )?;
                all_skills.insert(skill.key.clone(), skill);
            }
        }

        Ok(())
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

        let _inflight_guard = InflightFetchGuard {
            inflight_fetches: &self.inflight_fetches,
            cache_key: cache_key.clone(),
            notify,
        };

        let result = match timeout(
            REMOTE_SKILLS_LIST_TIMEOUT,
            self.fetch_skills_from_repo_uncached(repo),
        )
        .await
        {
            Ok(Ok(skills)) => Ok(skills),
            Ok(Err(error)) => Err(error.to_string()),
            Err(_) => Err(format!(
                "拉取技能清单超时（{} 秒）",
                REMOTE_SKILLS_LIST_TIMEOUT.as_secs()
            )),
        };

        self.cache_repo_result(&cache_key, &result);

        result.map_err(|error| anyhow!(error))
    }

    fn cache_repo_result(
        &self,
        cache_key: &RepoCacheKey,
        result: &std::result::Result<Vec<Skill>, String>,
    ) {
        let entry = match result {
            Ok(skills) => RepoCacheEntry::success(skills.clone()),
            Err(error) => RepoCacheEntry::error(error.clone()),
        };
        self.repo_cache.write().insert(cache_key.clone(), entry);
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
        let manifests = self.load_remote_skill_archive_entries(repo, branch).await?;
        let mut skills = Vec::new();
        let repo_key_prefix = format!("{}/{}:", repo.owner, repo.name);
        for entry in manifests.into_values() {
            if entry.content.is_empty() {
                continue;
            }
            let key = format!("{repo_key_prefix}{}", entry.directory);
            let readme_url = Some(format!(
                "https://github.com/{}/{}/blob/{}/{}/SKILL.md",
                repo.owner, repo.name, branch, entry.readme_parent
            ));
            let skill = self.build_skill_from_remote_archive_entry(
                entry,
                key,
                readme_url,
                Some(repo.owner.clone()),
                Some(repo.name.clone()),
                Some(branch.to_string()),
            );
            skills.push(skill);
        }

        Ok(skills)
    }

    async fn load_remote_skill_archive_entries(
        &self,
        repo: &SkillRepo,
        branch: &str,
    ) -> Result<HashMap<String, RemoteSkillArchiveEntry>> {
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

        let mut manifests: HashMap<String, RemoteSkillArchiveEntry> = HashMap::new();
        for index in 0..archive.len() {
            let mut file = archive
                .by_index(index)
                .context("Failed to read ZIP entry")?;
            let archive_path = Path::new(file.name());

            let Some((directory, relative_path)) =
                Self::skill_file_marker_from_archive_path(archive_path)
            else {
                continue;
            };
            let readme_parent = archive_path
                .parent()
                .map(|parent| parent.to_string_lossy().to_string())
                .unwrap_or_default();
            let entry =
                manifests
                    .entry(directory.clone())
                    .or_insert_with(|| RemoteSkillArchiveEntry {
                        directory: directory.clone(),
                        content: String::new(),
                        readme_parent: readme_parent.clone(),
                        files: HashMap::new(),
                        resource_summary: SkillResourceSummary::default(),
                    });
            if entry.readme_parent.is_empty() {
                entry.readme_parent = readme_parent;
            }
            if let Some(resource_dir) =
                relative_path
                    .components()
                    .next()
                    .and_then(|component| match component {
                        Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                        _ => None,
                    })
            {
                match resource_dir.as_str() {
                    "scripts" => entry.resource_summary.has_scripts = true,
                    "references" => entry.resource_summary.has_references = true,
                    "assets" => entry.resource_summary.has_assets = true,
                    _ => {}
                }
            }

            if file.is_dir() {
                continue;
            }

            use std::io::Read;
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes)
                .context("Failed to read skill archive entry")?;

            if relative_path == Path::new("SKILL.md") {
                entry.content = String::from_utf8(bytes).context("Failed to read SKILL.md")?;
                continue;
            }

            entry.files.insert(relative_path, bytes);
        }

        Ok(manifests)
    }

    fn skill_file_marker_from_archive_path(path: &Path) -> Option<(String, PathBuf)> {
        let components: Vec<String> = path
            .components()
            .filter_map(|component| match component {
                Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                _ => None,
            })
            .collect();

        if components.len() < 3 {
            return None;
        }

        let directory = components.get(1)?.clone();
        let mut relative_path = PathBuf::new();
        for component in components.iter().skip(2) {
            relative_path.push(component);
        }
        if relative_path.as_os_str().is_empty() {
            return None;
        }

        Some((directory, relative_path))
    }

    #[cfg(test)]
    fn skill_resource_marker_from_archive_path(path: &Path) -> Option<(String, String)> {
        let (directory, relative_path) = Self::skill_file_marker_from_archive_path(path)?;
        let resource_dir =
            relative_path
                .components()
                .next()
                .and_then(|component| match component {
                    Component::Normal(value) => Some(value.to_string_lossy().to_string()),
                    _ => None,
                })?;
        if !matches!(resource_dir.as_str(), "scripts" | "references" | "assets") {
            return None;
        }

        Some((directory, resource_dir))
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
                Ok(()) => match self.validate_installed_skill_dir(&target_dir) {
                    Ok(()) => return Ok(()),
                    Err(error) => {
                        let _ = fs::remove_dir_all(&target_dir);
                        last_error = Some(error);
                    }
                },
                Err(error) => last_error = Some(error),
            }
        }

        Err(last_error.unwrap_or_else(|| anyhow!("Failed to install skill")))
    }

    pub async fn inspect_remote_skill(
        &self,
        repo_owner: &str,
        repo_name: &str,
        repo_branch: &str,
        directory: &str,
    ) -> Result<SkillPackageInspection> {
        for branch in Self::build_branch_candidates(repo_branch) {
            let repo = SkillRepo {
                owner: repo_owner.to_string(),
                name: repo_name.to_string(),
                branch: branch.clone(),
                enabled: true,
            };

            match self.load_remote_skill_archive_entries(&repo, &branch).await {
                Ok(entries) => {
                    let entry = entries
                        .into_values()
                        .find(|entry| entry.directory == directory)
                        .ok_or_else(|| anyhow!("Skill directory not found in archive"))?;

                    return Ok(Self::inspect_remote_skill_package(
                        &entry.content,
                        entry.resource_summary,
                        &entry.files,
                    ));
                }
                Err(error) => {
                    if branch == repo_branch {
                        continue;
                    }
                    tracing::warn!(
                        "[SkillService] inspect remote skill fallback {} -> {} failed: {}",
                        repo_branch,
                        branch,
                        error
                    );
                }
            }
        }

        Err(anyhow!(
            "Failed to inspect remote skill {}/{}@{}:{}",
            repo_owner,
            repo_name,
            repo_branch,
            directory
        ))
    }

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

        let skill_prefix = format!("/{directory}/");
        let mut found = false;

        for index in 0..archive.len() {
            let mut file = archive.by_index(index)?;
            let file_path = file.name().to_string();

            if !file_path.contains(&skill_prefix) {
                continue;
            }

            found = true;
            let relative_path = file_path
                .split(&skill_prefix)
                .nth(1)
                .unwrap_or("")
                .to_string();

            if relative_path.is_empty() {
                continue;
            }

            let output_path = target_dir.join(&relative_path);
            if file.is_dir() {
                fs::create_dir_all(&output_path)?;
                continue;
            }

            if let Some(parent) = output_path.parent() {
                fs::create_dir_all(parent)?;
            }
            let mut output_file = fs::File::create(&output_path)?;
            std::io::copy(&mut file, &mut output_file)?;
        }

        if !found {
            return Err(anyhow!("Skill directory not found in archive"));
        }

        Ok(())
    }

    pub fn uninstall_skill(app_type: &AppType, directory: &str) -> Result<()> {
        let skills_dir = Self::get_skills_dir(app_type)?;
        let target_dir = skills_dir.join(directory);

        if target_dir.exists() {
            fs::remove_dir_all(&target_dir).context("Failed to remove skill directory")?;
        }

        Ok(())
    }

    fn parse_skill_manifest_from_content(&self, content: &str) -> Result<ParsedSkillManifest> {
        parse_manifest_content(content).map_err(|error| anyhow!(error))
    }

    fn validate_installed_skill_dir(&self, skill_dir: &Path) -> Result<()> {
        let inspection = Self::inspect_skill_dir(skill_dir)?;
        if !inspection.standard_compliance.validation_errors.is_empty() {
            return Err(anyhow!(
                "Skill package is not Agent Skills compliant: {}",
                inspection.standard_compliance.validation_errors.join("; ")
            ));
        }
        Ok(())
    }

    pub fn inspect_skill_dir(skill_dir: &Path) -> Result<SkillPackageInspection> {
        let skill_md = skill_dir.join("SKILL.md");
        if !skill_md.is_file() {
            return Err(anyhow!("Skill package missing SKILL.md"));
        }

        let content = fs::read_to_string(&skill_md).context("Failed to read SKILL.md")?;
        let resource_summary = summarize_skill_resources_dir(skill_dir);

        Ok(Self::build_skill_inspection(
            &content,
            resource_summary,
            |relative_path| Self::read_skill_relative_file(skill_dir, relative_path),
        ))
    }

    fn inspect_remote_skill_package(
        content: &str,
        resource_summary: SkillResourceSummary,
        files: &HashMap<PathBuf, Vec<u8>>,
    ) -> SkillPackageInspection {
        Self::build_skill_inspection(content, resource_summary, |relative_path| {
            Self::read_archive_skill_relative_file(files, relative_path)
        })
    }

    fn build_skill_inspection<F>(
        content: &str,
        resource_summary: SkillResourceSummary,
        mut read_relative_file: F,
    ) -> SkillPackageInspection
    where
        F: FnMut(&str) -> Result<String>,
    {
        let (license, metadata, allowed_tools, mut standard_compliance) =
            match parse_manifest_content(content) {
                Ok(manifest) => (
                    manifest.metadata.license,
                    manifest.metadata.metadata,
                    manifest.metadata.allowed_tools,
                    manifest.compliance,
                ),
                Err(error) => (
                    None,
                    HashMap::new(),
                    Vec::new(),
                    SkillStandardCompliance {
                        is_standard: false,
                        validation_errors: vec![error],
                        deprecated_fields: Vec::new(),
                    },
                ),
            };

        Self::validate_lime_skill_metadata(
            &metadata,
            &mut standard_compliance.validation_errors,
            |relative_path| read_relative_file(relative_path),
        );
        standard_compliance.validation_errors.sort();
        standard_compliance.validation_errors.dedup();
        standard_compliance.is_standard = standard_compliance.validation_errors.is_empty();

        SkillPackageInspection {
            content: content.to_string(),
            license,
            metadata,
            allowed_tools,
            resource_summary,
            standard_compliance,
        }
    }

    fn validate_lime_skill_metadata(
        metadata: &HashMap<String, String>,
        validation_errors: &mut Vec<String>,
        mut read_relative_file: impl FnMut(&str) -> Result<String>,
    ) {
        let Some(workflow_ref) = metadata.get("lime_workflow_ref") else {
            return;
        };

        let workflow_ref = workflow_ref.trim();
        if workflow_ref.is_empty() {
            validation_errors.push("字段 `metadata.lime_workflow_ref` 不能为空".to_string());
            return;
        }

        match read_relative_file(workflow_ref) {
            Ok(content) => {
                if let Err(error) = Self::validate_workflow_content(workflow_ref, &content) {
                    validation_errors.push(format!(
                        "字段 `metadata.lime_workflow_ref` 校验失败: {error}"
                    ));
                }
            }
            Err(error) => {
                validation_errors.push(format!(
                    "字段 `metadata.lime_workflow_ref` 校验失败: {error}"
                ));
            }
        }
    }

    fn validate_workflow_content(workflow_ref: &str, content: &str) -> Result<()> {
        let parsed = serde_yaml::from_str::<serde_yaml::Value>(content)
            .map_err(|error| anyhow!("`{workflow_ref}` 无法解析为 JSON/YAML: {error}"))?;

        let is_valid = parsed.is_sequence()
            || parsed
                .as_mapping()
                .and_then(|mapping| {
                    mapping
                        .get(serde_yaml::Value::String("steps".to_string()))
                        .and_then(|value| value.as_sequence())
                })
                .is_some();

        if !is_valid {
            return Err(anyhow!(
                "`{workflow_ref}` 必须是数组，或包含数组字段 `steps` 的对象"
            ));
        }

        Ok(())
    }

    fn normalize_skill_relative_path(relative_path: &str) -> Result<PathBuf> {
        let relative_path = Path::new(relative_path);
        if relative_path.is_absolute() {
            return Err(anyhow!("必须引用 skill 包内的相对路径"));
        }

        let mut normalized = PathBuf::new();
        for component in relative_path.components() {
            match component {
                Component::Normal(value) => normalized.push(value),
                Component::CurDir => {}
                _ => return Err(anyhow!("不能引用 skill 包外路径")),
            }
        }

        if normalized.as_os_str().is_empty() {
            return Err(anyhow!("引用文件路径不能为空"));
        }

        Ok(normalized)
    }

    fn read_skill_relative_file(skill_dir: &Path, relative_path: &str) -> Result<String> {
        let workflow_path = Self::resolve_skill_relative_file(skill_dir, relative_path)?;
        fs::read_to_string(&workflow_path)
            .with_context(|| format!("无法读取 workflow 引用文件 `{}`", workflow_path.display()))
    }

    fn read_archive_skill_relative_file(
        files: &HashMap<PathBuf, Vec<u8>>,
        relative_path: &str,
    ) -> Result<String> {
        let normalized = Self::normalize_skill_relative_path(relative_path)?;
        let bytes = files
            .get(&normalized)
            .ok_or_else(|| anyhow!("引用文件不存在: {}", normalized.display()))?;
        String::from_utf8(bytes.clone()).map_err(|error| {
            anyhow!(
                "无法读取 workflow 引用文件 `{}`: {error}",
                normalized.display()
            )
        })
    }

    fn resolve_skill_relative_file(skill_dir: &Path, relative_path: &str) -> Result<PathBuf> {
        let normalized = Self::normalize_skill_relative_path(relative_path)?;
        let candidate = skill_dir.join(&normalized);
        if !candidate.is_file() {
            return Err(anyhow!("引用文件不存在: {}", normalized.display()));
        }

        let canonical_skill_dir = skill_dir.canonicalize().context("无法解析 skill 包目录")?;
        let canonical_candidate = candidate
            .canonicalize()
            .with_context(|| format!("无法解析引用文件: {}", candidate.display()))?;
        if !canonical_candidate.starts_with(&canonical_skill_dir) {
            return Err(anyhow!("不能引用 skill 包外路径"));
        }

        Ok(canonical_candidate)
    }

    fn build_skill_from_file(
        &self,
        skill_md: &Path,
        key: String,
        directory: String,
        installed: bool,
        source_kind: SkillSourceKind,
        catalog_source: SkillCatalogSource,
        readme_url: Option<String>,
        repo_owner: Option<String>,
        repo_name: Option<String>,
        repo_branch: Option<String>,
        _resource_summary: SkillResourceSummary,
    ) -> Result<Skill> {
        let skill_dir = skill_md
            .parent()
            .ok_or_else(|| anyhow!("Failed to resolve skill directory"))?;
        let inspection = Self::inspect_skill_dir(skill_dir)?;
        Ok(self.build_skill_from_inspection(
            inspection,
            key,
            directory,
            installed,
            source_kind,
            catalog_source,
            readme_url,
            repo_owner,
            repo_name,
            repo_branch,
        ))
    }

    fn build_skill_from_remote_archive_entry(
        &self,
        entry: RemoteSkillArchiveEntry,
        key: String,
        readme_url: Option<String>,
        repo_owner: Option<String>,
        repo_name: Option<String>,
        repo_branch: Option<String>,
    ) -> Skill {
        let inspection = Self::inspect_remote_skill_package(
            &entry.content,
            entry.resource_summary,
            &entry.files,
        );
        self.build_skill_from_inspection(
            inspection,
            key,
            entry.directory,
            false,
            SkillSourceKind::Other,
            SkillCatalogSource::Remote,
            readme_url,
            repo_owner,
            repo_name,
            repo_branch,
        )
    }

    fn build_skill_from_inspection(
        &self,
        inspection: SkillPackageInspection,
        key: String,
        directory: String,
        installed: bool,
        source_kind: SkillSourceKind,
        catalog_source: SkillCatalogSource,
        readme_url: Option<String>,
        repo_owner: Option<String>,
        repo_name: Option<String>,
        repo_branch: Option<String>,
    ) -> Skill {
        let parsed_manifest = self
            .parse_skill_manifest_from_content(&inspection.content)
            .ok();

        Skill {
            key,
            name: parsed_manifest
                .as_ref()
                .and_then(|manifest| manifest.metadata.name.clone())
                .unwrap_or_else(|| directory.clone()),
            description: parsed_manifest
                .as_ref()
                .and_then(|manifest| manifest.metadata.description.clone())
                .unwrap_or_default(),
            directory,
            readme_url,
            installed,
            source_kind,
            catalog_source,
            repo_owner,
            repo_name,
            repo_branch,
            license: inspection.license,
            metadata: inspection.metadata,
            allowed_tools: inspection.allowed_tools,
            resource_summary: Some(inspection.resource_summary),
            standard_compliance: Some(inspection.standard_compliance),
        }
    }

    pub fn refresh_cache(&self) {
        self.repo_cache.write().clear();
    }
}

#[cfg(test)]
mod tests {
    use super::{CatalogSkillRoot, SkillService};
    use lime_core::models::{AppType, SkillCatalogSource};
    use std::collections::HashMap;
    use std::path::{Path, PathBuf};
    use tempfile::TempDir;

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

    #[test]
    fn resource_marker_should_extract_skill_dir_and_resource_dir() {
        let path = Path::new("repo-main/content_post_with_cover/references/workflow.json");
        let marker = SkillService::skill_resource_marker_from_archive_path(path);
        assert_eq!(
            marker,
            Some((
                "content_post_with_cover".to_string(),
                "references".to_string()
            ))
        );
    }

    #[test]
    fn inspect_skill_dir_should_collect_standard_metadata_and_workflow_state() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("content_post_with_cover");
        let references_dir = skill_dir.join("references");
        std::fs::create_dir_all(&references_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: Social Post
description: Generate social posts
license: MIT
metadata:
  lime_workflow_ref: references/workflow.json
  lime_category: social
allowed-tools:
  - web.search
---

# Social Post
"#,
        )
        .unwrap();
        std::fs::write(
            references_dir.join("workflow.json"),
            r#"{"steps":[{"id":"draft","title":"起草"}]}"#,
        )
        .unwrap();

        let inspection = SkillService::inspect_skill_dir(&skill_dir).unwrap();

        assert_eq!(inspection.license.as_deref(), Some("MIT"));
        assert_eq!(
            inspection.metadata.get("lime_category").map(String::as_str),
            Some("social")
        );
        assert_eq!(inspection.allowed_tools, vec!["web.search".to_string()]);
        assert!(inspection.resource_summary.has_references);
        assert!(inspection.standard_compliance.is_standard);
        assert!(inspection.standard_compliance.validation_errors.is_empty());
    }

    #[test]
    fn inspect_skill_dir_should_report_invalid_workflow_reference() {
        let temp_dir = TempDir::new().unwrap();
        let skill_dir = temp_dir.path().join("broken_skill");
        std::fs::create_dir_all(&skill_dir).unwrap();
        std::fs::write(
            skill_dir.join("SKILL.md"),
            r#"---
name: Broken
description: Broken workflow
metadata:
  lime_workflow_ref: ../outside.yaml
---
"#,
        )
        .unwrap();

        let inspection = SkillService::inspect_skill_dir(&skill_dir).unwrap();

        assert!(!inspection.standard_compliance.is_standard);
        assert!(inspection
            .standard_compliance
            .validation_errors
            .iter()
            .any(|error| error.contains("不能引用 skill 包外路径")));
    }

    #[test]
    fn inspect_remote_skill_package_should_report_invalid_workflow_reference() {
        let mut files = HashMap::new();
        files.insert(
            PathBuf::from("references").join("workflow.json"),
            br#"{"title":"missing steps"}"#.to_vec(),
        );

        let inspection = SkillService::inspect_remote_skill_package(
            r#"---
name: Remote Broken
description: Broken workflow
metadata:
  lime_workflow_ref: references/workflow.json
---
"#,
            lime_core::models::SkillResourceSummary {
                has_references: true,
                ..Default::default()
            },
            &files,
        );

        assert!(!inspection.standard_compliance.is_standard);
        assert!(inspection
            .standard_compliance
            .validation_errors
            .iter()
            .any(|error| error.contains("必须是数组，或包含数组字段 `steps` 的对象")));
    }

    #[test]
    fn collect_local_skills_should_prefer_project_root_and_mark_catalog_source() {
        let service = SkillService::new().unwrap();
        let temp_dir = TempDir::new().unwrap();
        let project_root = temp_dir
            .path()
            .join("project")
            .join(".agents")
            .join("skills");
        let user_root = temp_dir.path().join("user").join("skills");
        let project_skill_dir = project_root.join("shared-skill");
        let user_skill_dir = user_root.join("shared-skill");

        std::fs::create_dir_all(&project_skill_dir).unwrap();
        std::fs::create_dir_all(&user_skill_dir).unwrap();
        std::fs::write(
            project_skill_dir.join("SKILL.md"),
            "---\nname: Project Skill\ndescription: from project\n---\n",
        )
        .unwrap();
        std::fs::write(
            user_skill_dir.join("SKILL.md"),
            "---\nname: User Skill\ndescription: from user\n---\n",
        )
        .unwrap();

        let mut all_skills = HashMap::new();
        service
            .collect_local_skills(
                &AppType::Lime,
                &[
                    CatalogSkillRoot {
                        source: SkillCatalogSource::Project,
                        path: project_root,
                    },
                    CatalogSkillRoot {
                        source: SkillCatalogSource::User,
                        path: user_root,
                    },
                ],
                &mut all_skills,
            )
            .unwrap();

        let skill = all_skills.get("local:shared-skill").unwrap();
        assert_eq!(skill.name, "Project Skill");
        assert_eq!(skill.catalog_source, SkillCatalogSource::Project);
    }

    #[test]
    fn collect_local_skills_should_surface_workflow_validation_errors() {
        let service = SkillService::new().unwrap();
        let temp_dir = TempDir::new().unwrap();
        let user_root = temp_dir.path().join("user").join("skills");
        let broken_skill_dir = user_root.join("broken-workflow");
        std::fs::create_dir_all(&broken_skill_dir).unwrap();
        std::fs::write(
            broken_skill_dir.join("SKILL.md"),
            r#"---
name: Broken Workflow
description: local validation
metadata:
  lime_workflow_ref: references/workflow.json
---
"#,
        )
        .unwrap();

        let mut all_skills = HashMap::new();
        service
            .collect_local_skills(
                &AppType::Lime,
                &[CatalogSkillRoot {
                    source: SkillCatalogSource::User,
                    path: user_root,
                }],
                &mut all_skills,
            )
            .unwrap();

        let skill = all_skills.get("local:broken-workflow").unwrap();
        assert!(!skill.standard_compliance.as_ref().unwrap().is_standard);
        assert!(skill
            .standard_compliance
            .as_ref()
            .unwrap()
            .validation_errors
            .iter()
            .any(|error| error.contains("引用文件不存在")));
    }
}
