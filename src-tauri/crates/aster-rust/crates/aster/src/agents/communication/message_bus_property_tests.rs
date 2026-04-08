//! Property-based tests for Agent Message Bus
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**

#[cfg(test)]
mod property_tests {
    use crate::agents::communication::message_bus::{
        AgentMessage, AgentMessageBus, MessagePriority, MessageTarget,
    };
    use proptest::prelude::*;
    use serde_json::json;

    // Strategy for generating agent IDs
    fn agent_id_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,10}".prop_map(|s| s.to_string())
    }

    // Strategy for generating message types
    fn message_type_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_-]{0,15}".prop_map(|s| s.to_string())
    }

    // Strategy for generating message priorities
    fn priority_strategy() -> impl Strategy<Value = u8> {
        prop_oneof![
            Just(MessagePriority::Low as u8),
            Just(MessagePriority::Normal as u8),
            Just(MessagePriority::High as u8),
            Just(MessagePriority::Critical as u8),
        ]
    }

    // Strategy for generating a set of unique agent IDs
    fn agent_set_strategy(min: usize, max: usize) -> impl Strategy<Value = Vec<String>> {
        prop::collection::hash_set(agent_id_strategy(), min..max)
            .prop_map(|set| set.into_iter().collect())
    }

    // Strategy for generating messages with specific priorities
    fn message_with_priority_strategy(
        sender: String,
        target_agent: String,
    ) -> impl Strategy<Value = (AgentMessage, u8)> {
        priority_strategy().prop_map(move |priority| {
            let msg = AgentMessage::new(
                sender.clone(),
                MessageTarget::Agent(target_agent.clone()),
                "test-message",
                json!({"priority": priority}),
            )
            .with_priority(priority);
            (msg, priority)
        })
    }

    // **Property 11: Message Priority Ordering**
    //
    // *For any* set of messages with different priorities sent to the same agent,
    // dequeuing SHALL return messages in priority order (highest first).
    //
    // **Validates: Requirements 3.1, 3.3**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_11_priority_ordering_basic(
            sender in agent_id_strategy(),
            receiver in agent_id_strategy(),
            num_messages in 2usize..20usize
        ) {
            let mut bus = AgentMessageBus::new();
            bus.subscribe(&receiver, vec![]);

            // Generate messages with random priorities
            let priorities: Vec<u8> = (0..num_messages)
                .map(|i| match i % 4 {
                    0 => MessagePriority::Low as u8,
                    1 => MessagePriority::Normal as u8,
                    2 => MessagePriority::High as u8,
                    _ => MessagePriority::Critical as u8,
                })
                .collect();

            // Send messages in order
            for (i, &priority) in priorities.iter().enumerate() {
                let msg = AgentMessage::new(
                    &sender,
                    MessageTarget::Agent(receiver.clone()),
                    "test",
                    json!({"index": i, "priority": priority}),
                )
                .with_priority(priority);
                bus.send(msg).unwrap();
            }

            // Dequeue all messages
            let dequeued = bus.dequeue(&receiver, num_messages);

            prop_assert_eq!(
                dequeued.len(),
                num_messages,
                "Should dequeue all messages"
            );

            // Verify priority ordering (highest first)
            for i in 1..dequeued.len() {
                prop_assert!(
                    dequeued[i - 1].priority >= dequeued[i].priority,
                    "Messages should be ordered by priority (highest first). Got {} before {}",
                    dequeued[i - 1].priority,
                    dequeued[i].priority
                );
            }
        }

        #[test]
        fn property_11_all_priority_levels(
            sender in agent_id_strategy(),
            receiver in agent_id_strategy()
        ) {
            let mut bus = AgentMessageBus::new();
            bus.subscribe(&receiver, vec![]);

            // Send one message of each priority level in reverse order
            let priorities = [
                MessagePriority::Low,
                MessagePriority::Normal,
                MessagePriority::High,
                MessagePriority::Critical,
            ];

            for priority in priorities.iter() {
                let msg = AgentMessage::new(
                    &sender,
                    MessageTarget::Agent(receiver.clone()),
                    "test",
                    json!({"priority": *priority as u8}),
                )
                .with_priority(*priority as u8);
                bus.send(msg).unwrap();
            }

            // Dequeue all messages
            let dequeued = bus.dequeue(&receiver, 4);

            prop_assert_eq!(dequeued.len(), 4, "Should dequeue all 4 messages");

            // Verify order: Critical, High, Normal, Low
            prop_assert_eq!(
                dequeued[0].priority,
                MessagePriority::Critical as u8,
                "First message should be Critical priority"
            );
            prop_assert_eq!(
                dequeued[1].priority,
                MessagePriority::High as u8,
                "Second message should be High priority"
            );
            prop_assert_eq!(
                dequeued[2].priority,
                MessagePriority::Normal as u8,
                "Third message should be Normal priority"
            );
            prop_assert_eq!(
                dequeued[3].priority,
                MessagePriority::Low as u8,
                "Fourth message should be Low priority"
            );
        }

        #[test]
        fn property_11_same_priority_fifo(
            sender in agent_id_strategy(),
            receiver in agent_id_strategy(),
            num_messages in 2usize..10usize,
            priority in priority_strategy()
        ) {
            let mut bus = AgentMessageBus::new();
            bus.subscribe(&receiver, vec![]);

            // Send multiple messages with the same priority
            for i in 0..num_messages {
                let msg = AgentMessage::new(
                    &sender,
                    MessageTarget::Agent(receiver.clone()),
                    "test",
                    json!({"index": i}),
                )
                .with_priority(priority);
                bus.send(msg).unwrap();
            }

            // Dequeue all messages
            let dequeued = bus.dequeue(&receiver, num_messages);

            prop_assert_eq!(
                dequeued.len(),
                num_messages,
                "Should dequeue all messages"
            );

            // All messages should have the same priority
            for msg in &dequeued {
                prop_assert_eq!(
                    msg.priority,
                    priority,
                    "All messages should have the same priority"
                );
            }

            // For same priority, earlier messages should come first (FIFO within priority)
            for i in 1..dequeued.len() {
                prop_assert!(
                    dequeued[i - 1].timestamp <= dequeued[i].timestamp,
                    "Messages with same priority should be ordered by timestamp (FIFO)"
                );
            }
        }

        #[test]
        fn property_11_get_queue_preserves_order(
            sender in agent_id_strategy(),
            receiver in agent_id_strategy(),
            num_messages in 2usize..10usize
        ) {
            let mut bus = AgentMessageBus::new();
            bus.subscribe(&receiver, vec![]);

            // Send messages with different priorities
            for i in 0..num_messages {
                let priority = match i % 4 {
                    0 => MessagePriority::Low as u8,
                    1 => MessagePriority::Normal as u8,
                    2 => MessagePriority::High as u8,
                    _ => MessagePriority::Critical as u8,
                };
                let msg = AgentMessage::new(
                    &sender,
                    MessageTarget::Agent(receiver.clone()),
                    "test",
                    json!({"index": i}),
                )
                .with_priority(priority);
                bus.send(msg).unwrap();
            }

            // Get queue (non-destructive) should also return in priority order
            let queue = bus.get_queue(&receiver);

            prop_assert_eq!(
                queue.len(),
                num_messages,
                "get_queue should return all messages"
            );

            // Verify priority ordering
            for i in 1..queue.len() {
                prop_assert!(
                    queue[i - 1].priority >= queue[i].priority,
                    "get_queue should return messages in priority order"
                );
            }
        }
    }

    // **Property 12: Message Broadcast Delivery**
    //
    // *For any* broadcast message, all agents subscribed to the message type
    // SHALL receive the message.
    //
    // **Validates: Requirements 3.2, 3.7**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_12_broadcast_to_all_subscribers(
            sender in agent_id_strategy(),
            subscribers in agent_set_strategy(2, 8),
            message_type in message_type_strategy()
        ) {
            // Ensure sender is not in subscribers
            let subscribers: Vec<String> = subscribers
                .into_iter()
                .filter(|s| s != &sender)
                .collect();

            if subscribers.is_empty() {
                return Ok(());
            }

            let mut bus = AgentMessageBus::new();

            // Subscribe all agents to the message type
            for agent in &subscribers {
                bus.subscribe(agent, vec![message_type.clone()]);
            }

            // Broadcast a message
            bus.broadcast(&message_type, json!({"data": "test"}), &sender).unwrap();

            // All subscribers should receive the message
            for agent in &subscribers {
                let queue_size = bus.queue_size(agent);
                prop_assert_eq!(
                    queue_size,
                    1,
                    "Agent '{}' should have received exactly 1 message, got {}",
                    agent,
                    queue_size
                );

                let messages = bus.get_queue(agent);
                prop_assert_eq!(
                    messages[0].message_type.clone(),
                    message_type.clone(),
                    "Message type should match"
                );
                prop_assert_eq!(
                    messages[0].from.clone(),
                    sender.clone(),
                    "Sender should match"
                );
            }
        }

        #[test]
        fn property_12_broadcast_excludes_sender(
            sender in agent_id_strategy(),
            other_agents in agent_set_strategy(1, 5),
            message_type in message_type_strategy()
        ) {
            let mut bus = AgentMessageBus::new();

            // Subscribe sender and other agents
            bus.subscribe(&sender, vec![message_type.clone()]);
            for agent in &other_agents {
                if agent != &sender {
                    bus.subscribe(agent, vec![message_type.clone()]);
                }
            }

            // Broadcast a message
            bus.broadcast(&message_type, json!({"data": "test"}), &sender).unwrap();

            // Sender should NOT receive their own broadcast
            prop_assert_eq!(
                bus.queue_size(&sender),
                0,
                "Sender should not receive their own broadcast"
            );
        }

        #[test]
        fn property_12_broadcast_respects_type_subscription(
            sender in agent_id_strategy(),
            subscribed_agents in agent_set_strategy(1, 5),
            unsubscribed_agents in agent_set_strategy(1, 5),
            message_type in message_type_strategy(),
            other_type in message_type_strategy()
        ) {
            // Ensure types are different
            if message_type == other_type {
                return Ok(());
            }

            // Ensure agent sets don't overlap with sender
            let subscribed_agents: Vec<String> = subscribed_agents
                .into_iter()
                .filter(|s| s != &sender)
                .collect();
            let unsubscribed_agents: Vec<String> = unsubscribed_agents
                .into_iter()
                .filter(|s| s != &sender && !subscribed_agents.contains(s))
                .collect();

            if subscribed_agents.is_empty() {
                return Ok(());
            }

            let mut bus = AgentMessageBus::new();

            // Subscribe some agents to the message type
            for agent in &subscribed_agents {
                bus.subscribe(agent, vec![message_type.clone()]);
            }

            // Subscribe other agents to a different type
            for agent in &unsubscribed_agents {
                bus.subscribe(agent, vec![other_type.clone()]);
            }

            // Broadcast a message
            bus.broadcast(&message_type, json!({"data": "test"}), &sender).unwrap();

            // Subscribed agents should receive the message
            for agent in &subscribed_agents {
                prop_assert_eq!(
                    bus.queue_size(agent),
                    1,
                    "Subscribed agent '{}' should receive the broadcast",
                    agent
                );
            }

            // Unsubscribed agents should NOT receive the message
            for agent in &unsubscribed_agents {
                prop_assert_eq!(
                    bus.queue_size(agent),
                    0,
                    "Unsubscribed agent '{}' should not receive the broadcast",
                    agent
                );
            }
        }

        #[test]
        fn property_12_broadcast_to_all_types_subscribers(
            sender in agent_id_strategy(),
            subscribers in agent_set_strategy(1, 5),
            message_type in message_type_strategy()
        ) {
            // Ensure sender is not in subscribers
            let subscribers: Vec<String> = subscribers
                .into_iter()
                .filter(|s| s != &sender)
                .collect();

            if subscribers.is_empty() {
                return Ok(());
            }

            let mut bus = AgentMessageBus::new();

            // Subscribe agents to all types (empty type list)
            for agent in &subscribers {
                bus.subscribe(agent, vec![]); // Empty = all types
            }

            // Broadcast a message
            bus.broadcast(&message_type, json!({"data": "test"}), &sender).unwrap();

            // All subscribers should receive the message regardless of type
            for agent in &subscribers {
                prop_assert_eq!(
                    bus.queue_size(agent),
                    1,
                    "Agent '{}' subscribed to all types should receive the broadcast",
                    agent
                );
            }
        }

        #[test]
        fn property_12_multiple_broadcasts_accumulate(
            sender in agent_id_strategy(),
            receiver in agent_id_strategy(),
            message_type in message_type_strategy(),
            num_broadcasts in 2usize..10usize
        ) {
            if sender == receiver {
                return Ok(());
            }

            let mut bus = AgentMessageBus::new();
            bus.subscribe(&receiver, vec![message_type.clone()]);

            // Send multiple broadcasts
            for i in 0..num_broadcasts {
                bus.broadcast(&message_type, json!({"index": i}), &sender).unwrap();
            }

            // Receiver should have all messages
            prop_assert_eq!(
                bus.queue_size(&receiver),
                num_broadcasts,
                "Receiver should have all {} broadcast messages",
                num_broadcasts
            );
        }

        #[test]
        fn property_12_unsubscribed_agents_dont_receive(
            sender in agent_id_strategy(),
            agent in agent_id_strategy(),
            message_type in message_type_strategy()
        ) {
            if sender == agent {
                return Ok(());
            }

            let mut bus = AgentMessageBus::new();

            // Subscribe then unsubscribe
            bus.subscribe(&agent, vec![message_type.clone()]);
            bus.unsubscribe(&agent);

            // Broadcast a message
            bus.broadcast(&message_type, json!({"data": "test"}), &sender).unwrap();

            // Unsubscribed agent should NOT receive the message
            prop_assert_eq!(
                bus.queue_size(&agent),
                0,
                "Unsubscribed agent should not receive broadcast"
            );
        }
    }
}
