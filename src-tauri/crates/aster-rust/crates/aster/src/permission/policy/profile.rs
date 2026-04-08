//! Profile 预设配置模块
//!
//! 本模块实现 Profile 管理，支持：
//! - 内置 Profile 预设（minimal, coding, messaging, full）
//! - 自定义 Profile 加载
//! - Profile 切换
//! - 配置持久化
//!
//! # Requirements
//!
//! - 1.1: 支持五种内置 profiles
//! - 1.2: minimal profile 仅允许状态查询
//! - 1.3: coding profile 允许文件操作和执行
//! - 1.4: messaging profile 允许会话管理
//! - 1.5: full profile 允许所有工具
//! - 1.6: custom profile 加载用户配置
//! - 1.7: 运行时切换 Profile
//! - 1.8: 持久化 Profile 选择
//! - 4.1: JSON 格式存储
//! - 4.2: 从配置目录加载
//! - 4.3: 保存到配置目录
//! - 4.5: 导出当前策略
//! - 4.6: 导入外部配置

use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use super::types::{PolicyError, PolicyLayer, ToolPolicy, ToolProfile};

/// Profile 配置文件格式
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileConfig {
    /// 配置版本
    pub version: String,
    /// Profile 名称
    pub name: String,
    /// 策略定义
    pub policy: ToolPolicy,
}

impl ProfileConfig {
    /// 创建新的配置
    pub fn new(name: impl Into<String>, policy: ToolPolicy) -> Self {
        Self {
            version: "1.0.0".to_string(),
            name: name.into(),
            policy,
        }
    }
}

/// Profile 管理器
///
/// 管理 Profile 预设配置的加载和切换
#[derive(Debug, Clone)]
pub struct ProfileManager {
    /// 当前 Profile
    current_profile: ToolProfile,
    /// 配置目录
    config_dir: Option<PathBuf>,
}

impl Default for ProfileManager {
    fn default() -> Self {
        Self {
            current_profile: ToolProfile::Minimal,
            config_dir: None,
        }
    }
}

impl ProfileManager {
    /// 创建新的 Profile 管理器
    pub fn new() -> Self {
        Self::default()
    }

    /// 创建带配置目录的管理器
    pub fn with_config_dir(config_dir: PathBuf) -> Self {
        Self {
            current_profile: ToolProfile::Minimal,
            config_dir: Some(config_dir),
        }
    }

    /// 创建指定 Profile 的管理器
    pub fn with_profile(profile: ToolProfile) -> Self {
        Self {
            current_profile: profile,
            config_dir: None,
        }
    }

    /// 设置配置目录
    pub fn set_config_dir(&mut self, config_dir: PathBuf) {
        self.config_dir = Some(config_dir);
    }

    /// 获取配置目录
    pub fn config_dir(&self) -> Option<&PathBuf> {
        self.config_dir.as_ref()
    }

    /// 获取当前 Profile
    pub fn current_profile(&self) -> &ToolProfile {
        &self.current_profile
    }

    /// 设置当前 Profile
    ///
    /// # Requirements
    ///
    /// - 1.7: 运行时切换 Profile
    pub fn set_profile(&mut self, profile: ToolProfile) {
        self.current_profile = profile;
    }

    /// 获取 Profile 对应的默认策略
    ///
    /// # Arguments
    ///
    /// * `profile` - Profile 类型
    ///
    /// # Returns
    ///
    /// 对应的 ToolPolicy
    pub fn get_profile_policy(&self, profile: &ToolProfile) -> Result<ToolPolicy, PolicyError> {
        match profile {
            ToolProfile::Minimal => Ok(Self::minimal_policy()),
            ToolProfile::Coding => Ok(Self::coding_policy()),
            ToolProfile::Messaging => Ok(Self::messaging_policy()),
            ToolProfile::Full => Ok(Self::full_policy()),
            ToolProfile::Custom(name) => self.load_custom_profile(name),
        }
    }

    /// 获取当前 Profile 的策略
    pub fn current_policy(&self) -> Result<ToolPolicy, PolicyError> {
        self.get_profile_policy(&self.current_profile)
    }

