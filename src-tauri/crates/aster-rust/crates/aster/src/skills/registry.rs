//! Skill Registry
//!
//! Manages skill discovery, registration, and lookup.

use super::loader::{
    build_plugin_skill_registry_snapshot_with_context, load_skills_from_directory,
    load_skills_from_plugin_cache_with_context,
};
use super::types::{InvokedSkill, SkillDefinition, SkillSource};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, RwLock};
use std::time::{SystemTime, UNIX_EPOCH};

/// Skill registry for managing all available skills
#[derive(Debug, Default)]
pub struct SkillRegistry {
    /// Registered skills by name
    skills: HashMap<String, SkillDefinition>,
    /// Invoked skills history
    invoked: HashMap<String, InvokedSkill>,
    /// Plugin skills snapshot for on-demand refresh
    plugin_snapshot: Option<String>,
    /// Whether skills have been loaded
    loaded: bool,
}

impl SkillRegistry {
    /// Create a new empty registry
    pub fn new() -> Self {
        Self::default()
    }

    /// Check if skills have been loaded
    pub fn is_loaded(&self) -> bool {
        self.loaded
    }

    /// Get all registered skills
    pub fn get_all(&self) -> Vec<&SkillDefinition> {
        self.skills.values().collect()
    }

    /// Get skill count
    pub fn len(&self) -> usize {
        self.skills.len()
    }

    /// Check if registry is empty
    pub fn is_empty(&self) -> bool {
        self.skills.is_empty()
    }

    /// Register a skill
    pub fn register(&mut self, skill: SkillDefinition) {
        self.skills.insert(skill.skill_name.clone(), skill);
    }

    /// Unregister a skill by name
    pub fn unregister(&mut self, skill_name: &str) -> Option<SkillDefinition> {
        self.skills.remove(skill_name)
    }

    /// Find a skill by name (supports namespace lookup)
    pub fn find(&self, skill_input: &str) -> Option<&SkillDefinition> {
        // 1. Exact match
        if let Some(skill) = self.skills.get(skill_input) {
            return Some(skill);
        }

        // 2. If no namespace, try to find first matching short name
        if !skill_input.contains(':') {
            for skill in self.skills.values() {
                if skill.short_name() == skill_input {
                    return Some(skill);
                }
            }
        }

        None
    }

    /// Get skills by source
    pub fn get_by_source(&self, source: SkillSource) -> Vec<&SkillDefinition> {
        self.skills
            .values()
            .filter(|s| s.source == source)
            .collect()
    }

    /// Get user-invocable skills
    pub fn get_user_invocable(&self) -> Vec<&SkillDefinition> {
        self.skills.values().filter(|s| s.user_invocable).collect()
    }

    /// Record an invoked skill
    pub fn record_invoked(&mut self, skill_name: &str, skill_path: &Path, content: &str) {
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);

