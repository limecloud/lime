//! Property-based tests for Agent Coordinator
//!
//! These tests validate the correctness properties defined in the design document
//! using the proptest framework.
//!
//! **Feature: agents-alignment**

#[cfg(test)]
mod property_tests {
    use crate::agents::communication::coordinator::{
        AgentCapabilities, AgentCoordinator, AgentStatus, AssignmentCriteria, LoadBalanceStrategy,
        Task, TaskResult, TaskStatus,
    };
    use chrono::Utc;
    use proptest::prelude::*;
    use serde_json::json;
    use std::collections::HashSet;

    // Strategy for generating agent IDs
    fn agent_id_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,10}".prop_map(|s| s.to_string())
    }

    // Strategy for generating agent types
    fn agent_type_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("explore".to_string()),
            Just("plan".to_string()),
            Just("code".to_string()),
            Just("worker".to_string()),
        ]
    }

    // Strategy for generating capabilities
    fn capability_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("read".to_string()),
            Just("write".to_string()),
            Just("search".to_string()),
            Just("execute".to_string()),
            Just("analyze".to_string()),
        ]
    }

    // Strategy for generating a list of capabilities
    fn capabilities_list_strategy() -> impl Strategy<Value = Vec<String>> {
        prop::collection::vec(capability_strategy(), 0..5).prop_map(|caps| {
            caps.into_iter()
                .collect::<HashSet<_>>()
                .into_iter()
                .collect()
        })
    }

    // Strategy for generating agent capabilities
    fn agent_capabilities_strategy() -> impl Strategy<Value = AgentCapabilities> {
        (
            agent_id_strategy(),
            agent_type_strategy(),
            capabilities_list_strategy(),
            1usize..10usize,
        )
            .prop_map(|(id, agent_type, caps, max_tasks)| {
                AgentCapabilities::new(id, agent_type)
                    .with_capabilities(caps)
                    .with_max_concurrent_tasks(max_tasks)
            })
    }

    // Strategy for generating unique agent capabilities
    fn unique_agents_strategy(count: usize) -> impl Strategy<Value = Vec<AgentCapabilities>> {
        prop::collection::vec(agent_capabilities_strategy(), count..count + 1).prop_map(|agents| {
            let mut seen = HashSet::new();
            agents
                .into_iter()
                .filter(|a| seen.insert(a.agent_id.clone()))
                .collect()
        })
    }

    // Strategy for generating task types
    fn task_type_strategy() -> impl Strategy<Value = String> {
        prop_oneof![
            Just("search".to_string()),
            Just("analyze".to_string()),
            Just("transform".to_string()),
            Just("validate".to_string()),
        ]
    }

    // Strategy for generating tasks
    fn task_strategy() -> impl Strategy<Value = Task> {
        (task_type_strategy(), 0u8..10u8).prop_map(|(task_type, priority)| {
            Task::new(task_type, json!({})).with_priority(priority)
        })
    }

    // Strategy for generating load balance strategies
    fn load_balance_strategy_strategy() -> impl Strategy<Value = LoadBalanceStrategy> {
        prop_oneof![
            Just(LoadBalanceStrategy::LeastBusy),
            Just(LoadBalanceStrategy::RoundRobin),
            Just(LoadBalanceStrategy::Random),
            Just(LoadBalanceStrategy::CapabilityMatch),
        ]
    }

    // Strategy for generating resource names
    fn resource_strategy() -> impl Strategy<Value = String> {
        "[a-z][a-z0-9_]{0,10}".prop_map(|s| format!("resource_{}", s))
    }

    // **Property 18: Agent Selection by Criteria**
    //
    // *For any* set of registered agents and assignment criteria,
    // the selected agent SHALL match all required criteria (type, capabilities).
    //
    // **Validates: Requirements 5.1, 5.2, 5.3**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_18_selected_agent_matches_type_criteria(
            agents in unique_agents_strategy(5),
            required_type in agent_type_strategy()
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Register all agents
            for agent in &agents {
                let _ = coordinator.register_agent(agent.clone());
            }

            // Check if any agent matches the type
            let matching_agents: Vec<_> = agents
                .iter()
                .filter(|a| a.agent_type == required_type && a.can_accept_task())
                .collect();

            let task = Task::new("test", json!({}));
            let criteria = AssignmentCriteria::new().with_agent_type(&required_type);

            let result = coordinator.assign_task(task, &criteria);

            if matching_agents.is_empty() {
                // Should fail if no matching agent
                prop_assert!(result.is_err());
            } else {
                // Should succeed and select a matching agent
                prop_assert!(result.is_ok());
                let selected_id = result.unwrap();
                let selected = coordinator.get_agent(&selected_id).unwrap();
                prop_assert_eq!(&selected.agent_type, &required_type);
            }
        }

        #[test]
        fn property_18_selected_agent_has_required_capabilities(
            agents in unique_agents_strategy(5),
            required_caps in capabilities_list_strategy()
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Register all agents
            for agent in &agents {
                let _ = coordinator.register_agent(agent.clone());
            }

            // Check if any agent has all required capabilities
            let matching_agents: Vec<_> = agents
                .iter()
                .filter(|a| a.has_all_capabilities(&required_caps) && a.can_accept_task())
                .collect();

            let task = Task::new("test", json!({}));
            let criteria = AssignmentCriteria::new().with_capabilities(required_caps.clone());

            let result = coordinator.assign_task(task, &criteria);

            if matching_agents.is_empty() {
                // Should fail if no matching agent
                prop_assert!(result.is_err());
            } else {
                // Should succeed and select a matching agent
                prop_assert!(result.is_ok());
                let selected_id = result.unwrap();
                let selected = coordinator.get_agent(&selected_id).unwrap();
                prop_assert!(selected.has_all_capabilities(&required_caps));
            }
        }

        #[test]
        fn property_18_least_busy_selects_lowest_load(
            num_agents in 2usize..5usize
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Create agents with different loads
            for i in 0..num_agents {
                let mut agent = AgentCapabilities::new(format!("agent{}", i), "worker")
                    .with_max_concurrent_tasks(10);
                agent.current_tasks = i; // Different loads
                agent.update_load();
                coordinator.register_agent(agent).unwrap();
            }

            let task = Task::new("test", json!({}));
            let criteria = AssignmentCriteria::new()
                .with_strategy(LoadBalanceStrategy::LeastBusy);

            let selected_id = coordinator.assign_task(task, &criteria).unwrap();

            // Should select agent0 (lowest load)
            prop_assert_eq!(selected_id, "agent0");
        }

        #[test]
        fn property_18_round_robin_distributes_tasks(
            num_tasks in 3usize..10usize
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Create 3 agents
            for i in 0..3 {
                let agent = AgentCapabilities::new(format!("agent{}", i), "worker")
                    .with_max_concurrent_tasks(100);
                coordinator.register_agent(agent).unwrap();
            }

            let criteria = AssignmentCriteria::new()
                .with_strategy(LoadBalanceStrategy::RoundRobin);

            let mut assignments = Vec::new();
            for _ in 0..num_tasks {
                let task = Task::new("test", json!({}));
                let selected_id = coordinator.assign_task(task, &criteria).unwrap();
                assignments.push(selected_id);
            }

            // Check that tasks are distributed (not all to same agent)
            let unique_agents: HashSet<_> = assignments.iter().collect();
            prop_assert!(unique_agents.len() > 1);
        }

        #[test]
        fn property_18_busy_agent_not_selected(
            agent_id in agent_id_strategy()
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Create a busy agent (at max capacity)
            let mut busy_agent = AgentCapabilities::new(&agent_id, "worker")
                .with_max_concurrent_tasks(1);
            busy_agent.current_tasks = 1;
            busy_agent.update_load();
            coordinator.register_agent(busy_agent).unwrap();

            // Create an available agent
            let available_agent = AgentCapabilities::new("available", "worker")
                .with_max_concurrent_tasks(5);
            coordinator.register_agent(available_agent).unwrap();

            let task = Task::new("test", json!({}));
            let criteria = AssignmentCriteria::new();

            let selected_id = coordinator.assign_task(task, &criteria).unwrap();

            // Should not select the busy agent
            prop_assert_eq!(selected_id, "available");
        }

        #[test]
        fn property_18_offline_agent_not_selected(
            agent_id in agent_id_strategy()
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Create an offline agent
            let mut offline_agent = AgentCapabilities::new(&agent_id, "worker")
                .with_max_concurrent_tasks(5);
            offline_agent.status = AgentStatus::Offline;
            coordinator.register_agent(offline_agent).unwrap();

            // Create an available agent
            let available_agent = AgentCapabilities::new("available", "worker")
                .with_max_concurrent_tasks(5);
            coordinator.register_agent(available_agent).unwrap();

            let task = Task::new("test", json!({}));
            let criteria = AssignmentCriteria::new();

            let selected_id = coordinator.assign_task(task, &criteria).unwrap();

            // Should not select the offline agent
            prop_assert_eq!(selected_id, "available");
        }
    }

    // **Property 19: Deadlock Detection Accuracy**
    //
    // *For any* circular wait scenario in resource dependencies,
    // the deadlock detector SHALL identify the cycle.
    //
    // **Validates: Requirements 5.4**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        #[test]
        fn property_19_detects_simple_deadlock(
            agent1 in agent_id_strategy(),
            agent2 in agent_id_strategy(),
            resource1 in resource_strategy(),
            resource2 in resource_strategy()
        ) {
            prop_assume!(agent1 != agent2);
            prop_assume!(resource1 != resource2);

            let mut coordinator = AgentCoordinator::new();

            // Create circular wait:
            // agent1 holds resource1, waits for resource2
            // agent2 holds resource2, waits for resource1
            coordinator.record_resource_holder(&resource1, &agent1);
            coordinator.record_resource_holder(&resource2, &agent2);
            coordinator.record_resource_dependency(&agent1, &resource2);
            coordinator.record_resource_dependency(&agent2, &resource1);

            let deadlock = coordinator.detect_deadlock();
            prop_assert!(deadlock.is_some());

            let info = deadlock.unwrap();
            prop_assert!(info.involved_agents.contains(&agent1));
            prop_assert!(info.involved_agents.contains(&agent2));
        }

        #[test]
        fn property_19_no_false_positive_linear_wait(
            agents in prop::collection::vec(agent_id_strategy(), 2..5),
            resources in prop::collection::vec(resource_strategy(), 2..5)
        ) {
            // Ensure unique agents and resources
            let agents: Vec<_> = agents.into_iter().collect::<HashSet<_>>().into_iter().collect();
            let resources: Vec<_> = resources.into_iter().collect::<HashSet<_>>().into_iter().collect();

            prop_assume!(agents.len() >= 2);
            prop_assume!(resources.len() >= 2);

            let mut coordinator = AgentCoordinator::new();

            // Create linear wait chain (no cycle):
            // agent0 holds resource0
            // agent1 waits for resource0, holds resource1
            // agent2 waits for resource1, holds resource2
            // ...
            for i in 0..agents.len().min(resources.len()) {
                coordinator.record_resource_holder(&resources[i], &agents[i]);
                if i > 0 {
                    coordinator.record_resource_dependency(&agents[i], &resources[i - 1]);
                }
            }

            let deadlock = coordinator.detect_deadlock();
            prop_assert!(deadlock.is_none());
        }

        #[test]
        fn property_19_detects_three_way_deadlock(
            agent1 in agent_id_strategy(),
            agent2 in agent_id_strategy(),
            agent3 in agent_id_strategy(),
            resource1 in resource_strategy(),
            resource2 in resource_strategy(),
            resource3 in resource_strategy()
        ) {
            prop_assume!(agent1 != agent2 && agent2 != agent3 && agent1 != agent3);
            prop_assume!(resource1 != resource2 && resource2 != resource3 && resource1 != resource3);

            let mut coordinator = AgentCoordinator::new();

            // Create 3-way circular wait:
            // agent1 holds resource1, waits for resource2
            // agent2 holds resource2, waits for resource3
            // agent3 holds resource3, waits for resource1
            coordinator.record_resource_holder(&resource1, &agent1);
            coordinator.record_resource_holder(&resource2, &agent2);
            coordinator.record_resource_holder(&resource3, &agent3);

            coordinator.record_resource_dependency(&agent1, &resource2);
            coordinator.record_resource_dependency(&agent2, &resource3);
            coordinator.record_resource_dependency(&agent3, &resource1);

            let deadlock = coordinator.detect_deadlock();
            prop_assert!(deadlock.is_some());

            let info = deadlock.unwrap();
            prop_assert!(info.involved_agents.len() >= 2);
        }

        #[test]
        fn property_19_no_deadlock_when_no_dependencies(
            agents in unique_agents_strategy(3),
            resources in prop::collection::vec(resource_strategy(), 1..5)
        ) {
            let mut coordinator = AgentCoordinator::new();

            // Register agents
            for agent in &agents {
                let _ = coordinator.register_agent(agent.clone());
            }

            // Only record holders, no dependencies
            for (i, resource) in resources.iter().enumerate() {
                if i < agents.len() {
                    coordinator.record_resource_holder(resource, &agents[i].agent_id);
                }
            }

            let deadlock = coordinator.detect_deadlock();
            prop_assert!(deadlock.is_none());
        }
    }

    // **Property 20: Task Completion Tracking**
    //
    // *For any* task that is assigned and completed,
    // the coordinator SHALL correctly track its status and update agent load.
    //
    // **Validates: Requirements 5.5, 5.6, 5.7**
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(100))]

        #[test]
        fn property_20_task_status_transitions(
            task_type in task_type_strategy(),
            success in any::<bool>()
        ) {
            let mut coordinator = AgentCoordinator::new();

            let agent = AgentCapabilities::new("agent1", "worker")
                .with_max_concurrent_tasks(5);
            coordinator.register_agent(agent).unwrap();

            let task = Task::new(&task_type, json!({})).with_id("task1");
            let criteria = AssignmentCriteria::new();

            // Assign task
            coordinator.assign_task(task, &criteria).unwrap();
            let (_, status) = coordinator.get_task("task1").unwrap();
            prop_assert_eq!(status, TaskStatus::Assigned);

            // Start task
            coordinator.start_task("task1").unwrap();
            let (_, status) = coordinator.get_task("task1").unwrap();
            prop_assert_eq!(status, TaskStatus::Running);

            // Complete task
            let result = TaskResult {
                task_id: "task1".to_string(),
                agent_id: "agent1".to_string(),
                success,
                result: if success { Some(json!({"output": "done"})) } else { None },
                error: if success { None } else { Some("error".to_string()) },
                start_time: Utc::now(),
                end_time: Utc::now(),
                duration_ms: 100,
            };
            coordinator.complete_task("task1", result).unwrap();

            let (_, status) = coordinator.get_task("task1").unwrap();
            if success {
                prop_assert_eq!(status, TaskStatus::Completed);
            } else {
                prop_assert_eq!(status, TaskStatus::Failed);
            }
        }

        #[test]
        fn property_20_agent_load_updated_on_assignment(
            num_tasks in 1usize..5usize
        ) {
            let mut coordinator = AgentCoordinator::new();

            let agent = AgentCapabilities::new("agent1", "worker")
                .with_max_concurrent_tasks(10);
            coordinator.register_agent(agent).unwrap();

            let criteria = AssignmentCriteria::new();

            for i in 0..num_tasks {
                let task = Task::new("test", json!({})).with_id(format!("task{}", i));
                coordinator.assign_task(task, &criteria).unwrap();

                let agent = coordinator.get_agent("agent1").unwrap();
                prop_assert_eq!(agent.current_tasks, i + 1);
                prop_assert!((agent.current_load - (i + 1) as f64 / 10.0).abs() < 0.001);
            }
        }

        #[test]
        fn property_20_agent_load_updated_on_completion(
            num_tasks in 2usize..5usize
        ) {
            let mut coordinator = AgentCoordinator::new();

            let agent = AgentCapabilities::new("agent1", "worker")
                .with_max_concurrent_tasks(10);
            coordinator.register_agent(agent).unwrap();

            let criteria = AssignmentCriteria::new();

            // Assign multiple tasks
            for i in 0..num_tasks {
                let task = Task::new("test", json!({})).with_id(format!("task{}", i));
                coordinator.assign_task(task, &criteria).unwrap();
            }

            // Complete tasks one by one
            for i in 0..num_tasks {
                let task_id = format!("task{}", i);
                coordinator.start_task(&task_id).unwrap();

                let result = TaskResult {
                    task_id: task_id.clone(),
                    agent_id: "agent1".to_string(),
                    success: true,
                    result: Some(json!({})),
                    error: None,
                    start_time: Utc::now(),
                    end_time: Utc::now(),
                    duration_ms: 100,
                };
                coordinator.complete_task(&task_id, result).unwrap();

                let agent = coordinator.get_agent("agent1").unwrap();
                let expected_tasks = num_tasks - i - 1;
                prop_assert_eq!(agent.current_tasks, expected_tasks);
            }

            // Final load should be 0
            let agent = coordinator.get_agent("agent1").unwrap();
            prop_assert_eq!(agent.current_tasks, 0);
            prop_assert_eq!(agent.current_load, 0.0);
        }

        #[test]
        fn property_20_stats_reflect_task_state(
            num_tasks in 1usize..5usize
        ) {
            let mut coordinator = AgentCoordinator::new();

            let agent = AgentCapabilities::new("agent1", "worker")
                .with_max_concurrent_tasks(10);
            coordinator.register_agent(agent).unwrap();

            let criteria = AssignmentCriteria::new();

            // Assign tasks
            for i in 0..num_tasks {
                let task = Task::new("test", json!({})).with_id(format!("task{}", i));
                coordinator.assign_task(task, &criteria).unwrap();
            }

            let stats = coordinator.get_stats();
            prop_assert_eq!(stats.total_tasks, num_tasks);
            prop_assert_eq!(stats.pending_tasks, num_tasks);
            prop_assert_eq!(stats.running_tasks, 0);
            prop_assert_eq!(stats.completed_tasks, 0);

            // Start first task
            coordinator.start_task("task0").unwrap();
            let stats = coordinator.get_stats();
            prop_assert_eq!(stats.pending_tasks, num_tasks - 1);
            prop_assert_eq!(stats.running_tasks, 1);

            // Complete first task
            let result = TaskResult {
                task_id: "task0".to_string(),
                agent_id: "agent1".to_string(),
                success: true,
                result: Some(json!({})),
                error: None,
                start_time: Utc::now(),
                end_time: Utc::now(),
                duration_ms: 100,
            };
            coordinator.complete_task("task0", result).unwrap();

            let stats = coordinator.get_stats();
            prop_assert_eq!(stats.running_tasks, 0);
            prop_assert_eq!(stats.completed_tasks, 1);
        }
    }

    // Additional property tests for synchronization barriers
    proptest! {
        #![proptest_config(ProptestConfig::with_cases(50))]

        #[test]
        fn property_sync_barrier_requires_all_agents(
            agents in prop::collection::vec(agent_id_strategy(), 2..5)
        ) {
            let agents: Vec<_> = agents.into_iter().collect::<HashSet<_>>().into_iter().collect();
            prop_assume!(agents.len() >= 2);

            let mut coordinator = AgentCoordinator::new();

            let barrier_id = coordinator.create_sync_barrier(agents.clone());

            // Arrive with all but one agent
            for agent in agents.iter().take(agents.len() - 1) {
                let all_arrived = coordinator.arrive_at_barrier(&barrier_id, agent).unwrap();
                prop_assert!(!all_arrived);
                prop_assert!(!coordinator.is_barrier_reached(&barrier_id));
            }

            // Last agent arrives
            let all_arrived = coordinator
                .arrive_at_barrier(&barrier_id, agents.last().unwrap())
                .unwrap();
            prop_assert!(all_arrived);
            prop_assert!(coordinator.is_barrier_reached(&barrier_id));
        }

        #[test]
        fn property_pending_agents_decreases(
            agents in prop::collection::vec(agent_id_strategy(), 2..5)
        ) {
            let agents: Vec<_> = agents.into_iter().collect::<HashSet<_>>().into_iter().collect();
            prop_assume!(agents.len() >= 2);

            let mut coordinator = AgentCoordinator::new();

            let barrier_id = coordinator.create_sync_barrier(agents.clone());

            let initial_pending = coordinator.get_pending_agents(&barrier_id);
            prop_assert_eq!(initial_pending.len(), agents.len());

            for (i, agent) in agents.iter().enumerate() {
                coordinator.arrive_at_barrier(&barrier_id, agent).unwrap();
                let pending = coordinator.get_pending_agents(&barrier_id);
                prop_assert_eq!(pending.len(), agents.len() - i - 1);
            }
        }
    }
}
