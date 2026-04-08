//! 蓝图系统测试
//!
//! 测试蓝图管理器、任务树管理器、时光倒流、边界检查等核心功能
//!
//! 测试覆盖：
//! - 蓝图生命周期管理
//! - 任务树生成和执行
//! - 检查点和回滚
//! - 边界检查
//! - 类型序列化

use super::*;

// ============================================================================
// 蓝图管理器测试
// ============================================================================

#[cfg(test)]
mod blueprint_manager_tests {
    use super::*;

    #[tokio::test]
    async fn test_create_blueprint() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试蓝图".to_string(), "测试描述".to_string())
            .await
            .unwrap();

        assert_eq!(bp.name, "测试蓝图");
        assert_eq!(bp.description, "测试描述");
        assert_eq!(bp.status, BlueprintStatus::Draft);
        assert!(!bp.id.is_empty());
        assert_eq!(bp.version, "1.0.0");
    }

    #[tokio::test]
    async fn test_single_blueprint_constraint() {
        let manager = BlueprintManager::default();

        let bp1 = manager
            .create_blueprint("蓝图1".to_string(), "描述1".to_string())
            .await
            .unwrap();

        // 再次创建应该返回同一个蓝图（因为是 draft 状态）
        let bp2 = manager
            .create_blueprint("蓝图2".to_string(), "描述2".to_string())
            .await
            .unwrap();

        assert_eq!(bp1.id, bp2.id);
        assert_eq!(bp2.name, "蓝图2");
    }

    #[tokio::test]
    async fn test_add_business_process() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        let process = BusinessProcess {
            id: String::new(),
            name: "用户注册流程".to_string(),
            description: "新用户注册".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![ProcessStep {
                id: "step1".to_string(),
                order: 1,
                name: "填写信息".to_string(),
                description: "用户填写注册信息".to_string(),
                actor: "用户".to_string(),
                system_action: None,
                user_action: Some("填写表单".to_string()),
                conditions: Vec::new(),
                outcomes: vec!["注册信息".to_string()],
            }],
            actors: vec!["用户".to_string()],
            inputs: vec!["用户信息".to_string()],
            outputs: vec!["用户账号".to_string()],
        };

        let added = manager.add_business_process(&bp.id, process).await.unwrap();
        assert!(!added.id.is_empty());
        assert_eq!(added.name, "用户注册流程");

        let updated_bp = manager.get_blueprint(&bp.id).await.unwrap();
        assert_eq!(updated_bp.business_processes.len(), 1);
    }

    #[tokio::test]
    async fn test_add_module() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        let module = SystemModule {
            id: String::new(),
            name: "用户服务".to_string(),
            description: "用户管理服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["用户注册".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/user".to_string()),
        };

        let added = manager.add_module(&bp.id, module).await.unwrap();
        assert!(!added.id.is_empty());
        assert_eq!(added.name, "用户服务");
    }

    #[tokio::test]
    async fn test_add_nfr() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        let nfr = NonFunctionalRequirement {
            id: String::new(),
            category: NfrCategory::Performance,
            name: "响应时间".to_string(),
            description: "API 响应时间小于 200ms".to_string(),
            metric: Some("< 200ms".to_string()),
            priority: MoscowPriority::Must,
        };

        let added = manager.add_nfr(&bp.id, nfr).await.unwrap();
        assert!(!added.id.is_empty());
        assert_eq!(added.name, "响应时间");
    }

    #[tokio::test]
    async fn test_blueprint_lifecycle() {
        let manager = BlueprintManager::default();

        // 创建蓝图
        let bp = manager
            .create_blueprint("测试蓝图".to_string(), "测试描述".to_string())
            .await
            .unwrap();
        assert_eq!(bp.status, BlueprintStatus::Draft);

        // 添加业务流程
        let process = BusinessProcess {
            id: String::new(),
            name: "用户注册流程".to_string(),
            description: "新用户注册".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![ProcessStep {
                id: "step1".to_string(),
                order: 1,
                name: "填写信息".to_string(),
                description: "用户填写注册信息".to_string(),
                actor: "用户".to_string(),
                system_action: None,
                user_action: Some("填写表单".to_string()),
                conditions: Vec::new(),
                outcomes: vec!["注册信息".to_string()],
            }],
            actors: vec!["用户".to_string()],
            inputs: vec!["用户信息".to_string()],
            outputs: vec!["用户账号".to_string()],
        };
        manager.add_business_process(&bp.id, process).await.unwrap();

        // 添加系统模块
        let module = SystemModule {
            id: String::new(),
            name: "用户服务".to_string(),
            description: "用户管理服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["用户注册".to_string(), "用户认证".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/user".to_string()),
        };
        manager.add_module(&bp.id, module).await.unwrap();

        // 获取更新后的蓝图
        let updated_bp = manager.get_blueprint(&bp.id).await.unwrap();
        assert_eq!(updated_bp.business_processes.len(), 1);
        assert_eq!(updated_bp.modules.len(), 1);
    }

    #[tokio::test]
    async fn test_submit_for_review_validation() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        // 没有业务流程和模块，提交审核应该失败
        let result = manager.submit_for_review(&bp.id).await;
        assert!(result.is_err());
    }

    #[tokio::test]
    async fn test_approve_blueprint() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        // 添加必要内容
        let process = BusinessProcess {
            id: String::new(),
            name: "流程".to_string(),
            description: "描述".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![ProcessStep {
                id: "s1".to_string(),
                order: 1,
                name: "步骤".to_string(),
                description: "描述".to_string(),
                actor: "用户".to_string(),
                system_action: None,
                user_action: None,
                conditions: Vec::new(),
                outcomes: Vec::new(),
            }],
            actors: vec!["用户".to_string()],
            inputs: Vec::new(),
            outputs: Vec::new(),
        };
        manager.add_business_process(&bp.id, process).await.unwrap();

        let module = SystemModule {
            id: String::new(),
            name: "模块".to_string(),
            description: "描述".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["职责".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: None,
            root_path: None,
        };
        manager.add_module(&bp.id, module).await.unwrap();

        // 提交审核
        let reviewed = manager.submit_for_review(&bp.id).await.unwrap();
        assert_eq!(reviewed.status, BlueprintStatus::Review);

        // 批准
        let approved = manager
            .approve_blueprint(&bp.id, Some("admin".to_string()))
            .await
            .unwrap();
        assert_eq!(approved.status, BlueprintStatus::Approved);
        assert!(approved.approved_at.is_some());
        assert_eq!(approved.approved_by, Some("admin".to_string()));
    }

    #[tokio::test]
    async fn test_reject_blueprint() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        // 添加必要内容并提交审核
        let process = BusinessProcess {
            id: String::new(),
            name: "流程".to_string(),
            description: "描述".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![ProcessStep {
                id: "s1".to_string(),
                order: 1,
                name: "步骤".to_string(),
                description: "描述".to_string(),
                actor: "用户".to_string(),
                system_action: None,
                user_action: None,
                conditions: Vec::new(),
                outcomes: Vec::new(),
            }],
            actors: vec!["用户".to_string()],
            inputs: Vec::new(),
            outputs: Vec::new(),
        };
        manager.add_business_process(&bp.id, process).await.unwrap();

        let module = SystemModule {
            id: String::new(),
            name: "模块".to_string(),
            description: "描述".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["职责".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: None,
            root_path: None,
        };
        manager.add_module(&bp.id, module).await.unwrap();

        manager.submit_for_review(&bp.id).await.unwrap();

        // 拒绝
        let rejected = manager.reject_blueprint(&bp.id, "需要修改").await.unwrap();
        assert_eq!(rejected.status, BlueprintStatus::Draft);
    }

    #[tokio::test]
    async fn test_execution_lifecycle() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        // 添加必要内容
        let process = BusinessProcess {
            id: String::new(),
            name: "流程".to_string(),
            description: "描述".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![ProcessStep {
                id: "s1".to_string(),
                order: 1,
                name: "步骤".to_string(),
                description: "描述".to_string(),
                actor: "用户".to_string(),
                system_action: None,
                user_action: None,
                conditions: Vec::new(),
                outcomes: Vec::new(),
            }],
            actors: vec!["用户".to_string()],
            inputs: Vec::new(),
            outputs: Vec::new(),
        };
        manager.add_business_process(&bp.id, process).await.unwrap();

        let module = SystemModule {
            id: String::new(),
            name: "模块".to_string(),
            description: "描述".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["职责".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: None,
            root_path: None,
        };
        manager.add_module(&bp.id, module).await.unwrap();

        // 提交并批准
        manager.submit_for_review(&bp.id).await.unwrap();
        manager.approve_blueprint(&bp.id, None).await.unwrap();

        // 开始执行
        let executing = manager
            .start_execution(&bp.id, "tree-1".to_string())
            .await
            .unwrap();
        assert_eq!(executing.status, BlueprintStatus::Executing);
        assert_eq!(executing.task_tree_id, Some("tree-1".to_string()));

        // 暂停
        let paused = manager.pause_execution(&bp.id).await.unwrap();
        assert_eq!(paused.status, BlueprintStatus::Paused);

        // 恢复
        let resumed = manager.resume_execution(&bp.id).await.unwrap();
        assert_eq!(resumed.status, BlueprintStatus::Executing);

        // 完成
        let completed = manager.complete_execution(&bp.id).await.unwrap();
        assert_eq!(completed.status, BlueprintStatus::Completed);
    }

    #[tokio::test]
    async fn test_get_blueprints_by_status() {
        let manager = BlueprintManager::default();
        manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        let drafts = manager
            .get_blueprints_by_status(BlueprintStatus::Draft)
            .await;
        assert_eq!(drafts.len(), 1);

        let approved = manager
            .get_blueprints_by_status(BlueprintStatus::Approved)
            .await;
        assert!(approved.is_empty());
    }

    #[tokio::test]
    async fn test_delete_blueprint() {
        let manager = BlueprintManager::default();
        let bp = manager
            .create_blueprint("测试".to_string(), "描述".to_string())
            .await
            .unwrap();

        let deleted = manager.delete_blueprint(&bp.id).await.unwrap();
        assert!(deleted);

        let not_found = manager.get_blueprint(&bp.id).await;
        assert!(not_found.is_none());
    }

    #[tokio::test]
    async fn test_generate_blueprint_summary() {
        let mut bp = Blueprint::new("测试项目".to_string(), "项目描述".to_string());

        bp.business_processes.push(BusinessProcess {
            id: "p1".to_string(),
            name: "流程1".to_string(),
            description: "描述".to_string(),
            process_type: ProcessType::ToBe,
            steps: vec![],
            actors: vec![],
            inputs: vec![],
            outputs: vec![],
        });

        bp.modules.push(SystemModule {
            id: "m1".to_string(),
            name: "模块1".to_string(),
            description: "描述".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["职责1".to_string()],
            dependencies: vec![],
            interfaces: vec![],
            tech_stack: None,
            root_path: None,
        });

        let summary = generate_blueprint_summary(&bp);
        assert!(summary.contains("测试项目"));
        assert!(summary.contains("流程1"));
        assert!(summary.contains("模块1"));
    }
}