        self.invoked.insert(
            skill_name.to_string(),
            InvokedSkill {
                skill_name: skill_name.to_string(),
                skill_path: skill_path.to_path_buf(),
                content: content.to_string(),
                invoked_at: timestamp,
            },
        );
    }

    /// Get invoked skills
    pub fn get_invoked(&self) -> &HashMap<String, InvokedSkill> {
        &self.invoked
    }

    /// Clear invoked skills history
    pub fn clear_invoked(&mut self) {
        self.invoked.clear();
    }

    /// Clear all skills and reset loaded state
    pub fn clear(&mut self) {
        self.skills.clear();
        self.invoked.clear();
        self.plugin_snapshot = None;
        self.loaded = false;
    }

    /// Get default skill directories
    pub fn get_default_directories() -> Vec<(PathBuf, SkillSource)> {
        let workspace_root = std::env::current_dir().ok();
        let home_dir = dirs::home_dir();
        Self::get_default_directories_with_context(workspace_root.as_deref(), home_dir.as_deref())
    }

    /// Get default skill directories with explicit context
    pub fn get_default_directories_with_context(
        workspace_root: Option<&Path>,
        home_dir: Option<&Path>,
    ) -> Vec<(PathBuf, SkillSource)> {
        let mut dirs = Vec::new();

        // User-level directories
        if let Some(home) = home_dir {
            dirs.push((home.join(".claude/skills"), SkillSource::User));
        }

        // Project-level directories
        if let Some(workspace_root) = workspace_root {
            dirs.push((workspace_root.join(".claude/skills"), SkillSource::Project));
        }

        dirs
    }

    fn load_all_skills_with_context(
        &mut self,
        workspace_root: Option<&Path>,
        home_dir: Option<&Path>,
        plugin_snapshot: Option<String>,
    ) {
        self.skills.clear();
        self.plugin_snapshot = Some(plugin_snapshot.unwrap_or_else(|| {
            build_plugin_skill_registry_snapshot_with_context(workspace_root, home_dir)
        }));

        for skill in load_skills_from_plugin_cache_with_context(workspace_root, home_dir) {
            self.skills.insert(skill.skill_name.clone(), skill);
        }

        for (dir, source) in Self::get_default_directories_with_context(workspace_root, home_dir) {
            for skill in load_skills_from_directory(&dir, source) {
                self.skills.insert(skill.skill_name.clone(), skill);
            }
        }

        self.loaded = true;
    }

    /// Initialize and load all skills
    ///
    /// Loading order (later overrides earlier):
    /// 1. Plugin skills (lowest priority)
    /// 2. User skills (~/.claude/skills/)
    /// 3. Project skills (.claude/skills/) (highest priority)
    pub fn initialize(&mut self) {
        let workspace_root = std::env::current_dir().ok();
        let home_dir = dirs::home_dir();
        self.initialize_with_context(workspace_root.as_deref(), home_dir.as_deref());
    }

    pub fn initialize_with_context(
        &mut self,
        workspace_root: Option<&Path>,
        home_dir: Option<&Path>,
    ) {
        if self.loaded {
            return;
        }
        self.load_all_skills_with_context(workspace_root, home_dir, None);
    }

    /// Reload skills (clear and reinitialize)
    pub fn reload(&mut self) {
        let workspace_root = std::env::current_dir().ok();
        let home_dir = dirs::home_dir();
        self.reload_with_context(workspace_root.as_deref(), home_dir.as_deref());
    }

    pub fn reload_with_context(&mut self, workspace_root: Option<&Path>, home_dir: Option<&Path>) {
        self.loaded = false;
        self.load_all_skills_with_context(workspace_root, home_dir, None);
    }

    pub fn refresh_plugin_skills_if_needed(&mut self) -> bool {
        let workspace_root = std::env::current_dir().ok();
        let home_dir = dirs::home_dir();
        self.refresh_plugin_skills_if_needed_with_context(
            workspace_root.as_deref(),
            home_dir.as_deref(),
        )
    }

    pub fn refresh_plugin_skills_if_needed_with_context(
        &mut self,
        workspace_root: Option<&Path>,
        home_dir: Option<&Path>,
    ) -> bool {
        let next_snapshot =
            build_plugin_skill_registry_snapshot_with_context(workspace_root, home_dir);

        if !self.loaded {
            self.load_all_skills_with_context(workspace_root, home_dir, Some(next_snapshot));
            return true;
        }

        if self.plugin_snapshot.as_deref() == Some(next_snapshot.as_str()) {
            return false;
        }

        self.loaded = false;
        self.load_all_skills_with_context(workspace_root, home_dir, Some(next_snapshot));
        true
    }

    /// Generate instructions for available skills
    pub fn generate_instructions(&self) -> String {
        if self.skills.is_empty() {
            return String::new();
        }

        let mut instructions =
            String::from("You have these skills at your disposal. Use them when relevant:\n\n");

        let mut skill_list: Vec<_> = self.skills.values().collect();
        skill_list.sort_by_key(|s| &s.skill_name);

        for skill in skill_list {
            instructions.push_str(&format!("- {}: {}\n", skill.skill_name, skill.description));
        }

        instructions
    }
}

/// Thread-safe shared skill registry
pub type SharedSkillRegistry = Arc<RwLock<SkillRegistry>>;

/// Create a new shared skill registry
pub fn new_shared_registry() -> SharedSkillRegistry {
    Arc::new(RwLock::new(SkillRegistry::new()))
}

pub fn refresh_shared_registry_if_needed(registry: &SharedSkillRegistry) -> Result<bool, String> {
    let mut guard = registry.write().map_err(|error| error.to_string())?;
    Ok(guard.refresh_plugin_skills_if_needed())
}

/// Global skill registry instance
static GLOBAL_REGISTRY: std::sync::OnceLock<SharedSkillRegistry> = std::sync::OnceLock::new();

