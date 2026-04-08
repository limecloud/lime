// Extension data management for sessions
// Provides a simple way to store extension-specific data with versioned keys

use crate::config::ExtensionConfig;
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, HashMap};
use utoipa::ToSchema;

/// Extension data containing all extension states
/// Keys are in format "extension_name.version" (e.g., "todo.v0")
#[derive(Debug, Clone, Serialize, Deserialize, Default, ToSchema)]
pub struct ExtensionData {
    #[serde(flatten)]
    pub extension_states: HashMap<String, Value>,
}

impl ExtensionData {
    /// Create a new empty ExtensionData
    pub fn new() -> Self {
        Self {
            extension_states: HashMap::new(),
        }
    }

    /// Get extension state for a specific extension and version
    pub fn get_extension_state(&self, extension_name: &str, version: &str) -> Option<&Value> {
        let key = format!("{}.{}", extension_name, version);
        self.extension_states.get(&key)
    }

    /// Set extension state for a specific extension and version
    pub fn set_extension_state(&mut self, extension_name: &str, version: &str, state: Value) {
        let key = format!("{}.{}", extension_name, version);
        self.extension_states.insert(key, state);
    }

    /// Remove extension state for a specific extension and version
    pub fn remove_extension_state(&mut self, extension_name: &str, version: &str) -> Option<Value> {
        let key = format!("{}.{}", extension_name, version);
        self.extension_states.remove(&key)
    }
}

/// Helper trait for extension-specific state management
pub trait ExtensionState: Sized + Serialize + for<'de> Deserialize<'de> {
    /// The name of the extension
    const EXTENSION_NAME: &'static str;

    /// The version of the extension state format
    const VERSION: &'static str;

    /// Convert from JSON value
    fn from_value(value: &Value) -> Result<Self> {
        serde_json::from_value(value.clone()).map_err(|e| {
            anyhow::anyhow!(
                "Failed to deserialize {} state: {}",
                Self::EXTENSION_NAME,
                e
            )
        })
    }

    /// Convert to JSON value
    fn to_value(&self) -> Result<Value> {
        serde_json::to_value(self).map_err(|e| {
            anyhow::anyhow!("Failed to serialize {} state: {}", Self::EXTENSION_NAME, e)
        })
    }

    /// Get state from extension data
    fn from_extension_data(extension_data: &ExtensionData) -> Option<Self> {
        extension_data
            .get_extension_state(Self::EXTENSION_NAME, Self::VERSION)
            .and_then(|v| Self::from_value(v).ok())
    }

    /// Save state to extension data
    fn to_extension_data(&self, extension_data: &mut ExtensionData) -> Result<()> {
        let value = self.to_value()?;
        extension_data.set_extension_state(Self::EXTENSION_NAME, Self::VERSION, value);
        Ok(())
    }
}

/// Legacy markdown TODO compat state.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct TodoState {
    pub content: String,
}

impl ExtensionState for TodoState {
    const EXTENSION_NAME: &'static str = "todo";
    const VERSION: &'static str = "v0";
}

impl TodoState {
    /// Create a new legacy TODO state.
    pub(crate) fn new(content: String) -> Self {
        Self { content }
    }
}

/// 结构化 TODO 条目状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub(crate) enum TodoListItemStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
}

impl TodoListItemStatus {
    fn marker(&self) -> &'static str {
        match self {
            Self::Pending => "[ ]",
            Self::InProgress => "[-]",
            Self::Completed => "[x]",
        }
    }

    fn to_task_board_status(&self) -> TaskBoardItemStatus {
        match self {
            Self::Pending => TaskBoardItemStatus::Pending,
            Self::InProgress => TaskBoardItemStatus::InProgress,
            Self::Completed => TaskBoardItemStatus::Completed,
        }
    }
}

/// 结构化 TODO 条目
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct TodoListItem {
    pub content: String,
    pub status: TodoListItemStatus,
    pub active_form: String,
}

