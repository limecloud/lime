use super::*;

pub(crate) struct ToolSearchBridgeTool {
    registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
    extension_manager: Option<Arc<aster::agents::extension_manager::ExtensionManager>>,
}

impl ToolSearchBridgeTool {
    pub(crate) fn new(
        registry: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
        extension_manager: Option<Arc<aster::agents::extension_manager::ExtensionManager>>,
    ) -> Self {
        Self {
            registry,
            extension_manager,
        }
    }

    fn with_input_examples_in_schema(
        schema: &serde_json::Value,
        input_examples: &[serde_json::Value],
    ) -> serde_json::Value {
        if input_examples.is_empty() {
            return schema.clone();
        }

        let mut enriched = schema.clone();
        let Some(root) = enriched.as_object_mut() else {
            return schema.clone();
        };
        let extension = root
            .entry("x-lime".to_string())
            .or_insert_with(|| serde_json::json!({}));
        let Some(extension_obj) = extension.as_object_mut() else {
            return schema.clone();
        };
        if extension_obj.get("input_examples").is_none()
            && extension_obj.get("inputExamples").is_none()
        {
            extension_obj.insert(
                "input_examples".to_string(),
                serde_json::Value::Array(input_examples.to_vec()),
            );
        }
        enriched
    }

    #[cfg(test)]
    pub(crate) fn parse_schema_metadata(
        tool_name: &str,
        schema: &serde_json::Value,
    ) -> (
        bool,                   // deferred_loading
        bool,                   // always_visible
        Vec<String>,            // allowed_callers
        Vec<String>,            // tags
        Vec<serde_json::Value>, // input_examples
    ) {
        let metadata = lime_core::tool_calling::extract_tool_surface_metadata(tool_name, schema);

        (
            metadata.deferred_loading.unwrap_or(false),
            metadata.always_visible.unwrap_or(false),
            metadata.allowed_callers.unwrap_or_default(),
            metadata.tags.unwrap_or_default(),
            metadata.input_examples,
        )
    }

    pub(crate) fn score_match(name: &str, description: &str, tags: &[String], query: &str) -> i32 {
        lime_core::tool_calling::score_tool_match(name, description, tags, query)
    }

    pub(crate) fn parse_select_query(query: &str) -> Option<Vec<String>> {
        let prefix = "select:";
        let actual_prefix = query.get(..prefix.len())?;
        if !actual_prefix.eq_ignore_ascii_case(prefix) {
            return None;
        }

        Some(
            query[prefix.len()..]
                .split(',')
                .map(str::trim)
                .filter(|item| !item.is_empty())
                .map(str::to_string)
                .collect(),
        )
    }

    pub(crate) fn select_match_rank(requested: &[String], tool_name: &str) -> Option<i32> {
        requested
            .iter()
            .enumerate()
            .find_map(|(index, requested_name)| {
                lime_core::tool_calling::tool_search_exact_match(tool_name, requested_name)
                    .then_some(100_000 - index as i32)
            })
    }

    pub(crate) fn extension_tool_status(
        extension_configs: &[ExtensionConfig],
        visible_extension_tools: &HashSet<String>,
        tool_name: &str,
    ) -> (&'static str, bool, Option<String>) {
        let status = resolve_extension_tool_runtime_status(
            extension_configs,
            visible_extension_tools,
            tool_name,
        );
        (
            status.status,
            status.deferred_loading,
            status.extension_name,
        )
    }

    fn build_tool_search_notes(query: &str, hit_count: usize) -> Vec<String> {
        if hit_count > 0 {
            return Vec::new();
        }

        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Vec::new();
        }

        if Self::parse_select_query(trimmed).is_some() {
            return vec![
                "未命中任何工具。不要继续改写同义词反复重试；如果需要文件、命令或网页原生能力，请直接调用当前可见的 Read / Write / Edit / Glob / Grep / Bash / WebFetch / WebSearch。".to_string(),
            ];
        }