/// Get the global skill registry
pub fn global_registry() -> &'static SharedSkillRegistry {
    GLOBAL_REGISTRY.get_or_init(|| {
        let registry = new_shared_registry();
        if let Ok(mut r) = registry.write() {
            r.initialize();
        }
        registry
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::skills::types::SkillExecutionMode;
    use std::collections::BTreeSet;
    #[allow(unused_imports)]
    use std::fs;
    #[allow(unused_imports)]
    use tempfile::TempDir;

    fn create_test_skill(name: &str, source: SkillSource) -> SkillDefinition {
        SkillDefinition {
            skill_name: format!("{}:{}", source, name),
            display_name: name.to_string(),
            description: format!("Test skill: {}", name),
            has_user_specified_description: true,
            markdown_content: "# Content".to_string(),
            allowed_tools: None,
            argument_hint: None,
            when_to_use: None,
            version: None,
            model: None,
            disable_model_invocation: false,
            user_invocable: true,
            source,
            base_dir: PathBuf::from("/test"),
            file_path: PathBuf::from("/test/SKILL.md"),
            supporting_files: vec![],
            execution_mode: SkillExecutionMode::default(),
            provider: None,
            workflow: None,
            hooks: None,
        }
    }

    fn create_plugin_skill_fixture(
        home_dir: &Path,
        plugin_id: &str,
        skill_name: &str,
        skill_content: &str,
    ) -> PathBuf {
        let (plugin_name, marketplace) = plugin_id
            .rsplit_once('@')
            .expect("plugin fixture must use plugin@marketplace format");
        let plugin_root = home_dir
            .join(".claude/plugins/cache")
            .join(marketplace)
            .join(plugin_name)
            .join("1.0.0");
        let skill_dir = plugin_root.join("skills").join(skill_name);
        fs::create_dir_all(&skill_dir).unwrap();
        let skill_path = skill_dir.join("SKILL.md");
        fs::write(&skill_path, skill_content).unwrap();
        skill_path
    }

    fn write_enabled_plugin_settings(path: &Path, entries: &[(&str, bool)]) {
        let enabled_plugins = entries
            .iter()
            .map(|(plugin_id, enabled)| {
                ((*plugin_id).to_string(), serde_json::Value::Bool(*enabled))
            })
            .collect::<serde_json::Map<_, _>>();
        let settings = serde_json::json!({ "enabledPlugins": enabled_plugins });

        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(path, serde_json::to_vec(&settings).unwrap()).unwrap();
    }

    fn collect_skill_names(registry: &SkillRegistry) -> BTreeSet<String> {
        registry
            .get_all()
            .into_iter()
            .map(|skill| skill.skill_name.clone())
            .collect()
    }

    #[test]
    fn test_registry_new() {
        let registry = SkillRegistry::new();
        assert!(!registry.is_loaded());
        assert!(registry.is_empty());
    }

    #[test]
    fn test_registry_register_and_find() {
        let mut registry = SkillRegistry::new();
        let skill = create_test_skill("my-skill", SkillSource::User);

        registry.register(skill);

        assert_eq!(registry.len(), 1);

        // Exact match
        let found = registry.find("user:my-skill");
        assert!(found.is_some());
        assert_eq!(found.unwrap().display_name, "my-skill");

        // Short name match
        let found = registry.find("my-skill");
        assert!(found.is_some());
    }

    #[test]
    fn test_registry_unregister() {
        let mut registry = SkillRegistry::new();
        let skill = create_test_skill("to-remove", SkillSource::User);

        registry.register(skill);
        assert_eq!(registry.len(), 1);

        let removed = registry.unregister("user:to-remove");
        assert!(removed.is_some());
        assert_eq!(registry.len(), 0);
    }

    #[test]
    fn test_registry_get_by_source() {
        let mut registry = SkillRegistry::new();

        registry.register(create_test_skill("user-skill", SkillSource::User));
        registry.register(create_test_skill("project-skill", SkillSource::Project));
        registry.register(create_test_skill("plugin-skill", SkillSource::Plugin));

        let user_skills = registry.get_by_source(SkillSource::User);
        assert_eq!(user_skills.len(), 1);

        let project_skills = registry.get_by_source(SkillSource::Project);
        assert_eq!(project_skills.len(), 1);
    }

    #[test]
    fn test_registry_record_invoked() {
        let mut registry = SkillRegistry::new();

        registry.record_invoked(
            "test-skill",
            &PathBuf::from("/test/SKILL.md"),
            "skill content",
        );

        let invoked = registry.get_invoked();
        assert_eq!(invoked.len(), 1);
        assert!(invoked.contains_key("test-skill"));
    }

    #[test]
    fn test_registry_generate_instructions() {
        let mut registry = SkillRegistry::new();

        // Empty registry
        let instructions = registry.generate_instructions();
        assert!(instructions.is_empty());

        // With skills
        registry.register(create_test_skill("alpha", SkillSource::User));
        registry.register(create_test_skill("beta", SkillSource::Project));

        let instructions = registry.generate_instructions();
        assert!(instructions.contains("alpha"));
        assert!(instructions.contains("beta"));
    }

    #[test]
    fn test_registry_clear() {
        let mut registry = SkillRegistry::new();
        registry.register(create_test_skill("skill", SkillSource::User));
        registry.record_invoked("skill", &PathBuf::from("/test"), "content");

        registry.clear();

        assert!(registry.is_empty());
        assert!(registry.get_invoked().is_empty());
        assert!(!registry.is_loaded());
    }

    #[test]
    fn test_shared_registry() {
        let registry = new_shared_registry();

        {
            let mut r = registry.write().unwrap();
            r.register(create_test_skill("shared-skill", SkillSource::User));
        }

        {
            let r = registry.read().unwrap();
            assert_eq!(r.len(), 1);
        }
    }

    #[test]
    fn test_refresh_plugin_skills_if_needed_with_context_detects_noop_snapshot() {
        let workspace_dir = TempDir::new().unwrap();
        let home_dir = TempDir::new().unwrap();
        create_plugin_skill_fixture(
            home_dir.path(),
            "plugin-a@acme",
            "alpha",
            "---\nname: alpha\ndescription: first\n---\n\nbody\n",
        );
        write_enabled_plugin_settings(
            &home_dir.path().join(".claude/settings.json"),
            &[("plugin-a@acme", true)],
        );

        let mut registry = SkillRegistry::new();
        registry.initialize_with_context(Some(workspace_dir.path()), Some(home_dir.path()));

        assert!(registry.find("plugin-a:alpha").is_some());
        assert!(!registry.refresh_plugin_skills_if_needed_with_context(
            Some(workspace_dir.path()),
            Some(home_dir.path())
        ));
    }

    #[test]
    fn test_refresh_plugin_skills_if_needed_with_context_reloads_when_skill_content_changes() {
        let workspace_dir = TempDir::new().unwrap();
        let home_dir = TempDir::new().unwrap();
        let skill_path = create_plugin_skill_fixture(
            home_dir.path(),
            "plugin-a@acme",
            "alpha",
            "---\nname: alpha\ndescription: first\n---\n\nbody v1\n",
        );
        write_enabled_plugin_settings(
            &home_dir.path().join(".claude/settings.json"),
            &[("plugin-a@acme", true)],
        );

        let mut registry = SkillRegistry::new();
        registry.initialize_with_context(Some(workspace_dir.path()), Some(home_dir.path()));
        registry.record_invoked("plugin-a:alpha", &skill_path, "before-refresh");

        fs::write(
            &skill_path,
            "---\nname: alpha\ndescription: updated version\n---\n\nbody v2 changed\n",
        )
        .unwrap();

        assert!(registry.refresh_plugin_skills_if_needed_with_context(
            Some(workspace_dir.path()),
            Some(home_dir.path())
        ));

        let skill = registry.find("plugin-a:alpha").unwrap();
        assert_eq!(skill.description, "updated version");
        assert_eq!(registry.get_invoked().len(), 1);
        assert!(registry.get_invoked().contains_key("plugin-a:alpha"));
    }

    #[test]
    fn test_refresh_plugin_skills_if_needed_with_context_prunes_disabled_plugin_skills() {
        let workspace_dir = TempDir::new().unwrap();
        let home_dir = TempDir::new().unwrap();
        create_plugin_skill_fixture(
            home_dir.path(),
            "plugin-a@acme",
            "alpha",
            "---\nname: alpha\ndescription: first\n---\n\nbody\n",
        );
        write_enabled_plugin_settings(
            &home_dir.path().join(".claude/settings.json"),
            &[("plugin-a@acme", true)],
        );

        let mut registry = SkillRegistry::new();
        registry.initialize_with_context(Some(workspace_dir.path()), Some(home_dir.path()));
        assert_eq!(
            collect_skill_names(&registry),
            BTreeSet::from(["plugin-a:alpha".to_string()])
        );

        write_enabled_plugin_settings(
            &workspace_dir.path().join(".claude/settings.json"),
            &[("plugin-a@acme", false)],
        );

        assert!(registry.refresh_plugin_skills_if_needed_with_context(
            Some(workspace_dir.path()),
            Some(home_dir.path())
        ));
        assert!(registry.find("plugin-a:alpha").is_none());
        assert!(registry.is_empty());
    }
}