// ============================================================================
// 任务树管理器测试
// ============================================================================

#[cfg(test)]
mod task_tree_manager_tests {
    use super::*;
    use uuid::Uuid;

    fn create_test_blueprint() -> Blueprint {
        let mut bp = Blueprint::new("测试项目".to_string(), "测试描述".to_string());

        bp.modules.push(SystemModule {
            id: Uuid::new_v4().to_string(),
            name: "后端模块".to_string(),
            description: "后端服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["用户认证".to_string(), "数据存储".to_string()],
            dependencies: Vec::new(),
            interfaces: Vec::new(),
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/backend".to_string()),
        });

        bp.modules.push(SystemModule {
            id: Uuid::new_v4().to_string(),
            name: "前端模块".to_string(),
            description: "前端 UI".to_string(),
            module_type: ModuleType::Frontend,
            responsibilities: vec!["用户界面".to_string()],
            dependencies: vec![bp.modules[0].id.clone()],
            interfaces: Vec::new(),
            tech_stack: Some(vec!["TypeScript".to_string()]),
            root_path: Some("src/frontend".to_string()),
        });

        bp
    }

    #[tokio::test]
    async fn test_generate_from_blueprint() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();

        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        assert_eq!(tree.blueprint_id, blueprint.id);
        assert!(!tree.root.children.is_empty());
        assert!(tree.stats.total_tasks > 0);
        assert_eq!(tree.status, TaskTreeStatus::Pending);
    }

    #[tokio::test]
    async fn test_task_status_update() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let updated = manager
                .update_task_status(&tree.id, &leaf.id, TaskStatus::Coding)
                .await
                .unwrap();

            assert_eq!(updated.status, TaskStatus::Coding);
            assert!(updated.started_at.is_some());
        }
    }

    #[tokio::test]
    async fn test_task_completion() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let updated = manager
                .update_task_status(&tree.id, &leaf.id, TaskStatus::Passed)
                .await
                .unwrap();

            assert_eq!(updated.status, TaskStatus::Passed);
            assert!(updated.completed_at.is_some());
        }
    }

    #[tokio::test]
    async fn test_can_start_task() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let (can_start, blockers) = manager.can_start_task(&tree.id, &leaf.id).await;
            // 叶子任务如果没有依赖应该可以开始
            if leaf.dependencies.is_empty() {
                assert!(can_start);
                assert!(blockers.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn test_get_executable_tasks() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let executable = manager.get_executable_tasks(&tree.id).await;
        assert!(!executable.is_empty());

        // 可执行任务应该按优先级排序
        for i in 1..executable.len() {
            assert!(executable[i - 1].priority >= executable[i].priority);
        }
    }

    #[tokio::test]
    async fn test_get_leaf_tasks() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        assert!(!leaves.is_empty());

        // 叶子任务不应该有子任务
        for leaf in &leaves {
            assert!(leaf.children.is_empty());
        }
    }

    #[tokio::test]
    async fn test_get_task_path() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let path = manager.get_task_path(&tree.id, &leaf.id).await;
            assert!(!path.is_empty());
            assert_eq!(path.last().unwrap().id, leaf.id);
        }
    }

    #[tokio::test]
    async fn test_add_sub_task() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let parent_id = tree.root.id.clone();
        let new_task = manager
            .add_sub_task(
                &tree.id,
                &parent_id,
                "新子任务".to_string(),
                "描述".to_string(),
                50,
            )
            .await
            .unwrap();

        assert_eq!(new_task.name, "新子任务");
        assert_eq!(new_task.parent_id, Some(parent_id));
        assert_eq!(new_task.priority, 50);
    }

    #[tokio::test]
    async fn test_create_task_checkpoint() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let leaves = manager.get_leaf_tasks(&tree.id).await;
        if let Some(leaf) = leaves.first() {
            let checkpoint = manager
                .create_task_checkpoint(
                    &tree.id,
                    &leaf.id,
                    "测试检查点".to_string(),
                    Some("描述".to_string()),
                )
                .await
                .unwrap();

            assert_eq!(checkpoint.name, "测试检查点");
            assert_eq!(checkpoint.task_id, leaf.id);
            assert!(checkpoint.can_restore);
        }
    }

    #[tokio::test]
    async fn test_create_global_checkpoint() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        let checkpoint = manager
            .create_global_checkpoint(&tree.id, "全局检查点".to_string(), Some("描述".to_string()))
            .await
            .unwrap();

        assert_eq!(checkpoint.name, "全局检查点");
        assert_eq!(checkpoint.tree_id, tree.id);
        assert!(checkpoint.can_restore);
    }

    #[tokio::test]
    async fn test_calculate_stats() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();
        let tree = manager.generate_from_blueprint(&blueprint).await.unwrap();

        assert!(tree.stats.total_tasks > 0);
        assert!(tree.stats.pending_tasks > 0);
        assert_eq!(tree.stats.passed_tasks, 0);
        assert!(tree.stats.max_depth > 0);
    }

    #[tokio::test]
    async fn test_set_current_blueprint() {
        let manager = TaskTreeManager::default();
        let blueprint = create_test_blueprint();

        manager.set_current_blueprint(blueprint.clone()).await;
        let current = manager.get_current_blueprint().await;

        assert!(current.is_some());
        assert_eq!(current.unwrap().id, blueprint.id);
    }
}

