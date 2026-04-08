//! 工具钩子系统集成示例
//!
//! 展示如何在 aster-rust 工具执行流程中集成通用 workflow 与钩子系统

use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::sync::Arc;

use crate::tools::hooks::{HookContext, HookTrigger, ToolHookManager};
use crate::tools::{Tool, ToolContext, ToolError, ToolResult};

/// 工作流集成工具 - 演示如何在工具执行中使用钩子系统
#[derive(Clone)]
pub struct WorkflowIntegratedTool {
    name: String,
    description: String,
    hook_manager: Option<Arc<ToolHookManager>>,
}

impl Default for WorkflowIntegratedTool {
    fn default() -> Self {
        Self {
            name: "workflow_integrated_tool".to_string(),
            description: "Demonstrates workflow integration with hook system".to_string(),
            hook_manager: None,
        }
    }
}

impl WorkflowIntegratedTool {
    /// 创建带钩子管理器的工具实例
    pub fn with_hook_manager(mut self, hook_manager: Arc<ToolHookManager>) -> Self {
        self.hook_manager = Some(hook_manager);
        self
    }

    /// Pre-Action 阶段：执行前的上下文刷新和检查
    async fn pre_action(
        &self,
        context: &ToolContext,
        params: &serde_json::Value,
    ) -> Result<String, ToolError> {
        if let Some(hook_manager) = &self.hook_manager {
            let hook_context = HookContext::new(self.name.clone(), params.clone(), context.clone());

            // 触发 Pre-Execution 钩子
            hook_manager
                .trigger_hooks(HookTrigger::PreExecution, &hook_context)
                .await
                .map_err(|e| {
                    ToolError::execution_failed(format!("Pre-action hook failed: {}", e))
                })?;
        }

        // 模拟上下文刷新逻辑
        let context_info = format!(
            "🔄 Pre-Action 上下文刷新:\n\n工作目录: {:?}\n会话ID: {}\n用户: {}\n\n⚠️ 准备执行工具操作，请确认目标明确",
            context.working_directory,
            if context.session_id.is_empty() { "未知" } else { &context.session_id },
            context.user.as_deref().unwrap_or("未知")
        );

        Ok(context_info)
    }

    /// Post-Action 阶段：执行后的状态更新和学习
    async fn post_action(
        &self,
        context: &ToolContext,
        params: &serde_json::Value,
        result: &ToolResult,
        error: Option<&ToolError>,
    ) -> Result<String, ToolError> {
        if let Some(hook_manager) = &self.hook_manager {
            let mut hook_context =
                HookContext::new(self.name.clone(), params.clone(), context.clone())
                    .with_result(result.clone());

            if let Some(err) = error {
                hook_context = hook_context.with_error(err.to_string());

                // 触发错误钩子
                hook_manager
                    .trigger_hooks(HookTrigger::OnError, &hook_context)
                    .await
                    .map_err(|e| {
                        ToolError::execution_failed(format!("Error hook failed: {}", e))
                    })?;
            } else {
                // 触发 Post-Execution 钩子
                hook_manager
                    .trigger_hooks(HookTrigger::PostExecution, &hook_context)
                    .await
                    .map_err(|e| {
                        ToolError::execution_failed(format!("Post-action hook failed: {}", e))
                    })?;
            }
        }

        // 生成 Post-Action 消息
        let mut message = "📝 Post-Action 状态更新:\n\n".to_string();

        if let Some(err) = error {
            message.push_str(&format!("🚨 错误处理: {}\n", err));
            message.push_str("- 错误已记录到错误跟踪系统\n");
            message.push_str("- 建议检查输入参数和执行环境\n");
        } else {
            message.push_str("✅ 操作成功完成\n");
            message.push_str("- 结果已记录到进度日志\n");
        }

        message.push_str("\n💡 下一步建议:\n");
        message.push_str("- 如果完成了某个阶段，请更新任务计划\n");
        message.push_str("- 有重要发现请记录到 findings.md\n");
        message.push_str("- 继续下一个计划步骤\n");

        Ok(message)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WorkflowParams {
    pub action: String,
    pub description: String,
    pub simulate_error: Option<bool>,
}

#[async_trait]
impl Tool for WorkflowIntegratedTool {
    fn name(&self) -> &str {
        &self.name
    }

    fn description(&self) -> &str {
        &self.description
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "action": {
                    "type": "string",
                    "description": "Action to perform (e.g., 'analyze', 'process', 'generate')"
                },
                "description": {
                    "type": "string",
                    "description": "Detailed description of what to do"
                },
                "simulate_error": {
                    "type": "boolean",
                    "description": "Whether to simulate an error for testing (optional)"
                }
            },
            "required": ["action", "description"]
        })
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let params: WorkflowParams = serde_json::from_value(params.clone())
            .map_err(|e| ToolError::invalid_params(e.to_string()))?;

        // === Pre-Action 阶段 ===
        let pre_action_info = self
            .pre_action(context, &serde_json::to_value(&params).unwrap())
            .await?;

