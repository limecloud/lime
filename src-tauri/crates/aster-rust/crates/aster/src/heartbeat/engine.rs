//! 心跳引擎实现
//!
//! 定期解析并执行 HEARTBEAT.md 中定义的任务

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tokio::time::interval;
use tracing::{debug, error, info, warn};

/// 心跳配置
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HeartbeatConfig {
    /// 是否启用心跳引擎
    #[serde(default = "default_enabled")]
    pub enabled: bool,
    /// 心跳间隔（最小 5 分钟）
    #[serde(
        default = "default_interval",
        serialize_with = "serialize_duration",
        deserialize_with = "deserialize_duration"
    )]
    pub interval: Duration,
    /// 心跳任务文件路径（相对于 workspace_dir）
    #[serde(default = "default_task_file")]
    pub task_file: PathBuf,
}

fn default_enabled() -> bool {
    true
}

fn default_interval() -> Duration {
    Duration::from_secs(5 * 60) // 5 分钟
}

fn default_task_file() -> PathBuf {
    PathBuf::from("HEARTBEAT.md")
}

fn serialize_duration<S>(duration: &Duration, serializer: S) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    serializer.serialize_u64(duration.as_secs())
}

fn deserialize_duration<'de, D>(deserializer: D) -> Result<Duration, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let secs = u64::deserialize(deserializer)?;
    Ok(Duration::from_secs(secs))
}

impl Default for HeartbeatConfig {
    fn default() -> Self {
        Self {
            enabled: default_enabled(),
            interval: default_interval(),
            task_file: default_task_file(),
        }
    }
}

/// 心跳任务
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HeartbeatTask {
    /// 任务描述
    pub description: String,
    /// 优先级（1-10，数字越大优先级越高）
    #[serde(default)]
    pub priority: Option<u8>,
    /// 超时时间（秒）
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_optional_duration",
        deserialize_with = "deserialize_optional_duration"
    )]
    pub timeout: Option<Duration>,
}

fn serialize_optional_duration<S>(
    duration: &Option<Duration>,
    serializer: S,
) -> Result<S::Ok, S::Error>
where
    S: serde::Serializer,
{
    match duration {
        Some(d) => serializer.serialize_some(&d.as_secs()),
        None => serializer.serialize_none(),
    }
}

fn deserialize_optional_duration<'de, D>(deserializer: D) -> Result<Option<Duration>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<u64> = Option::deserialize(deserializer)?;
    Ok(opt.map(Duration::from_secs))
}

/// 心跳引擎
pub struct HeartbeatEngine {
    config: HeartbeatConfig,
    workspace_dir: PathBuf,
}

impl HeartbeatEngine {
    /// 创建新的心跳引擎
    pub fn new(config: HeartbeatConfig, workspace_dir: PathBuf) -> Self {
        Self {
            config,
            workspace_dir,
        }
    }

    /// 获取心跳任务文件的完整路径
    fn task_file_path(&self) -> PathBuf {
        self.workspace_dir.join(&self.config.task_file)
    }

    /// 从 HEARTBEAT.md 文件中收集任务
    pub fn collect_tasks(&self) -> Result<Vec<HeartbeatTask>> {
        let task_file = self.task_file_path();

        if !task_file.exists() {
            debug!("心跳任务文件不存在: {:?}", task_file);
            return Ok(Vec::new());
        }

        let content = std::fs::read_to_string(&task_file)
            .with_context(|| format!("无法读取心跳任务文件: {:?}", task_file))?;

        self.parse_tasks(&content)
    }