// ============================================================================
// 时光倒流测试
// ============================================================================

#[cfg(test)]
mod time_travel_tests {
    use super::*;

    fn create_test_tree() -> TaskTree {
        let mut root = TaskNode::new("根任务".to_string(), "描述".to_string(), 0);

        let mut child = TaskNode::new("子任务".to_string(), "描述".to_string(), 1);
        child.parent_id = Some(root.id.clone());

        // 添加检查点
        child.checkpoints.push(Checkpoint {
            id: "cp1".to_string(),
            task_id: child.id.clone(),
            timestamp: chrono::Utc::now(),
            name: "检查点1".to_string(),
            description: Some("描述".to_string()),
            task_status: TaskStatus::Coding,
            test_result: None,
            code_snapshot: vec![],
            can_restore: true,
            metadata: None,
        });

        root.children.push(child);

        let mut tree = TaskTree::new("bp-1".to_string(), root);
        tree.global_checkpoints.push(GlobalCheckpoint {
            id: "gcp1".to_string(),
            tree_id: tree.id.clone(),
            timestamp: chrono::Utc::now(),
            name: "全局检查点".to_string(),
            description: None,
            tree_snapshot: "{}".to_string(),
            file_changes: vec![],
            can_restore: true,
        });

        tree
    }

    #[test]
    fn test_time_travel_manager_creation() {
        let manager = TimeTravelManager::new();
        assert_eq!(manager.get_current_branch(), "main");
        assert!(manager.get_branches().is_empty());
    }