        // === Action 阶段 ===
        let mut result_content = format!("🔄 执行操作: {}\n\n", params.action);
        result_content.push_str(&format!("描述: {}\n\n", params.description));
        result_content.push_str(&format!("Pre-Action 信息:\n{}\n\n", pre_action_info));

        // 模拟实际工作
        let action_result = if params.simulate_error.unwrap_or(false) {
            Err(ToolError::execution_failed("模拟错误：操作失败"))
        } else {
            result_content.push_str("✅ 操作执行成功\n");
            result_content.push_str(&format!(
                "时间: {}\n",
                chrono::Utc::now().format("%Y-%m-%d %H:%M:%S")
            ));

            Ok(ToolResult::success(&result_content)
                .with_metadata("action", serde_json::json!(params.action))
                .with_metadata("workflow_stage", serde_json::json!("action_completed")))
        };

        // === Post-Action 阶段 ===
        let post_action_info = match &action_result {
            Ok(result) => {
                self.post_action(
                    context,
                    &serde_json::to_value(&params).unwrap(),
                    result,
                    None,
                )
                .await?
            }
            Err(error) => {
                self.post_action(
                    context,
                    &serde_json::to_value(&params).unwrap(),
                    &ToolResult::error("Action failed"),
                    Some(error),
                )
                .await?
            }
        };

        // 合并结果
        match action_result {
            Ok(mut result) => {
                let final_content = format!("{}\n\n{}", result.content(), post_action_info);
                result = result.with_content(final_content);
                Ok(result)
            }
            Err(error) => {
                // 即使操作失败，也要返回包含 Post-Action 信息的结果
                let error_content = format!("❌ 操作失败: {}\n\n{}", error, post_action_info);
                Ok(ToolResult::error(&error_content)
                    .with_metadata("error", serde_json::json!(error.to_string()))
                    .with_metadata("post_action_info", serde_json::json!(post_action_info)))
            }
        }
    }
}

/// 工作流集成工具的构建器
pub struct WorkflowIntegratedToolBuilder {
    tool: WorkflowIntegratedTool,
}

impl WorkflowIntegratedToolBuilder {
    pub fn new() -> Self {
        Self {
            tool: WorkflowIntegratedTool::default(),
        }
    }

    pub fn with_name(mut self, name: String) -> Self {
        self.tool.name = name;
        self
    }

    pub fn with_description(mut self, description: String) -> Self {
        self.tool.description = description;
        self
    }

    pub fn with_hook_manager(mut self, hook_manager: Arc<ToolHookManager>) -> Self {
        self.tool.hook_manager = Some(hook_manager);
        self
    }

    pub fn build(self) -> WorkflowIntegratedTool {
        self.tool
    }
}

impl Default for WorkflowIntegratedToolBuilder {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn create_test_context() -> ToolContext {
        ToolContext::new(PathBuf::from("/tmp"))
            .with_session_id("test-session")
            .with_user("test-user")
    }

    #[tokio::test]
    async fn test_workflow_integrated_tool_success() {
        let tool = WorkflowIntegratedTool::default();
        let context = create_test_context();

        let params = serde_json::json!({
            "action": "analyze",
            "description": "分析测试数据",
            "simulate_error": false
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());
        assert!(result.content().contains("Pre-Action 信息"));
        assert!(result.content().contains("Post-Action 状态更新"));
    }

    #[tokio::test]
    async fn test_workflow_integrated_tool_error() {
        let tool = WorkflowIntegratedTool::default();
        let context = create_test_context();

        let params = serde_json::json!({
            "action": "process",
            "description": "处理错误测试",
            "simulate_error": true
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.content().contains("操作失败"));
        assert!(result.content().contains("Post-Action 状态更新"));
        assert!(result.content().contains("错误处理"));
    }

    #[tokio::test]
    async fn test_workflow_integrated_tool_with_hooks() {
        let hook_manager = Arc::new(ToolHookManager::new(true));
        hook_manager.register_default_hooks().await;

        let tool = WorkflowIntegratedTool::default().with_hook_manager(hook_manager.clone());

        let context = create_test_context();

        let params = serde_json::json!({
            "action": "test",
            "description": "测试钩子集成",
            "simulate_error": false
        });

        let result = tool.execute(params, &context).await.unwrap();
        assert!(result.is_success());

        // 验证钩子被触发
        assert_eq!(hook_manager.hook_count(HookTrigger::PreExecution).await, 2); // LoggingHook + FileOperationHook
        assert_eq!(hook_manager.hook_count(HookTrigger::PostExecution).await, 1);
        // LoggingHook
    }

    #[tokio::test]
    async fn test_workflow_builder() {
        let hook_manager = Arc::new(ToolHookManager::new(true));

        let tool = WorkflowIntegratedToolBuilder::new()
            .with_name("custom_workflow_tool".to_string())
            .with_description("自定义工作流工具".to_string())
            .with_hook_manager(hook_manager)
            .build();

        assert_eq!(tool.name(), "custom_workflow_tool");
        assert_eq!(tool.description(), "自定义工作流工具");
        assert!(tool.hook_manager.is_some());
    }
}