    /// 最小权限策略
    ///
    /// 仅允许状态查询工具
    ///
    /// # Requirements
    ///
    /// - 1.2: minimal profile 仅允许状态查询
    pub fn minimal_policy() -> ToolPolicy {
        ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["session_status".to_string()])
            .with_description("Minimal profile: only status query tools allowed")
    }

    /// 编码模式策略
    ///
    /// 允许文件操作和运行时执行
    ///
    /// # Requirements
    ///
    /// - 1.3: coding profile 允许文件操作和执行
    pub fn coding_policy() -> ToolPolicy {
        ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec![
                "group:fs".to_string(),
                "group:runtime".to_string(),
                "group:session".to_string(),
            ])
            .with_description("Coding profile: file system and runtime operations allowed")
    }

    /// 消息模式策略
    ///
    /// 允许会话管理工具
    ///
    /// # Requirements
    ///
    /// - 1.4: messaging profile 允许会话管理
    pub fn messaging_policy() -> ToolPolicy {
        ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec![
                "group:session".to_string(),
                "group:memory".to_string(),
            ])
            .with_description("Messaging profile: session management tools allowed")
    }

    /// 完整权限策略
    ///
    /// 允许所有工具
    ///
    /// # Requirements
    ///
    /// - 1.5: full profile 允许所有工具
    pub fn full_policy() -> ToolPolicy {
        ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["*".to_string()])
            .with_description("Full profile: all tools allowed")
    }

    /// 加载自定义 Profile
    ///
    /// # Arguments
    ///
    /// * `name` - 自定义 Profile 名称
    ///
    /// # Returns
    ///
    /// 加载成功返回 ToolPolicy，失败返回 PolicyError
    ///
    /// # Requirements
    ///
    /// - 1.6: custom profile 加载用户配置
    pub fn load_custom_profile(&self, name: &str) -> Result<ToolPolicy, PolicyError> {
        if let Some(config_dir) = &self.config_dir {
            let path = config_dir.join(format!("{}.json", name));
            if path.exists() {
                let content = std::fs::read_to_string(&path)?;
                let config: ProfileConfig = serde_json::from_str(&content)?;
                return Ok(config.policy);
            }
        }
        // 返回空策略作为默认
        Ok(ToolPolicy::new(PolicyLayer::Profile)
            .with_description(format!("Custom profile: {}", name)))
    }

    /// 保存 Profile 配置
    ///
    /// # Arguments
    ///
    /// * `name` - Profile 名称
    /// * `policy` - 策略定义
    ///
    /// # Requirements
    ///
    /// - 4.3: 保存到配置目录
    pub fn save_profile(&self, name: &str, policy: &ToolPolicy) -> Result<(), PolicyError> {
        let config_dir = self
            .config_dir
            .as_ref()
            .ok_or_else(|| PolicyError::ConfigReadError("Config directory not set".to_string()))?;

        // 确保目录存在
        std::fs::create_dir_all(config_dir)?;

        let config = ProfileConfig::new(name, policy.clone());
        let json = serde_json::to_string_pretty(&config)?;
        let path = config_dir.join(format!("{}.json", name));
        std::fs::write(&path, json)?;

        Ok(())
    }

    /// 加载 Profile 配置
    ///
    /// # Arguments
    ///
    /// * `name` - Profile 名称
    ///
    /// # Requirements
    ///
    /// - 4.2: 从配置目录加载
    pub fn load_profile(&self, name: &str) -> Result<ProfileConfig, PolicyError> {
        let config_dir = self
            .config_dir
            .as_ref()
            .ok_or_else(|| PolicyError::ConfigReadError("Config directory not set".to_string()))?;

        let path = config_dir.join(format!("{}.json", name));
        if !path.exists() {
            return Err(PolicyError::ProfileNotFound(name.to_string()));
        }

        let content = std::fs::read_to_string(&path)?;
        let config: ProfileConfig = serde_json::from_str(&content)?;
        Ok(config)
    }

    /// 导出当前策略为 Profile
    ///
    /// # Arguments
    ///
    /// * `name` - 导出的 Profile 名称
    ///
    /// # Requirements
    ///
    /// - 4.5: 导出当前策略
    pub fn export_as_profile(&self, name: &str) -> Result<ProfileConfig, PolicyError> {
        let policy = self.current_policy()?;
        Ok(ProfileConfig::new(name, policy))
    }

    /// 导入外部配置
    ///
    /// # Arguments
    ///
    /// * `json` - JSON 格式的配置字符串
    ///
    /// # Requirements
    ///
    /// - 4.6: 导入外部配置
    pub fn import_profile(json: &str) -> Result<ProfileConfig, PolicyError> {
        let config: ProfileConfig = serde_json::from_str(json)?;
        Ok(config)
    }

    /// 列出所有已保存的 Profile
    pub fn list_profiles(&self) -> Result<Vec<String>, PolicyError> {
        let config_dir = self
            .config_dir
            .as_ref()
            .ok_or_else(|| PolicyError::ConfigReadError("Config directory not set".to_string()))?;

        if !config_dir.exists() {
            return Ok(Vec::new());
        }

        let mut profiles = Vec::new();
        for entry in std::fs::read_dir(config_dir)? {
            let entry = entry?;
            let path = entry.path();
            if path.extension().is_some_and(|ext| ext == "json") {
                if let Some(name) = path.file_stem() {
                    profiles.push(name.to_string_lossy().to_string());
                }
            }
        }
        Ok(profiles)
    }
}