    #[test]
    fn test_get_all_checkpoints() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        let checkpoints = manager.get_all_checkpoints(&tree);
        assert!(!checkpoints.is_empty());

        // 应该包含全局和任务检查点
        let has_global = checkpoints
            .iter()
            .any(|c| c.checkpoint_type == CheckpointType::Global);
        let has_task = checkpoints
            .iter()
            .any(|c| c.checkpoint_type == CheckpointType::Task);
        assert!(has_global);
        assert!(has_task);
    }

    #[test]
    fn test_get_timeline_view() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        let timeline = manager.get_timeline_view(&tree);
        assert!(!timeline.checkpoints.is_empty());
    }

    #[test]
    fn test_get_checkpoint_details() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        // 获取全局检查点详情
        let details = manager.get_checkpoint_details(&tree, "gcp1");
        assert!(details.is_some());
        assert_eq!(details.unwrap().checkpoint.name, "全局检查点");

        // 获取任务检查点详情
        let details = manager.get_checkpoint_details(&tree, "cp1");
        assert!(details.is_some());
        assert_eq!(details.unwrap().checkpoint.name, "检查点1");
    }

    #[test]
    fn test_compare_checkpoints() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        let result = manager.compare_checkpoints(&tree, "gcp1", "cp1");
        assert!(result.is_ok());
    }

    #[test]
    fn test_generate_checkpoint_tree() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        let output = manager.generate_checkpoint_tree(&tree);
        assert!(output.contains("检查点时间线"));
    }

    #[test]
    fn test_generate_timeline_ascii() {
        let manager = TimeTravelManager::new();
        let tree = create_test_tree();

        let output = manager.generate_timeline_ascii(&tree);
        assert!(output.contains("时间线"));
    }

    #[test]
    fn test_checkpoint_type_serialization() {
        let task_type = CheckpointType::Task;
        let global_type = CheckpointType::Global;

        let task_json = serde_json::to_string(&task_type).unwrap();
        let global_json = serde_json::to_string(&global_type).unwrap();

        assert_eq!(task_json, "\"task\"");
        assert_eq!(global_json, "\"global\"");
    }

    #[test]
    fn test_branch_status_serialization() {
        let active = BranchStatus::Active;
        let merged = BranchStatus::Merged;
        let abandoned = BranchStatus::Abandoned;

        assert_eq!(serde_json::to_string(&active).unwrap(), "\"active\"");
        assert_eq!(serde_json::to_string(&merged).unwrap(), "\"merged\"");
        assert_eq!(serde_json::to_string(&abandoned).unwrap(), "\"abandoned\"");
    }
}