/// 结构化 TODO 清单状态
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub(crate) struct TodoListState {
    #[serde(default)]
    pub items: Vec<TodoListItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rendered_markdown: Option<String>,
}

impl ExtensionState for TodoListState {
    const EXTENSION_NAME: &'static str = "todo";
    const VERSION: &'static str = "v1";
}

impl TodoListState {
    pub(crate) fn new(items: Vec<TodoListItem>) -> Self {
        let rendered_markdown = Some(Self::render_items(&items));
        Self {
            items,
            rendered_markdown,
        }
    }

    pub(crate) fn from_markdown(content: impl Into<String>) -> Self {
        let rendered_markdown = content.into();
        let items = Self::parse_items(&rendered_markdown);
        Self {
            items,
            rendered_markdown: Some(rendered_markdown),
        }
    }

    pub(crate) fn markdown(&self) -> String {
        self.rendered_markdown
            .clone()
            .unwrap_or_else(|| Self::render_items(&self.items))
    }

    fn render_items(items: &[TodoListItem]) -> String {
        items
            .iter()
            .map(|item| format!("- {} {}", item.status.marker(), item.content))
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn parse_items(content: &str) -> Vec<TodoListItem> {
        content
            .lines()
            .filter_map(|line| {
                let trimmed = line.trim_start();
                let rest = trimmed
                    .strip_prefix("- ")
                    .or_else(|| trimmed.strip_prefix("* "))
                    .or_else(|| trimmed.strip_prefix("+ "))?;

                let (status, content) = if let Some(content) = rest.strip_prefix("[ ] ") {
                    (TodoListItemStatus::Pending, content)
                } else if let Some(content) = rest.strip_prefix("[-] ") {
                    (TodoListItemStatus::InProgress, content)
                } else if let Some(content) = rest.strip_prefix("[~] ") {
                    (TodoListItemStatus::InProgress, content)
                } else if let Some(content) = rest.strip_prefix("[x] ") {
                    (TodoListItemStatus::Completed, content)
                } else if let Some(content) = rest.strip_prefix("[X] ") {
                    (TodoListItemStatus::Completed, content)
                } else {
                    return None;
                };

                let content = content.trim().to_string();
                if content.is_empty() {
                    return None;
                }

                Some(TodoListItem {
                    active_form: content.clone(),
                    content,
                    status,
                })
            })
            .collect()
    }
}

/// 任务板条目状态
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "snake_case")]
pub enum TaskBoardItemStatus {
    #[default]
    Pending,
    InProgress,
    Completed,
}

impl TaskBoardItemStatus {
    fn to_todo_status(&self) -> TodoListItemStatus {
        match self {
            Self::Pending => TodoListItemStatus::Pending,
            Self::InProgress => TodoListItemStatus::InProgress,
            Self::Completed => TodoListItemStatus::Completed,
        }
    }
}

/// 结构化任务板条目
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardItem {
    pub id: String,
    pub subject: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub active_form: Option<String>,
    #[serde(default)]
    pub status: TaskBoardItemStatus,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub owner: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocks: Vec<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub blocked_by: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub metadata: Option<BTreeMap<String, Value>>,
}

/// 结构化任务板状态
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TaskBoardState {
    #[serde(default)]
    pub items: Vec<TaskBoardItem>,
    #[serde(default = "default_task_board_next_id")]
    pub next_id: u64,
}

fn default_task_board_next_id() -> u64 {
    1
}

impl ExtensionState for TaskBoardState {
    const EXTENSION_NAME: &'static str = "task_list";
    const VERSION: &'static str = "v1";
}

impl TaskBoardState {
    pub fn new(items: Vec<TaskBoardItem>) -> Self {
        Self::with_next_id(items, 1)
    }

    pub fn with_next_id(items: Vec<TaskBoardItem>, next_id: u64) -> Self {
        let computed_next_id = Self::compute_next_id(&items, next_id);
        Self {
            items,
            next_id: computed_next_id,
        }
    }