// =============================================================================
// 单元测试
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_profile_manager_default() {
        let manager = ProfileManager::new();
        assert_eq!(manager.current_profile(), &ToolProfile::Minimal);
    }

    #[test]
    fn test_profile_manager_with_profile() {
        let manager = ProfileManager::with_profile(ToolProfile::Coding);
        assert_eq!(manager.current_profile(), &ToolProfile::Coding);
    }

    #[test]
    fn test_set_profile() {
        let mut manager = ProfileManager::new();
        manager.set_profile(ToolProfile::Full);
        assert_eq!(manager.current_profile(), &ToolProfile::Full);
    }

    #[test]
    fn test_minimal_policy() {
        let policy = ProfileManager::minimal_policy();
        assert_eq!(policy.layer, PolicyLayer::Profile);
        assert!(policy.allow.contains(&"session_status".to_string()));
        assert_eq!(policy.allow.len(), 1);
    }

    #[test]
    fn test_coding_policy() {
        let policy = ProfileManager::coding_policy();
        assert_eq!(policy.layer, PolicyLayer::Profile);
        assert!(policy.allow.contains(&"group:fs".to_string()));
        assert!(policy.allow.contains(&"group:runtime".to_string()));
        assert!(policy.allow.contains(&"group:session".to_string()));
    }

    #[test]
    fn test_messaging_policy() {
        let policy = ProfileManager::messaging_policy();
        assert_eq!(policy.layer, PolicyLayer::Profile);
        assert!(policy.allow.contains(&"group:session".to_string()));
        assert!(policy.allow.contains(&"group:memory".to_string()));
    }

    #[test]
    fn test_full_policy() {
        let policy = ProfileManager::full_policy();
        assert_eq!(policy.layer, PolicyLayer::Profile);
        assert!(policy.allow.contains(&"*".to_string()));
    }

    #[test]
    fn test_get_profile_policy() {
        let manager = ProfileManager::new();

        let minimal = manager.get_profile_policy(&ToolProfile::Minimal).unwrap();
        assert!(minimal.allow.contains(&"session_status".to_string()));

        let coding = manager.get_profile_policy(&ToolProfile::Coding).unwrap();
        assert!(coding.allow.contains(&"group:fs".to_string()));

        let full = manager.get_profile_policy(&ToolProfile::Full).unwrap();
        assert!(full.allow.contains(&"*".to_string()));
    }

    #[test]
    fn test_current_policy() {
        let mut manager = ProfileManager::new();

        let policy = manager.current_policy().unwrap();
        assert!(policy.allow.contains(&"session_status".to_string()));

        manager.set_profile(ToolProfile::Full);
        let policy = manager.current_policy().unwrap();
        assert!(policy.allow.contains(&"*".to_string()));
    }

    #[test]
    fn test_custom_profile() {
        let manager = ProfileManager::new();
        let policy = manager
            .get_profile_policy(&ToolProfile::Custom("test".to_string()))
            .unwrap();
        assert!(policy.description.unwrap().contains("test"));
    }

    #[test]
    fn test_save_and_load_profile() {
        let temp_dir = tempfile::tempdir().unwrap();
        let manager = ProfileManager::with_config_dir(temp_dir.path().to_path_buf());

        let policy = ToolPolicy::new(PolicyLayer::Profile)
            .with_allow(vec!["bash".to_string()])
            .with_description("Test profile");

        // 保存
        manager.save_profile("test", &policy).unwrap();

        // 加载
        let loaded = manager.load_profile("test").unwrap();
        assert_eq!(loaded.name, "test");
        assert_eq!(loaded.policy.allow, policy.allow);
    }

    #[test]
    fn test_export_as_profile() {
        let manager = ProfileManager::with_profile(ToolProfile::Coding);
        let config = manager.export_as_profile("exported").unwrap();
        assert_eq!(config.name, "exported");
        assert!(config.policy.allow.contains(&"group:fs".to_string()));
    }

    #[test]
    fn test_import_profile() {
        let json = r#"{
            "version": "1.0.0",
            "name": "imported",
            "policy": {
                "layer": "Profile",
                "allow": ["bash"],
                "deny": [],
                "description": "Imported profile"
            }
        }"#;

        let config = ProfileManager::import_profile(json).unwrap();
        assert_eq!(config.name, "imported");
        assert!(config.policy.allow.contains(&"bash".to_string()));
    }

    #[test]
    fn test_list_profiles() {
        let temp_dir = tempfile::tempdir().unwrap();
        let manager = ProfileManager::with_config_dir(temp_dir.path().to_path_buf());

        let policy = ToolPolicy::new(PolicyLayer::Profile);
        manager.save_profile("profile1", &policy).unwrap();
        manager.save_profile("profile2", &policy).unwrap();

        let profiles = manager.list_profiles().unwrap();
        assert_eq!(profiles.len(), 2);
        assert!(profiles.contains(&"profile1".to_string()));
        assert!(profiles.contains(&"profile2".to_string()));
    }
}