// ============================================================================
// 边界检查器测试
// ============================================================================

#[cfg(test)]
mod boundary_checker_tests {
    use super::*;

    fn create_test_blueprint() -> Blueprint {
        let mut blueprint = Blueprint::new("测试项目".to_string(), "测试描述".to_string());

        blueprint.modules.push(SystemModule {
            id: "frontend".to_string(),
            name: "前端模块".to_string(),
            description: "前端 UI".to_string(),
            module_type: ModuleType::Frontend,
            responsibilities: vec!["用户界面".to_string()],
            dependencies: vec![],
            interfaces: vec![],
            tech_stack: Some(vec!["TypeScript".to_string(), "React".to_string()]),
            root_path: Some("src/frontend".to_string()),
        });

        blueprint.modules.push(SystemModule {
            id: "backend".to_string(),
            name: "后端模块".to_string(),
            description: "后端服务".to_string(),
            module_type: ModuleType::Backend,
            responsibilities: vec!["API 服务".to_string()],
            dependencies: vec![],
            interfaces: vec![],
            tech_stack: Some(vec!["Rust".to_string()]),
            root_path: Some("src/backend".to_string()),
        });

        blueprint
    }

    #[test]
    fn test_boundary_checker_creation() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        assert_eq!(checker.get_module_ids().len(), 2);
    }

    #[test]
    fn test_protected_file_check() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_task_boundary(Some("frontend"), "package.json");
        assert!(!result.allowed);
        assert_eq!(result.violation_type, Some(ViolationType::ProtectedFile));
    }

    #[test]
    fn test_config_file_check() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_task_boundary(Some("frontend"), "tsconfig.json");
        assert!(!result.allowed);
    }

    #[test]
    fn test_module_scope_allowed() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result =
            checker.check_task_boundary(Some("frontend"), "src/frontend/components/Button.tsx");
        assert!(result.allowed);
    }

    #[test]
    fn test_cross_module_violation() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_task_boundary(Some("frontend"), "src/backend/api/handler.rs");
        assert!(!result.allowed);
        assert_eq!(result.violation_type, Some(ViolationType::CrossModule));
    }

    #[test]
    fn test_tech_stack_match() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_tech_stack("frontend", "src/frontend/App.tsx");
        assert!(result.allowed);
    }

    #[test]
    fn test_tech_stack_mismatch() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_tech_stack("frontend", "src/frontend/main.rs");
        assert!(!result.allowed);
        assert_eq!(
            result.violation_type,
            Some(ViolationType::TechStackMismatch)
        );
    }

    #[test]
    fn test_no_module_id_allows_all() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let result = checker.check_task_boundary(None, "any/path/file.txt");
        assert!(result.allowed);
    }

    #[test]
    fn test_batch_check_files() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let files = vec![
            "src/frontend/App.tsx".to_string(),
            "src/backend/main.rs".to_string(),
            "package.json".to_string(),
        ];

        let results = checker.check_files(Some("frontend"), &files);
        assert_eq!(results.len(), 3);
    }

    #[test]
    fn test_get_violations() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let files = vec![
            "src/frontend/App.tsx".to_string(),
            "src/backend/main.rs".to_string(),
            "package.json".to_string(),
        ];

        let violations = checker.get_violations(Some("frontend"), &files);
        assert_eq!(violations.len(), 2); // backend 和 package.json
    }

    #[test]
    fn test_get_module() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let module = checker.get_module("frontend");
        assert!(module.is_some());
        assert_eq!(module.unwrap().name, "前端模块");

        let not_found = checker.get_module("nonexistent");
        assert!(not_found.is_none());
    }

    #[test]
    fn test_get_module_root() {
        let blueprint = create_test_blueprint();
        let checker = BoundaryChecker::new(blueprint, None);

        let root = checker.get_module_root("frontend");
        assert!(root.is_some());
        assert_eq!(root.unwrap(), "src/frontend");
    }

    #[test]
    fn test_boundary_check_result_allow() {
        let result = BoundaryCheckResult::allow();
        assert!(result.allowed);
        assert!(result.reason.is_none());
    }

    #[test]
    fn test_boundary_check_result_deny() {
        let result = BoundaryCheckResult::deny("测试原因".to_string(), ViolationType::CrossModule);
        assert!(!result.allowed);
        assert_eq!(result.reason, Some("测试原因".to_string()));
        assert_eq!(result.violation_type, Some(ViolationType::CrossModule));
    }

    #[test]
    fn test_boundary_check_result_with_suggestion() {
        let result = BoundaryCheckResult::deny("原因".to_string(), ViolationType::ProtectedFile)
            .with_suggestion("建议".to_string());

        assert_eq!(result.suggestion, Some("建议".to_string()));
    }

    #[test]
    fn test_create_boundary_checker() {
        let blueprint = create_test_blueprint();
        let checker = create_boundary_checker(blueprint, None);
        assert_eq!(checker.get_module_ids().len(), 2);
    }
}