        vec![
            "未命中任何工具。优先直接调用当前可见的原生工具，或补充更明确的产品域关键词；不要继续用 ToolSearch 反复改写同义词。".to_string(),
        ]
    }
}

#[async_trait]
impl Tool for ToolSearchBridgeTool {
    fn name(&self) -> &str {
        TOOL_SEARCH_TOOL_NAME
    }

    fn description(&self) -> &str {
        "统一搜索当前会话工具面：包含原生 registry 工具与 extension/MCP 工具。支持 select:<tool_name>[,<tool_name>] 直接选择，对 deferred 工具会返回加载提示。"
    }

    fn input_schema(&self) -> serde_json::Value {
        serde_json::json!({
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "用于搜索工具的关键词；如已知精确工具名，可使用 select:<tool_name>[,<tool_name>] 直接选择。"
                },
                "caller": { "type": "string", "description": "调用方，例如 assistant/code_execution" },
                "limit": { "type": "integer", "minimum": 1, "maximum": 100 },
                "include_deferred": { "type": "boolean", "description": "是否包含延迟加载工具" },
                "include_schema": { "type": "boolean", "description": "是否返回完整输入 schema" }
            },
            "required": []
        })
    }

    fn options(&self) -> ToolOptions {
        ToolOptions::new()
            .with_max_retries(1)
            .with_base_timeout(Duration::from_secs(15))
            .with_dynamic_timeout(false)
    }

    async fn execute(
        &self,
        params: serde_json::Value,
        _context: &ToolContext,
    ) -> Result<ToolResult, ToolError> {
        let raw_query = params
            .get("query")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .trim()
            .to_string();
        let query = raw_query.to_ascii_lowercase();
        let caller = params
            .get("caller")
            .and_then(|v| v.as_str())
            .unwrap_or("assistant")
            .trim()
            .to_ascii_lowercase();
        let include_deferred = params
            .get("include_deferred")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let include_schema = params
            .get("include_schema")
            .and_then(|v| v.as_bool())
            .unwrap_or(false);
        let limit = params
            .get("limit")
            .and_then(|v| v.as_u64())
            .map(|v| v.clamp(1, 100) as usize)
            .unwrap_or(10);
        let select_requested = Self::parse_select_query(&raw_query);

        let registry = self.registry.read().await;
        let definitions = registry.get_definitions();

        let mut scored = definitions
            .into_iter()
            .filter(|d| d.name != self.name())
            .filter_map(|definition| {
                let metadata = lime_core::tool_calling::extract_tool_surface_metadata(
                    &definition.name,
                    &definition.input_schema,
                );
                if !lime_core::tool_calling::tool_visible_in_context(&metadata, include_deferred) {
                    return None;
                }
                if !lime_core::tool_calling::tool_matches_caller(&metadata, Some(&caller)) {
                    return None;
                }

                let deferred_loading = metadata.deferred_loading.unwrap_or(false);
                let always_visible = metadata.always_visible.unwrap_or(false);
                let allowed_callers = metadata.allowed_callers.unwrap_or_default();
                let tags = metadata.tags.unwrap_or_default();
                let input_examples = metadata.input_examples;
                let score = if let Some(requested) = select_requested.as_ref() {
                    Self::select_match_rank(requested, &definition.name).unwrap_or(0)
                } else {
                    Self::score_match(&definition.name, &definition.description, &tags, &query)
                };
                if score <= 0 {
                    return None;
                }

                let item = if include_schema {
                    let enriched_schema = Self::with_input_examples_in_schema(
                        &definition.input_schema,
                        &input_examples,
                    );
                    serde_json::json!({
                        "source": "native_registry",
                        "name": definition.name,
                        "description": definition.description,
                        "input_schema": enriched_schema,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                } else {
                    serde_json::json!({
                        "source": "native_registry",
                        "name": definition.name,
                        "description": definition.description,
                        "deferred_loading": deferred_loading,
                        "always_visible": always_visible,
                        "allowed_callers": allowed_callers,
                        "input_examples": input_examples,
                        "tags": tags
                    })
                };
                Some((score, item))
            })
            .collect::<Vec<_>>();

        drop(registry);

        if let Some(extension_manager) = self.extension_manager.as_ref() {
            let visible_extension_tools = extension_manager
                .get_prefixed_tools(None)
                .await
                .unwrap_or_default()
                .into_iter()
                .map(|tool| tool.name.to_string())
                .collect::<HashSet<_>>();
            let extension_configs = extension_manager.get_extension_configs().await;
            let extension_tools = extension_manager
                .get_prefixed_tools_for_search(None)
                .await
                .unwrap_or_default();

            for tool in extension_tools {
                if tool.name.as_ref() == self.name() {
                    continue;
                }

                let tool_name = tool.name.to_string();
                let description = tool.description.as_deref().unwrap_or("").to_string();
                let score = if let Some(requested) = select_requested.as_ref() {
                    Self::select_match_rank(requested, &tool_name).unwrap_or(0)
                } else {
                    Self::score_match(&tool_name, &description, &[], &query)
                };
                if score <= 0 {
                    continue;
                }

                let (status, deferred_loading, extension_name) = Self::extension_tool_status(
                    &extension_configs,
                    &visible_extension_tools,
                    &tool_name,
                );
                let input_schema = serde_json::Value::Object((*tool.input_schema).clone());
                let activation = if deferred_loading {
                    serde_json::json!({
                        "tool": "extensionmanager__load_tools",
                        "arguments": {
                            "tool_names": [tool_name.clone()]
                        }
                    })
                } else {
                    serde_json::Value::Null
                };

                let item = if include_schema {
                    serde_json::json!({
                        "source": "extension",
                        "name": tool_name,
                        "description": description,
                        "extension_name": extension_name,
                        "input_schema": input_schema,
                        "deferred_loading": deferred_loading,
                        "status": status,
                        "activation": activation
                    })
                } else {
                    serde_json::json!({
                        "source": "extension",
                        "name": tool_name,
                        "description": description,
                        "extension_name": extension_name,
                        "deferred_loading": deferred_loading,
                        "status": status,
                        "activation": activation
                    })
                };
                scored.push((score, item));
            }
        }

        scored.sort_by(|(a_score, a_item), (b_score, b_item)| {
            b_score.cmp(a_score).then_with(|| {
                a_item["name"]
                    .as_str()
                    .unwrap_or_default()
                    .cmp(b_item["name"].as_str().unwrap_or_default())
            })
        });

        let result = scored
            .into_iter()
            .take(limit)
            .map(|(_, item)| item)
            .collect::<Vec<_>>();
        let notes = Self::build_tool_search_notes(&raw_query, result.len());
        let text = serde_json::to_string_pretty(&serde_json::json!({
            "query": raw_query,
            "caller": caller,
            "count": result.len(),
            "notes": notes,
            "tools": result
        }))
        .map_err(|e| {
            ToolError::execution_failed(format!("{TOOL_SEARCH_TOOL_NAME} 序列化失败: {e}"))
        })?;

        Ok(ToolResult::success(text))
    }
}

pub(crate) fn register_tool_search_tool_to_registry(
    registry: &mut aster::tools::ToolRegistry,
    registry_arc: Arc<tokio::sync::RwLock<aster::tools::ToolRegistry>>,
    extension_manager: Option<Arc<aster::agents::extension_manager::ExtensionManager>>,
) {
    // Lime runtime 里的 ToolSearch 事实源是 bridge 实现。
    // 这里始终重新注册，确保旧 aster ToolSearch 不会抢占当前 surface。
    registry.register(Box::new(ToolSearchBridgeTool::new(
        registry_arc,
        extension_manager,
    )));
}

pub(crate) async fn ensure_tool_search_tool_registered(
    state: &AsterAgentState,
) -> Result<(), String> {
    let (registry_arc, extension_manager) = resolve_agent_registry(state).await?;
    let mut registry = registry_arc.write().await;
    register_tool_search_tool_to_registry(&mut registry, registry_arc.clone(), extension_manager);
    Ok(())
}
