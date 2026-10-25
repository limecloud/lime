use super::*;

impl AppServer {
    #[cfg(test)]
    pub fn new() -> Self {
        Self::with_runtime(RuntimeCore::default())
    }

    pub fn with_runtime(runtime: RuntimeCore) -> Self {
        if let Err(error) = runtime.install_computer_use_gateway() {
            tracing::warn!(%error, "runtime backend rejected Computer Use gateway injection");
        }
        let (outbound_messages, _) = broadcast::channel(OUTBOUND_MESSAGE_CAPACITY);
        let runtime_event_receiver = Arc::new(Mutex::new(runtime.take_event_receiver()));
        let environment_registry_path = runtime.environment_registry_path();
        let thread_states = thread_state::ThreadStateManager::new();
        let transport_writers = Arc::new(Mutex::new(HashMap::new()));
        let transport_disconnects = Arc::new(Mutex::new(HashMap::new()));
        let transport_initialized = Arc::new(Mutex::new(HashSet::new()));
        let transport_experimental_api = Arc::new(Mutex::new(HashSet::new()));
        let transport_notification_opt_out = Arc::new(Mutex::new(HashMap::new()));
        let server_requests = server_request::ServerRequestRouter::default();
        let current_time_requests = current_time::CurrentTimeRequestRouter::new(
            thread_states.clone(),
            transport_writers.clone(),
            transport_disconnects.clone(),
            server_requests.clone(),
        );
        if let Err(error) =
            runtime.set_current_time_gateway(Arc::new(current_time_requests.clone()))
        {
            tracing::warn!(%error, "runtime backend rejected current-time gateway injection");
        }
        let interrupt_bridge = AppServerEventBridge {
            runtime: runtime.clone(),
            runtime_events: runtime.event_appender(),
            thread_states: thread_states.clone(),
            server_requests: server_requests.clone(),
            outbound_messages: outbound_messages.clone(),
            transport_writers: transport_writers.clone(),
            transport_disconnects: transport_disconnects.clone(),
            transport_initialized: transport_initialized.clone(),
            transport_experimental_api: transport_experimental_api.clone(),
            transport_notification_opt_out: transport_notification_opt_out.clone(),
        };
        let interrupt_router = server_requests.clone();
        let process_notification_bridge = interrupt_bridge.clone();
        let command_exec_notification_bridge = interrupt_bridge.clone();
        let fs_notification_bridge = interrupt_bridge.clone();
        let connection_notification_bridge = interrupt_bridge.clone();
        let notification_bridge = interrupt_bridge.clone();
        let skills_watcher_bridge = notification_bridge.clone();
        let turn_interrupt_hook: processor::TurnInterruptHook =
            Arc::new(move |thread_id, turn_id| {
                let bridge = interrupt_bridge.clone();
                let router = interrupt_router.clone();
                Box::pin(async move {
                    router
                        .abort_for_thread_turn(&bridge, &thread_id, &turn_id, "turn interrupted")
                        .await;
                })
            });
        let server_notification_hook: processor::ServerNotificationHook =
            Arc::new(move |notification| {
                let bridge = notification_bridge.clone();
                Box::pin(async move {
                    bridge
                        .broadcast_message(JsonRpcMessage::Notification(notification.into()))
                        .await;
                })
            });
        let process_notification_hook: processor::ProcessNotificationHook =
            Arc::new(move |connection_id, notification| {
                let bridge = process_notification_bridge.clone();
                Box::pin(async move {
                    let _ = bridge
                        .send_messages_to_connection(
                            connection_id,
                            &[JsonRpcMessage::Notification(notification)],
                        )
                        .await;
                })
            });
        let command_exec_notification_hook: processor::CommandExecNotificationHook =
            Arc::new(move |connection_id, notification| {
                let bridge = command_exec_notification_bridge.clone();
                Box::pin(async move {
                    let _ = bridge
                        .send_messages_to_connection(
                            connection_id,
                            &[JsonRpcMessage::Notification(notification)],
                        )
                        .await;
                })
            });
        let fs_notification_hook: processor::FsNotificationHook =
            Arc::new(move |connection_id, notification| {
                let bridge = fs_notification_bridge.clone();
                Box::pin(async move {
                    let _ = bridge
                        .send_messages_to_connection(
                            connection_id,
                            &[JsonRpcMessage::Notification(notification)],
                        )
                        .await;
                })
            });
        let connection_server_notification_hook: processor::ConnectionServerNotificationHook =
            Arc::new(move |connection_id, notification| {
                let bridge = connection_notification_bridge.clone();
                Box::pin(async move {
                    let _ = bridge
                        .send_messages_to_connection(
                            connection_id,
                            &[JsonRpcMessage::Notification(notification.into())],
                        )
                        .await;
                })
            });
        let skills_watcher = if cfg!(test) {
            None
        } else {
            skills_watcher::SkillsWatcher::new(skills_watcher_bridge)
        };
        if let Some(watcher) = &skills_watcher {
            watcher.register_runtime_extra_roots(lime_skills::runtime_extra_skill_roots());
        }
        let processor = RequestProcessor::new_with_thread_states_and_environment_storage(
            runtime,
            thread_states.clone(),
            Some(environment_registry_path),
        )
        .with_turn_interrupt_hook(turn_interrupt_hook)
        .with_skills_watcher(skills_watcher.clone())
        .with_server_notification_hook(server_notification_hook)
        .with_process_notification_hook(process_notification_hook)
        .with_command_exec_notification_hook(command_exec_notification_hook)
        .with_fs_notification_hook(fs_notification_hook)
        .with_connection_server_notification_hook(connection_server_notification_hook);
        processor.start_environment_runtime();
        Self {
            processor,
            thread_states,
            runtime_event_receiver,
            runtime_event_pump_started: Arc::new(AtomicBool::new(false)),
            outbound_messages,
            transport_writers,
            transport_disconnects,
            transport_initialized,
            transport_experimental_api,
            transport_notification_opt_out,
            thread_unloading_delay: DEFAULT_THREAD_UNLOADING_DELAY,
            server_requests,
            current_time_requests,
            mcp_elicitation_requests: mcp_elicitation::ElicitationRequestSource::default(),
        }
    }
}