// ============================================================================
// 类型测试
// ============================================================================

#[cfg(test)]
mod types_tests {
    use super::*;

    #[test]
    fn test_blueprint_new() {
        let bp = Blueprint::new("测试".to_string(), "描述".to_string());

        assert!(!bp.id.is_empty());
        assert_eq!(bp.name, "测试");
        assert_eq!(bp.description, "描述");
        assert_eq!(bp.status, BlueprintStatus::Draft);
        assert_eq!(bp.version, "1.0.0");
        assert!(bp.business_processes.is_empty());
        assert!(bp.modules.is_empty());
        assert!(bp.nfrs.is_empty());
        assert!(!bp.change_history.is_empty());
    }

    #[test]
    fn test_task_node_new() {
        let task = TaskNode::new("任务".to_string(), "描述".to_string(), 2);

        assert!(!task.id.is_empty());
        assert_eq!(task.name, "任务");
        assert_eq!(task.depth, 2);
        assert_eq!(task.status, TaskStatus::Pending);
        assert_eq!(task.priority, 50);
        assert_eq!(task.max_retries, 3);
    }

    #[test]
    fn test_task_tree_new() {
        let root = TaskNode::new("根".to_string(), "描述".to_string(), 0);
        let tree = TaskTree::new("bp-1".to_string(), root);

        assert!(!tree.id.is_empty());
        assert_eq!(tree.blueprint_id, "bp-1");
        assert_eq!(tree.status, TaskTreeStatus::Pending);
    }