    /// 解析任务内容
    fn parse_tasks(&self, content: &str) -> Result<Vec<HeartbeatTask>> {
        let mut tasks = Vec::new();
        let mut current_task: Option<String> = None;
        let mut current_priority: Option<u8> = None;
        let mut current_timeout: Option<Duration> = None;

        for line in content.lines() {
            let trimmed = line.trim();

            // 跳过空行和注释
            if trimmed.is_empty() || trimmed.starts_with("<!--") {
                continue;
            }

            // 检查是否是任务项（以 - 或 * 开头）
            if let Some(task_text) = trimmed
                .strip_prefix("- ")
                .or_else(|| trimmed.strip_prefix("* "))
            {
                // 保存上一个任务
                if let Some(desc) = current_task.take() {
                    tasks.push(HeartbeatTask {
                        description: desc,
                        priority: current_priority.take(),
                        timeout: current_timeout.take(),
                    });
                }

                // 解析新任务
                let (desc, priority, timeout) = Self::parse_task_line(task_text);
                current_task = Some(desc);
                current_priority = priority;
                current_timeout = timeout;
            }
        }

        // 保存最后一个任务
        if let Some(desc) = current_task {
            tasks.push(HeartbeatTask {
                description: desc,
                priority: current_priority,
                timeout: current_timeout,
            });
        }

        // 按优先级排序（高优先级在前）
        tasks.sort_by(|a, b| b.priority.unwrap_or(5).cmp(&a.priority.unwrap_or(5)));

        Ok(tasks)
    }

    /// 解析任务行，提取描述、优先级和超时
    #[allow(clippy::string_slice)] // 索引来自 find()，模式均为 ASCII，字节偏移安全
    fn parse_task_line(line: &str) -> (String, Option<u8>, Option<Duration>) {
        let mut description = line.to_string();
        let mut priority = None;
        let mut timeout = None;

        // 提取优先级 [priority:N]
        if let Some(start) = line.find("[priority:") {
            if let Some(end) = line[start..].find(']') {
                let priority_str = &line[start + 10..start + end];
                if let Ok(p) = priority_str.trim().parse::<u8>() {
                    priority = Some(p.clamp(1, 10));
                    description = format!("{}{}", &line[..start], &line[start + end + 1..])
                        .trim()
                        .to_string();
                }
            }
        }

        // 提取超时 [timeout:Ns]
        if let Some(start) = description.find("[timeout:") {
            if let Some(end) = description[start..].find(']') {
                let timeout_str = &description[start + 9..start + end];
                if let Some(secs_str) = timeout_str.strip_suffix('s') {
                    if let Ok(secs) = secs_str.trim().parse::<u64>() {
                        timeout = Some(Duration::from_secs(secs));
                        description = format!(
                            "{}{}",
                            &description[..start],
                            &description[start + end + 1..]
                        )
                        .trim()
                        .to_string();
                    }
                }
            }
        }

        (description, priority, timeout)
    }

    /// 执行单个任务
    async fn execute_task(&self, task: &HeartbeatTask) -> Result<()> {
        info!("执行心跳任务: {}", task.description);

        // TODO: 实际的任务执行逻辑
        // 这里可以集成 Agent 或其他执行机制

        Ok(())
    }

