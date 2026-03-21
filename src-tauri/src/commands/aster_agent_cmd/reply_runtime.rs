use super::*;

fn execution_strategy_label(strategy: AsterExecutionStrategy) -> &'static str {
    match strategy {
        AsterExecutionStrategy::React => "对话执行优先",
        AsterExecutionStrategy::CodeOrchestrated => "代码编排执行",
        AsterExecutionStrategy::Auto => "自动路由执行",
    }
}

fn model_supports_reasoning(model_name: Option<&str>) -> bool {
    let Some(model_name) = model_name.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };
    let normalized = model_name.to_ascii_lowercase();
    normalized.contains("thinking")
        || normalized.contains("reason")
        || normalized.contains("r1")
        || normalized.contains("o1")
        || normalized.contains("o3")
        || normalized.contains("o4")
        || normalized.contains("gpt-5")
        || normalized.contains("2.5")
}

pub(super) fn message_suggests_live_search(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "搜索",
        "搜一下",
        "查一下",
        "查一查",
        "检索",
        "上网查",
        "联网查",
        "最新",
        "今天",
        "刚刚",
        "实时",
        "新闻",
        "股价",
        "汇率",
        "天气",
        "政策",
        "法规",
        "版本",
        "价格",
        "热搜",
        "上线",
        "发布",
        "search",
        "look up",
        "google",
        "browse",
        "now",
        "today",
        "latest",
        "recent",
        "price",
        "version",
        "news",
        "weather",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

fn message_suggests_planning(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "计划",
        "规划",
        "roadmap",
        "拆解",
        "分步骤",
        "执行方案",
        "实施方案",
        "阶段",
        "里程碑",
        "todo",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

fn message_suggests_task(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "后台",
        "稍后",
        "异步",
        "排队",
        "持续生成",
        "长时间",
        "继续跑",
        "持续跑",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

fn message_suggests_subagent(message: &str) -> bool {
    let normalized = message.to_ascii_lowercase();
    [
        "并行",
        "多代理",
        "分工",
        "分别分析",
        "从多个角度",
        "parallel",
        "subagent",
        "delegate",
    ]
    .iter()
    .any(|keyword| normalized.contains(keyword))
}

pub(super) fn build_turn_runtime_statuses(
    request: &AsterChatRequest,
    effective_strategy: AsterExecutionStrategy,
    request_tool_policy: &RequestToolPolicy,
    model_name: Option<&str>,
) -> (TauriRuntimeStatus, TauriRuntimeStatus) {
    let thinking_enabled = extract_harness_bool(
        request.metadata.as_ref(),
        &["thinking_enabled", "thinkingEnabled"],
    )
    .unwrap_or(false);
    let task_enabled = extract_harness_bool(
        request.metadata.as_ref(),
        &["task_mode_enabled", "taskModeEnabled"],
    )
    .unwrap_or(false);
    let subagent_enabled = extract_harness_bool(
        request.metadata.as_ref(),
        &["subagent_mode_enabled", "subagentModeEnabled"],
    )
    .unwrap_or(false);
    let reasoning_supported = model_supports_reasoning(model_name);
    let news_expansion_needed = request_tool_policy.allows_web_search()
        && message_suggests_news_expansion(&request.message);
    let browser_task_requirement = extract_browser_task_requirement(request.metadata.as_ref());

    let initial_checkpoints = vec![
        execution_strategy_label(effective_strategy).to_string(),
        if request_tool_policy.requires_web_search() {
            "本回合必须先联网核实".to_string()
        } else if news_expansion_needed {
            "已识别新闻综述类输入，将先并发 WebSearch 扩搜".to_string()
        } else if request_tool_policy.allows_web_search() {
            "联网搜索仅作为候选能力待命".to_string()
        } else {
            "默认直接回答优先".to_string()
        },
        if matches!(
            browser_task_requirement,
            Some(BrowserTaskRequirement::Required | BrowserTaskRequirement::RequiredWithUserStep)
        ) {
            "当前任务要求真实浏览器执行，不允许退化为联网检索".to_string()
        } else {
            "浏览器能力按需升级".to_string()
        },
        if thinking_enabled && reasoning_supported {
            "模型支持深度思考，先进入推理判定".to_string()
        } else if thinking_enabled {
            "当前模型不支持显式 thinking，改走轻量意图理解".to_string()
        } else {
            "先做轻量意图理解".to_string()
        },
        if task_enabled {
            "后台任务能力已待命".to_string()
        } else {
            "默认不升级后台任务".to_string()
        },
        if subagent_enabled {
            "多代理能力已待命".to_string()
        } else {
            "默认由单 Agent 先判断".to_string()
        },
    ];

    let decided = if request_tool_policy.requires_web_search() {
        (
            "已决定：先联网检索".to_string(),
            "当前回合已被明确指定为先搜索后答复，会先完成联网核实再继续生成。".to_string(),
            vec![
                "用户明确要求联网搜索".to_string(),
                "搜索结果返回后再形成最终答复".to_string(),
            ],
        )
    } else if news_expansion_needed {
        (
            "已决定：先联网扩搜".to_string(),
            "当前输入属于新闻/最新动态综述类请求，会先并发执行多组 WebSearch，再基于结果做主题聚类与交叉验证。"
                .to_string(),
            vec![
                "统一使用 WebSearch 执行多组扩搜".to_string(),
                "完成来源整合后再组织最终答复".to_string(),
            ],
        )
    } else if subagent_enabled && message_suggests_subagent(&request.message) {
        (
            "已决定：优先拆分为多代理".to_string(),
            "用户输入更适合并行分工处理，先按多代理路径组织执行。".to_string(),
            vec![
                "检测到并行/多角度需求".to_string(),
                "主线程先承担协调职责".to_string(),
            ],
        )
    } else if task_enabled && message_suggests_task(&request.message) {
        (
            "已决定：升级为后台任务".to_string(),
            "用户输入更接近耗时或异步推进场景，优先走后台任务链路。".to_string(),
            vec![
                "检测到排队/持续执行诉求".to_string(),
                "先建立任务，再回传过程与产出".to_string(),
            ],
        )
    } else if thinking_enabled && reasoning_supported {
        (
            "已决定：先深度思考".to_string(),
            "当前模型支持 reasoning，先做更充分的意图理解与方案判断，再决定是否调用搜索或工具。"
                .to_string(),
            vec![
                "thinking 已开启".to_string(),
                "搜索与工具保持候选状态，不默认触发".to_string(),
            ],
        )
    } else if thinking_enabled {
        (
            "已决定：轻量理解后回答".to_string(),
            "当前模型不支持显式 reasoning，先做轻量意图理解，再决定是否需要搜索或其他能力。"
                .to_string(),
            vec![
                "thinking 已开启".to_string(),
                "当前模型回退为轻量推理".to_string(),
            ],
        )
    } else if request_tool_policy.allows_web_search()
        && message_suggests_live_search(&request.message)
    {
        (
            "已决定：先联网核实".to_string(),
            "问题包含明显时效性或实时性特征，先搜索核实再回答更稳妥。".to_string(),
            vec![
                "已检测到最新/实时信息需求".to_string(),
                "搜索完成后继续组织答复".to_string(),
            ],
        )
    } else if message_suggests_planning(&request.message) {
        (
            "已决定：先规划再输出".to_string(),
            "当前请求更像计划或方案拆解，会先整理执行路径和关键步骤。".to_string(),
            vec![
                "检测到计划/拆解需求".to_string(),
                "优先输出结构化行动路径".to_string(),
            ],
        )
    } else {
        (
            "已决定：直接回答优先".to_string(),
            "当前请求无需默认升级为搜索或任务，先直接给出结果，必要时再调用工具。".to_string(),
            vec![
                "默认保持单回合直接回答".to_string(),
                "只有证据不足或时效性要求出现时才升级".to_string(),
            ],
        )
    };

    (
        TauriRuntimeStatus {
            phase: "preparing".to_string(),
            title: "正在理解意图".to_string(),
            detail:
                "正在判断当前回合应该直接回答、深度思考、规划、联网核实，还是升级为任务/多代理。"
                    .to_string(),
            checkpoints: initial_checkpoints,
        },
        TauriRuntimeStatus {
            phase: "routing".to_string(),
            title: decided.0,
            detail: decided.1,
            checkpoints: decided.2,
        },
    )
}

fn emit_projected_runtime_item_event(
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    event: TauriAgentEvent,
) {
    if let Err(error) = app.emit(event_name, &event) {
        tracing::warn!("[AsterAgent] 发送 runtime item 投影事件失败: {}", error);
    }

    let mut recorder = match timeline_recorder.lock() {
        Ok(guard) => guard,
        Err(error) => error.into_inner(),
    };
    if let Err(error) = recorder.record_runtime_event(app, event_name, &event, workspace_root) {
        tracing::warn!(
            "[AsterAgent] 记录 runtime item 投影事件失败（已降级继续）: {}",
            error
        );
    }
}

pub(super) async fn emit_runtime_status_with_projection(
    agent: &Agent,
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    session_config: &aster::agents::SessionConfig,
    status: TauriRuntimeStatus,
) {
    match agent
        .upsert_runtime_status_item(
            session_config,
            status.phase.clone(),
            status.title.clone(),
            status.detail.clone(),
            status.checkpoints.clone(),
        )
        .await
    {
        Ok(agent_event) => {
            for event in lime_agent::convert_agent_event(agent_event) {
                emit_projected_runtime_item_event(
                    app,
                    event_name,
                    timeline_recorder,
                    workspace_root,
                    event,
                );
            }
        }
        Err(error) => {
            tracing::warn!(
                "[AsterAgent] 写入 runtime_status item 失败，降级仅发送 transient 事件: {}",
                error
            );
        }
    }

    let runtime_event = TauriAgentEvent::RuntimeStatus { status };
    if let Err(error) = app.emit(event_name, &runtime_event) {
        tracing::warn!("[AsterAgent] 发送 runtime_status 失败: {}", error);
    }
}

pub(super) async fn complete_runtime_status_projection(
    agent: &Agent,
    app: &AppHandle,
    event_name: &str,
    timeline_recorder: &Arc<Mutex<AgentTimelineRecorder>>,
    workspace_root: &str,
    session_config: &aster::agents::SessionConfig,
) {
    match agent.complete_runtime_status_item(session_config).await {
        Ok(Some(agent_event)) => {
            for event in lime_agent::convert_agent_event(agent_event) {
                emit_projected_runtime_item_event(
                    app,
                    event_name,
                    timeline_recorder,
                    workspace_root,
                    event,
                );
            }
        }
        Ok(None) => {}
        Err(error) => {
            tracing::warn!("[AsterAgent] 完成 runtime_status item 失败: {}", error);
        }
    }
}

pub(super) fn should_fallback_to_react_from_code_orchestrated(error: &ReplyAttemptError) -> bool {
    if !error.emitted_any {
        return true;
    }

    let lowered = error.message.to_lowercase();
    let recoverable_hints = ["unknown subscript", "tool_search_analysis", "web_scraping"];

    recoverable_hints.iter().any(|hint| lowered.contains(hint))
}

pub(super) async fn ensure_code_execution_extension_enabled(agent: &Agent) -> Result<bool, String> {
    let extension_configs = agent.get_extension_configs().await;
    if extension_configs
        .iter()
        .any(|cfg| cfg.name() == CODE_EXECUTION_EXTENSION_NAME)
    {
        return Ok(false);
    }

    let extension = ExtensionConfig::Platform {
        name: CODE_EXECUTION_EXTENSION_NAME.to_string(),
        description: "Execute JavaScript code in a sandboxed environment".to_string(),
        bundled: Some(true),
        available_tools: vec![],
        deferred_loading: false,
        always_expose_tools: Vec::new(),
        allowed_caller: None,
    };

    agent
        .add_extension(extension)
        .await
        .map_err(|e| format!("启用 code_execution 扩展失败: {e}"))?;

    Ok(true)
}

pub(super) async fn stream_reply_once<F>(
    agent: &Agent,
    app: &AppHandle,
    event_name: &str,
    user_message: Message,
    working_directory: Option<&Path>,
    session_config: aster::agents::SessionConfig,
    cancel_token: CancellationToken,
    request_tool_policy: &RequestToolPolicy,
    mut on_event: F,
) -> Result<(), ReplyAttemptError>
where
    F: FnMut(&TauriAgentEvent),
{
    stream_message_reply_with_policy(
        agent,
        user_message,
        working_directory,
        session_config,
        Some(cancel_token),
        request_tool_policy,
        |event| {
            on_event(event);
            if let Err(error) = app.emit(event_name, event) {
                tracing::error!("[AsterAgent] 发送事件失败: {}", error);
            }
            let app = app.clone();
            let event_name = event_name.to_string();
            let event = event.clone();
            tokio::spawn(async move {
                maybe_emit_subagent_status_for_runtime_event(&app, &event_name, &event).await;
            });
        },
    )
    .await
    .map(|_| ())
}

pub(super) fn build_runtime_user_message(
    message_text: &str,
    images: Option<&[ImageInput]>,
) -> Message {
    let mut message = Message::user();

    if !message_text.is_empty() {
        message = message.with_text(message_text);
    }

    if let Some(images) = images {
        for image in images {
            if image.data.trim().is_empty() || image.media_type.trim().is_empty() {
                continue;
            }
            message = message.with_image(image.data.clone(), image.media_type.clone());
        }
    }

    if message.content.is_empty() {
        return Message::user().with_text(message_text);
    }

    message
}