    #[test]
    fn test_validation_result_success() {
        let result = ValidationResult::success();
        assert!(result.valid);
        assert!(result.errors.is_empty());
    }

    #[test]
    fn test_validation_result_failure() {
        let result = ValidationResult::failure(vec!["错误1".to_string(), "错误2".to_string()]);
        assert!(!result.valid);
        assert_eq!(result.errors.len(), 2);
    }

    #[test]
    fn test_blueprint_status_default() {
        let status: BlueprintStatus = Default::default();
        assert_eq!(status, BlueprintStatus::Draft);
    }

    #[test]
    fn test_task_status_default() {
        let status: TaskStatus = Default::default();
        assert_eq!(status, TaskStatus::Pending);
    }

    #[test]
    fn test_tdd_phase_default() {
        let phase: TddPhase = Default::default();
        assert_eq!(phase, TddPhase::WriteTest);
    }

    #[test]
    fn test_tdd_cycle_state_default() {
        let state: TddCycleState = Default::default();
        assert_eq!(state.phase, TddPhase::WriteTest);
        assert_eq!(state.iteration, 0);
        assert_eq!(state.max_iterations, 10);
        assert!(!state.test_written);
        assert!(!state.test_passed);
        assert!(!state.code_written);
    }

    #[test]
    fn test_task_tree_status_default() {
        let status: TaskTreeStatus = Default::default();
        assert_eq!(status, TaskTreeStatus::Pending);
    }