    /// 运行心跳引擎主循环
    pub async fn run(&self) -> Result<()> {
        if !self.config.enabled {
            info!("心跳引擎已禁用");
            return Ok(());
        }

        // 验证间隔时间（最小 5 分钟）
        let interval_duration = if self.config.interval < Duration::from_secs(5 * 60) {
            warn!("心跳间隔小于 5 分钟，使用默认值 5 分钟");
            Duration::from_secs(5 * 60)
        } else {
            self.config.interval
        };

        info!("心跳引擎启动，间隔: {:?}", interval_duration);

        let mut ticker = interval(interval_duration);

        loop {
            ticker.tick().await;

            debug!("心跳触发");

            match self.collect_tasks() {
                Ok(tasks) => {
                    if tasks.is_empty() {
                        debug!("没有待执行的心跳任务");
                        continue;
                    }

                    info!("收集到 {} 个心跳任务", tasks.len());

                    for task in tasks {
                        if let Err(e) = self.execute_task(&task).await {
                            error!("执行心跳任务失败: {} - {}", task.description, e);
                        }
                    }
                }
                Err(e) => {
                    error!("收集心跳任务失败: {}", e);
                }
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::tempdir;

    #[test]
    fn test_parse_simple_task() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "- 检查系统状态\n- 清理临时文件";
        let tasks = engine.parse_tasks(content).unwrap();

        assert_eq!(tasks.len(), 2);
        assert_eq!(tasks[0].description, "检查系统状态");
        assert_eq!(tasks[1].description, "清理临时文件");
    }

    #[test]
    fn test_parse_task_with_priority() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "- 低优先级任务 [priority:3]\n- 高优先级任务 [priority:8]";
        let tasks = engine.parse_tasks(content).unwrap();

        assert_eq!(tasks.len(), 2);
        // 应该按优先级排序，高优先级在前
        assert_eq!(tasks[0].description, "高优先级任务");
        assert_eq!(tasks[0].priority, Some(8));
        assert_eq!(tasks[1].description, "低优先级任务");
        assert_eq!(tasks[1].priority, Some(3));
    }

    #[test]
    fn test_parse_task_with_timeout() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "- 长时间任务 [timeout:300s]";
        let tasks = engine.parse_tasks(content).unwrap();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].description, "长时间任务");
        assert_eq!(tasks[0].timeout, Some(Duration::from_secs(300)));
    }

    #[test]
    fn test_parse_task_with_priority_and_timeout() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "- 复杂任务 [priority:7] [timeout:600s]";
        let tasks = engine.parse_tasks(content).unwrap();

        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].description, "复杂任务");
        assert_eq!(tasks[0].priority, Some(7));
        assert_eq!(tasks[0].timeout, Some(Duration::from_secs(600)));
    }

    #[test]
    fn test_collect_tasks_from_file() {
        let temp_dir = tempdir().unwrap();
        let workspace = temp_dir.path().to_path_buf();
        let heartbeat_file = workspace.join("HEARTBEAT.md");

        let content = r#"# 心跳任务

- 任务1 [priority:5]
- 任务2 [priority:8] [timeout:120s]
- 任务3
"#;
        fs::write(&heartbeat_file, content).unwrap();

        let config = HeartbeatConfig::default();
        let engine = HeartbeatEngine::new(config, workspace);

        let tasks = engine.collect_tasks().unwrap();
        assert_eq!(tasks.len(), 3);
        assert_eq!(tasks[0].description, "任务2");
        assert_eq!(tasks[0].priority, Some(8));
    }

    #[test]
    fn test_collect_tasks_no_file() {
        let temp_dir = tempdir().unwrap();
        let workspace = temp_dir.path().to_path_buf();

        let config = HeartbeatConfig::default();
        let engine = HeartbeatEngine::new(config, workspace);

        let tasks = engine.collect_tasks().unwrap();
        assert_eq!(tasks.len(), 0);
    }

    #[test]
    fn test_config_default_values() {
        let config = HeartbeatConfig::default();
        assert!(config.enabled);
        assert_eq!(config.interval, Duration::from_secs(5 * 60));
        assert_eq!(config.task_file, PathBuf::from("HEARTBEAT.md"));
    }

    #[test]
    fn test_priority_clamping() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "- 任务1 [priority:0]\n- 任务2 [priority:15]";
        let tasks = engine.parse_tasks(content).unwrap();

        assert_eq!(tasks.len(), 2);
        // 优先级应该被限制在 1-10 范围内
        assert!(tasks[0].priority.unwrap() >= 1 && tasks[0].priority.unwrap() <= 10);
        assert!(tasks[1].priority.unwrap() >= 1 && tasks[1].priority.unwrap() <= 10);
    }

    #[test]
    fn test_empty_content() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = "";
        let tasks = engine.parse_tasks(content).unwrap();
        assert_eq!(tasks.len(), 0);
    }

    #[test]
    fn test_comments_ignored() {
        let config = HeartbeatConfig::default();
        let workspace = PathBuf::from("/tmp");
        let engine = HeartbeatEngine::new(config, workspace);

        let content = r#"<!-- 这是注释 -->
- 任务1
<!-- 另一个注释 -->
- 任务2
"#;
        let tasks = engine.parse_tasks(content).unwrap();
        assert_eq!(tasks.len(), 2);
    }
}