    pub fn allocate_id(&mut self) -> String {
        let id = self.next_id.max(1);
        self.next_id = id.saturating_add(1);
        id.to_string()
    }

    pub(crate) fn to_todo_list_state(&self) -> TodoListState {
        TodoListState::new(
            self.items
                .iter()
                .map(|item| TodoListItem {
                    content: item.subject.clone(),
                    active_form: item
                        .active_form
                        .clone()
                        .unwrap_or_else(|| item.subject.clone()),
                    status: item.status.to_todo_status(),
                })
                .collect(),
        )
    }

    fn compute_next_id(items: &[TaskBoardItem], suggested_next_id: u64) -> u64 {
        let max_existing_id = items
            .iter()
            .filter_map(|item| item.id.parse::<u64>().ok())
            .max()
            .unwrap_or(0);
        suggested_next_id
            .max(max_existing_id.saturating_add(1))
            .max(1)
    }
}

impl TodoListState {
    pub(crate) fn to_task_board_state(&self) -> TaskBoardState {
        let items = self
            .items
            .iter()
            .enumerate()
            .map(|(index, item)| {
                let subject = item.content.trim().to_string();
                let active_form = item.active_form.trim();
                TaskBoardItem {
                    id: (index + 1).to_string(),
                    subject: subject.clone(),
                    description: String::new(),
                    active_form: if active_form.is_empty() || active_form == subject {
                        None
                    } else {
                        Some(active_form.to_string())
                    },
                    status: item.status.to_task_board_status(),
                    owner: None,
                    blocks: Vec::new(),
                    blocked_by: Vec::new(),
                    metadata: None,
                }
            })
            .collect::<Vec<_>>();

        let next_id = items.len().saturating_add(1) as u64;
        TaskBoardState::with_next_id(items, next_id)
    }
}

/// crate 内部兼容读取旧 todo snapshot，优先从 current task board 派生。
pub(crate) fn resolve_todo_list_state(extension_data: &ExtensionData) -> Option<TodoListState> {
    TaskBoardState::from_extension_data(extension_data)
        .map(|state| state.to_todo_list_state())
        .or_else(|| TodoListState::from_extension_data(extension_data))
        .or_else(|| {
            TodoState::from_extension_data(extension_data)
                .map(|state| TodoListState::from_markdown(state.content))
        })
}

/// crate 内部兼容导出旧 todo markdown，避免继续暴露旧 surface。
pub(crate) fn resolve_todo_markdown(extension_data: &ExtensionData) -> Option<String> {
    resolve_todo_list_state(extension_data)
        .map(|state| state.markdown())
        .filter(|content| !content.trim().is_empty())
}

fn clear_legacy_todo_state(extension_data: &mut ExtensionData) {
    extension_data.remove_extension_state(TodoState::EXTENSION_NAME, TodoState::VERSION);
}

/// crate 内部兼容写入旧 todo snapshot，并在写入后清掉 markdown 旧影子。
pub(crate) fn persist_todo_list_state(
    extension_data: &mut ExtensionData,
    todo_list_state: TodoListState,
) -> Result<()> {
    todo_list_state.to_extension_data(extension_data)?;
    clear_legacy_todo_state(extension_data);
    Ok(())
}

/// Resolve the current structured task board state.
/// 读取优先级为 task_list.v1 -> todo.v1 -> todo.v0，统一向 task board 语义收敛。
pub fn resolve_task_board_state(extension_data: &ExtensionData) -> Option<TaskBoardState> {
    TaskBoardState::from_extension_data(extension_data)
        .or_else(|| {
            TodoListState::from_extension_data(extension_data)
                .map(|state| state.to_task_board_state())
        })
        .or_else(|| {
            TodoState::from_extension_data(extension_data)
                .map(|state| TodoListState::from_markdown(state.content).to_task_board_state())
        })
}