    #[test]
    fn test_task_tree_stats_default() {
        let stats: TaskTreeStats = Default::default();
        assert_eq!(stats.total_tasks, 0);
        assert_eq!(stats.progress_percentage, 0.0);
    }

    #[test]
    fn test_status_serialization() {
        // BlueprintStatus
        assert_eq!(
            serde_json::to_string(&BlueprintStatus::Draft).unwrap(),
            "\"draft\""
        );
        assert_eq!(
            serde_json::to_string(&BlueprintStatus::Approved).unwrap(),
            "\"approved\""
        );

        // TaskStatus
        assert_eq!(
            serde_json::to_string(&TaskStatus::Pending).unwrap(),
            "\"pending\""
        );
        assert_eq!(
            serde_json::to_string(&TaskStatus::Coding).unwrap(),
            "\"coding\""
        );

        // ModuleType
        assert_eq!(
            serde_json::to_string(&ModuleType::Backend).unwrap(),
            "\"backend\""
        );
        assert_eq!(
            serde_json::to_string(&ModuleType::Frontend).unwrap(),
            "\"frontend\""
        );
    }

    #[test]
    fn test_process_type_serialization() {
        assert_eq!(
            serde_json::to_string(&ProcessType::AsIs).unwrap(),
            "\"as-is\""
        );
        assert_eq!(
            serde_json::to_string(&ProcessType::ToBe).unwrap(),
            "\"to-be\""
        );
    }

    #[test]
    fn test_nfr_category_serialization() {
        assert_eq!(
            serde_json::to_string(&NfrCategory::Performance).unwrap(),
            "\"performance\""
        );
        assert_eq!(
            serde_json::to_string(&NfrCategory::Security).unwrap(),
            "\"security\""
        );
    }

    #[test]
    fn test_moscow_priority_serialization() {
        assert_eq!(
            serde_json::to_string(&MoscowPriority::Must).unwrap(),
            "\"must\""
        );
        assert_eq!(
            serde_json::to_string(&MoscowPriority::Should).unwrap(),
            "\"should\""
        );
        assert_eq!(
            serde_json::to_string(&MoscowPriority::Could).unwrap(),
            "\"could\""
        );
        assert_eq!(
            serde_json::to_string(&MoscowPriority::Wont).unwrap(),
            "\"wont\""
        );
    }

    #[test]
    fn test_test_type_serialization() {
        assert_eq!(serde_json::to_string(&TestType::Unit).unwrap(), "\"unit\"");
        assert_eq!(
            serde_json::to_string(&TestType::Integration).unwrap(),
            "\"integration\""
        );
        assert_eq!(serde_json::to_string(&TestType::E2e).unwrap(), "\"e2e\"");
    }

    #[test]
    fn test_artifact_type_serialization() {
        assert_eq!(
            serde_json::to_string(&ArtifactType::File).unwrap(),
            "\"file\""
        );
        assert_eq!(
            serde_json::to_string(&ArtifactType::Patch).unwrap(),
            "\"patch\""
        );
        assert_eq!(
            serde_json::to_string(&ArtifactType::Command).unwrap(),
            "\"command\""
        );
    }

    #[test]
    fn test_change_type_serialization() {
        assert_eq!(
            serde_json::to_string(&ChangeType::Create).unwrap(),
            "\"create\""
        );
        assert_eq!(
            serde_json::to_string(&ChangeType::Update).unwrap(),
            "\"update\""
        );
        assert_eq!(
            serde_json::to_string(&ChangeType::Approve).unwrap(),
            "\"approve\""
        );
    }

    #[test]
    fn test_timeline_event_type_serialization() {
        assert_eq!(
            serde_json::to_string(&TimelineEventType::TaskStart).unwrap(),
            "\"task_start\""
        );
        assert_eq!(
            serde_json::to_string(&TimelineEventType::Checkpoint).unwrap(),
            "\"checkpoint\""
        );
    }
}
