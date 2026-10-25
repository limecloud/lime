use super::{coding_events::CodingEventMirror, tool_events};
use crate::runtime::{RuntimeCoreEventAppender, RuntimeEventHub};
use lime_agent::{AgentEvent, CommandEventPublisher};
use std::sync::Mutex;

pub(crate) fn publisher(
    appender: RuntimeCoreEventAppender,
    hub: RuntimeEventHub,
    session_id: String,
    turn_id: String,
) -> CommandEventPublisher {
    let mirror = Mutex::new(CodingEventMirror::default());
    CommandEventPublisher::new(move |event: &AgentEvent| {
        let mut mirror = mirror
            .lock()
            .map_err(|_| "command mirror mutex poisoned".to_string())?;
        let coding = mirror.process_event(event);
        let persisted = super::coding_events::runtime_event_for_persistence(event);
        let mut events = coding.before_raw;
        events.extend(
            tool_events::runtime_events_from_agent_event(persisted.as_ref())
                .map_err(|error| error.to_string())?,
        );
        events.extend(coding.after_raw);
        let appended = appender
            .append_command_runtime_events(&session_id, &turn_id, events)
            .map_err(|error| error.to_string())?;
        for event in appended {
            hub.publish(event);
        }
        Ok(())
    })
}