/// Persist structured task board state and update the derived todo snapshot.
pub fn persist_task_board_state(
    extension_data: &mut ExtensionData,
    task_board_state: TaskBoardState,
) -> Result<()> {
    task_board_state.to_extension_data(extension_data)?;
    task_board_state
        .to_todo_list_state()
        .to_extension_data(extension_data)?;
    clear_legacy_todo_state(extension_data);
    Ok(())
}

/// crate 内部兼容入口：把 markdown todo 写入统一的 task/todo 快照边界。
pub(crate) fn persist_todo_markdown(
    extension_data: &mut ExtensionData,
    content: impl Into<String>,
) -> Result<()> {
    persist_todo_list_state(extension_data, TodoListState::from_markdown(content))
}

/// Enabled extensions state implementation for storing which extensions are active
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EnabledExtensionsState {
    pub extensions: Vec<ExtensionConfig>,
}

impl ExtensionState for EnabledExtensionsState {
    const EXTENSION_NAME: &'static str = "enabled_extensions";
    const VERSION: &'static str = "v0";
}

impl EnabledExtensionsState {
    pub fn new(extensions: Vec<ExtensionConfig>) -> Self {
        Self { extensions }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn test_extension_data_basic_operations() {
        let mut extension_data = ExtensionData::new();

        // Test setting and getting extension state
        let todo_state = json!({"content": "- Task 1\n- Task 2"});
        extension_data.set_extension_state("todo", "v0", todo_state.clone());

        assert_eq!(
            extension_data.get_extension_state("todo", "v0"),
            Some(&todo_state)
        );
        assert_eq!(extension_data.get_extension_state("todo", "v1"), None);
    }

    #[test]
    fn test_multiple_extension_states() {
        let mut extension_data = ExtensionData::new();

        // Add multiple extension states
        extension_data.set_extension_state("todo", "v0", json!("TODO content"));
        extension_data.set_extension_state("memory", "v1", json!({"items": ["item1", "item2"]}));
        extension_data.set_extension_state("config", "v2", json!({"setting": true}));

        // Check all states exist
        assert_eq!(extension_data.extension_states.len(), 3);
        assert!(extension_data.get_extension_state("todo", "v0").is_some());
        assert!(extension_data.get_extension_state("memory", "v1").is_some());
        assert!(extension_data.get_extension_state("config", "v2").is_some());
    }

    #[test]
    fn test_todo_state_trait() {
        let mut extension_data = ExtensionData::new();

        // Create and save TODO state
        let todo = TodoState::new("- Task 1\n- Task 2".to_string());
        todo.to_extension_data(&mut extension_data).unwrap();

        // Retrieve TODO state
        let retrieved = TodoState::from_extension_data(&extension_data);
        assert!(retrieved.is_some());
        assert_eq!(retrieved.unwrap().content, "- Task 1\n- Task 2");
    }

    #[test]
    fn test_todo_list_state_roundtrip() {
        let mut extension_data = ExtensionData::new();
        let todo_list = TodoListState::new(vec![
            TodoListItem {
                content: "Run tests".to_string(),
                status: TodoListItemStatus::Pending,
                active_form: "Running tests".to_string(),
            },
            TodoListItem {
                content: "Ship patch".to_string(),
                status: TodoListItemStatus::InProgress,
                active_form: "Shipping patch".to_string(),
            },
        ]);

        todo_list.to_extension_data(&mut extension_data).unwrap();

        let retrieved = TodoListState::from_extension_data(&extension_data).unwrap();
        assert_eq!(retrieved.items.len(), 2);
        assert_eq!(retrieved.markdown(), "- [ ] Run tests\n- [-] Ship patch");
    }

    #[test]
    fn test_task_board_state_roundtrip() {
        let mut extension_data = ExtensionData::new();
        let task_board = TaskBoardState::with_next_id(
            vec![TaskBoardItem {
                id: "1".to_string(),
                subject: "整理运行时边界".to_string(),
                description: "把任务板能力切换到新版 Task* 工具".to_string(),
                active_form: Some("整理运行时边界中".to_string()),
                status: TaskBoardItemStatus::InProgress,
                owner: Some("leader".to_string()),
                blocks: vec!["2".to_string()],
                blocked_by: Vec::new(),
                metadata: Some(BTreeMap::from([("source".to_string(), json!("migration"))])),
            }],
            4,
        );

        task_board.to_extension_data(&mut extension_data).unwrap();

        let retrieved = TaskBoardState::from_extension_data(&extension_data).unwrap();
        assert_eq!(retrieved.items.len(), 1);
        assert_eq!(retrieved.next_id, 4);
        assert_eq!(retrieved.items[0].subject, "整理运行时边界");
        assert_eq!(retrieved.items[0].status, TaskBoardItemStatus::InProgress);
    }

    #[test]
    fn test_resolve_task_board_state_falls_back_to_todo_list_state() {
        let mut extension_data = ExtensionData::new();
        TodoListState::new(vec![TodoListItem {
            content: "旧 todo".to_string(),
            status: TodoListItemStatus::InProgress,
            active_form: "旧 todo 处理中".to_string(),
        }])
        .to_extension_data(&mut extension_data)
        .unwrap();

        let resolved = resolve_task_board_state(&extension_data).unwrap();
        assert_eq!(resolved.next_id, 2);
        assert_eq!(resolved.items.len(), 1);
        assert_eq!(resolved.items[0].id, "1");
        assert_eq!(resolved.items[0].subject, "旧 todo");
        assert_eq!(resolved.items[0].status, TaskBoardItemStatus::InProgress);
        assert_eq!(
            resolved.items[0].active_form.as_deref(),
            Some("旧 todo 处理中")
        );
    }

    #[test]
    fn test_resolve_task_board_state_falls_back_to_legacy_todo_markdown() {
        let mut extension_data = ExtensionData::new();
        TodoState::new("- [x] Legacy".to_string())
            .to_extension_data(&mut extension_data)
            .unwrap();

        let resolved = resolve_task_board_state(&extension_data).unwrap();
        assert_eq!(resolved.next_id, 2);
        assert_eq!(resolved.items.len(), 1);
        assert_eq!(resolved.items[0].id, "1");
        assert_eq!(resolved.items[0].subject, "Legacy");
        assert_eq!(resolved.items[0].status, TaskBoardItemStatus::Completed);
        assert_eq!(resolved.items[0].active_form, None);
    }

    #[test]
    fn test_todo_list_state_from_markdown_preserves_content() {
        let state = TodoListState::from_markdown(
            "- [ ] Requirement 1\nSome free-form note\n- [x] Requirement 2",
        );

        assert_eq!(state.items.len(), 2);
        assert_eq!(state.items[0].status, TodoListItemStatus::Pending);
        assert_eq!(state.items[1].status, TodoListItemStatus::Completed);
        assert_eq!(
            state.markdown(),
            "- [ ] Requirement 1\nSome free-form note\n- [x] Requirement 2"
        );
    }

    #[test]
    fn test_resolve_todo_list_state_falls_back_to_legacy_state() {
        let mut extension_data = ExtensionData::new();
        TodoState::new("- [ ] Legacy".to_string())
            .to_extension_data(&mut extension_data)
            .unwrap();

        let resolved = resolve_todo_list_state(&extension_data).unwrap();
        assert_eq!(resolved.items.len(), 1);
        assert_eq!(resolved.markdown(), "- [ ] Legacy");
    }

    #[test]
    fn test_resolve_todo_list_state_prefers_task_board_state() {
        let mut extension_data = ExtensionData::new();
        TodoListState::new(vec![TodoListItem {
            content: "旧 todo".to_string(),
            status: TodoListItemStatus::Pending,
            active_form: "旧 todo".to_string(),
        }])
        .to_extension_data(&mut extension_data)
        .unwrap();
        TaskBoardState::new(vec![TaskBoardItem {
            id: "1".to_string(),
            subject: "新版任务".to_string(),
            description: "以任务板状态为准".to_string(),
            active_form: Some("处理中".to_string()),
            status: TaskBoardItemStatus::Completed,
            owner: None,
            blocks: Vec::new(),
            blocked_by: Vec::new(),
            metadata: None,
        }])
        .to_extension_data(&mut extension_data)
        .unwrap();

        let resolved = resolve_todo_list_state(&extension_data).unwrap();
        assert_eq!(resolved.markdown(), "- [x] 新版任务");
    }

    #[test]
    fn test_persist_todo_markdown_writes_structured_state_only() {
        let mut extension_data = ExtensionData::new();
        persist_todo_markdown(&mut extension_data, "- [ ] Run tests").unwrap();

        let resolved = resolve_todo_list_state(&extension_data).unwrap();
        assert_eq!(resolved.markdown(), "- [ ] Run tests");
        assert_eq!(
            TodoState::from_extension_data(&extension_data).map(|state| state.content),
            None
        );
    }

    #[test]
    fn test_persist_todo_markdown_clears_legacy_compat_state() {
        let mut extension_data = ExtensionData::new();
        TodoState::new("- [ ] Legacy".to_string())
            .to_extension_data(&mut extension_data)
            .unwrap();

        persist_todo_markdown(&mut extension_data, "- [ ] Run tests").unwrap();

        assert!(extension_data.get_extension_state("todo", "v1").is_some());
        assert!(extension_data.get_extension_state("todo", "v0").is_none());
    }

    #[test]
    fn test_persist_task_board_state_updates_task_board_and_todo_snapshot() {
        let mut extension_data = ExtensionData::new();
        persist_task_board_state(
            &mut extension_data,
            TaskBoardState::with_next_id(
                vec![TaskBoardItem {
                    id: "7".to_string(),
                    subject: "切换到 TaskUpdate".to_string(),
                    description: "替换 TodoWrite".to_string(),
                    active_form: None,
                    status: TaskBoardItemStatus::Pending,
                    owner: None,
                    blocks: Vec::new(),
                    blocked_by: Vec::new(),
                    metadata: None,
                }],
                8,
            ),
        )
        .unwrap();

        let task_board = resolve_task_board_state(&extension_data).unwrap();
        assert_eq!(task_board.next_id, 8);
        assert_eq!(task_board.items[0].id, "7");

        let todo_snapshot = resolve_todo_list_state(&extension_data).unwrap();
        assert_eq!(todo_snapshot.markdown(), "- [ ] 切换到 TaskUpdate");
        assert!(extension_data
            .get_extension_state("task_list", "v1")
            .is_some());
        assert!(extension_data.get_extension_state("todo", "v1").is_some());
    }

    #[test]
    fn test_remove_extension_state() {
        let mut extension_data = ExtensionData::new();
        extension_data.set_extension_state("todo", "v1", json!({"items": []}));

        assert!(extension_data
            .remove_extension_state("todo", "v1")
            .is_some());
        assert!(extension_data.get_extension_state("todo", "v1").is_none());
    }

    #[test]
    fn test_extension_data_serialization() {
        let mut extension_data = ExtensionData::new();
        extension_data.set_extension_state("todo", "v0", json!("TODO content"));
        extension_data.set_extension_state("memory", "v1", json!({"key": "value"}));

        // Serialize to JSON
        let json = serde_json::to_value(&extension_data).unwrap();

        // Check the structure
        assert!(json.is_object());
        assert_eq!(json.get("todo.v0"), Some(&json!("TODO content")));
        assert_eq!(json.get("memory.v1"), Some(&json!({"key": "value"})));

        // Deserialize back
        let deserialized: ExtensionData = serde_json::from_value(json).unwrap();
        assert_eq!(
            deserialized.get_extension_state("todo", "v0"),
            Some(&json!("TODO content"))
        );
        assert_eq!(
            deserialized.get_extension_state("memory", "v1"),
            Some(&json!({"key": "value"}))
        );
    }
}
