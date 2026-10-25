use super::*;
use tempfile::TempDir;

#[test]
fn appends_project_skill_metadata_without_enabling_skilltool() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(
        &workspace,
        "research",
        "Research",
        "Use source-backed research.",
    );

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "hello",
        &[],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.starts_with("base"));
    assert!(prompt.contains("## 可用 Agent Skills"));
    assert!(prompt.contains("`research`"));
    assert!(prompt.contains("必须先读取对应 `SKILL.md`"));
    assert!(!prompt.contains("Full body should not be rendered"));
    assert!(!prompt.contains("allow_model_skills"));
}

#[test]
fn explicit_selection_does_not_inject_skill_body_into_system_prompt() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(&workspace, "writer", "Writer", "Write clearly.");

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "请用 $writer 改写这段话",
        &[],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.contains("`writer`"));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Body"));
    assert!(!prompt.contains("Full body should not be rendered."));
    assert!(prompt.contains("## 可用 Agent Skills"));
    assert!(!prompt.contains("allow_model_skills"));
}

#[test]
fn body_evaluation_uses_the_real_skill_body_budget_before_prompt_injection() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(&workspace, "writer", "Writer", "Write clearly.");
    let snapshot = skill_snapshot(Some(workspace.path()), Some(workspace.path()), &[], &[]);
    let selections = selected_agent_skill_body_selections_for_prompt_with_plugins(
        "$writer",
        &[],
        &snapshot,
        &[],
    );

    let evaluations = selected_agent_skill_body_evaluations(&selections, &snapshot);

    assert_eq!(evaluations.len(), 1);
    assert_eq!(evaluations[0].skill_id, "project:writer");
    assert_eq!(evaluations[0].body_budget.max_visible_tokens, 3_000);
    assert!(evaluations[0].body_budget.estimated_tokens.is_some());
}

#[test]
fn skips_duplicate_skills_prompt() {
    let existing = "<skills_instructions>\n## Skills\n</skills_instructions>";

    let prompt = append_agent_skills_context_to_system_prompt(
        Some(existing.to_string()),
        "hello",
        &[],
        None,
        None,
    )
    .expect("prompt");

    assert_eq!(prompt, existing);
}

#[test]
fn catalog_binding_keeps_body_out_of_system_prompt() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(&workspace, "writer", "Writer", "Write clearly.");
    let metadata = serde_json::json!({
        "harness": {
            "service_scene_launch": {
                "service_scene_run": {
                    "skill_locator": {
                        "source": "catalog",
                        "name": "local:writer"
                    },
                    "skill_id": "service-skill-writer",
                    "linked_skill_id": "service-skill-writer"
                }
            }
        }
    });

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "帮我处理这段话",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.contains("`writer`"));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Body"));
    assert!(prompt.contains("## 可用 Agent Skills"));
}

#[test]
fn retired_image_skill_launch_does_not_enter_agent_skills() {
    let workspace = TempDir::new().expect("workspace");
    let skill_dir = workspace.path().join(".agents/skills/image-router");
    std::fs::create_dir_all(&skill_dir).expect("skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: image-router
description: Generate image task.
allowed_tools: lime_create_image_generation_task
---

# Image Generate

Call lime_create_image_generation_task directly.
"#,
    )
    .expect("skill");
    let metadata = serde_json::json!({
        "harness": {
            "image_skill_launch": {
                "skill_name": "image-router",
                "kind": "image_task",
                "image_task": {
                    "prompt": "广州夏天",
                    "modality_contract_key": "image_generation"
                }
            }
        }
    });

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "@配图 画一张广州夏天的图",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");
    assert_eq!(prompt, "base");
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("## 可用 Agent Skills"));
    assert!(!prompt.contains("Call lime_create_image_generation_task directly."));

    let names = selected_skill_names(
        "$image-router",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    );
    assert!(names.is_empty());
}

#[test]
fn image_command_intent_does_not_enter_agent_skills() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(
        &workspace,
        "image_generate",
        "image_generate",
        "Generate image task.",
    );
    let metadata = serde_json::json!({
        "harness": {
            "image_command_intent": {
                "kind": "image_task",
                "image_task": {
                    "prompt": "广州夏天",
                    "modality_contract_key": "image_generation"
                }
            }
        }
    });

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "$image_generate 画一张广州夏天的图",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");
    assert_eq!(prompt, "base");

    let names = selected_skill_names(
        "$image_generate 画一张广州夏天的图",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    );
    assert!(names.is_empty());
}

#[test]
fn appends_expert_skill_refs_as_selector_candidates_without_body() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(&workspace, "writer", "Writer", "Write clearly.");
    let metadata = serde_json::json!({
        "harness": {
            "expert": {
                "skill_refs": [
                    "skill:writer",
                    "service-skill:daily-trend-briefing",
                    "skill:writer"
                ]
            }
        }
    });

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "帮我处理这段话",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.contains("<expert_skill_refs>"));
    assert!(prompt.contains("`skill:writer` -> `writer`"));
    assert!(prompt.contains("`service-skill:daily-trend-briefing`: 未在当前 Agent Skills snapshot"));
    assert!(prompt.contains("首个相关工具调用必须先调用 `skill_search`"));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Body"));

    let names = selected_skill_names(
        "帮我处理这段话",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    );
    assert_eq!(names, vec!["writer".to_string()]);
}

#[test]
fn workspace_runtime_enable_should_not_implicitly_inject_skill_body() {
    let workspace = TempDir::new().expect("workspace");
    let skill_dir = workspace.path().join(".agents/skills/capability-report");
    std::fs::create_dir_all(&skill_dir).expect("skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        "---\nname: Capability Report\ndescription: Capability report live review.\nallowed_tools: Read\n---\n\n# Body\n",
    )
    .expect("skill");
    let metadata = serde_json::json!({
        "harness": {
            "workspace_skill_runtime_enable": {
                "source": "manual_session_enable",
                "approval": "manual",
                "workspace_root": workspace.path().to_string_lossy(),
                "bindings": [
                    {
                        "directory": "capability-report",
                        "registered_skill_directory": workspace
                            .path()
                            .join(".agents/skills/capability-report")
                            .to_string_lossy()
                    }
                ]
            },
            "expert": {
                "skill_refs": ["skill:capability-report"]
            }
        }
    });

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "请先搜索 capability-report 后再执行",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.contains("<expert_skill_refs>"));
    assert!(prompt.contains("`skill:capability-report` -> `capability-report`"));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Body"));
}

#[test]
fn plugin_package_skill_path_enters_snapshot_catalog_without_body() {
    let package = TempDir::new().expect("package");
    let skill_dir = package.path().join("skills").join("article-writing");
    std::fs::create_dir_all(&skill_dir).expect("skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        r#"---
name: article-writing
description: Draft article copy.
---

# Package Article Writing

Use package workflow rules.
"#,
    )
    .expect("skill file");
    let plugin_snapshot = PluginTurnSnapshot {
        id: "content-factory-app".to_string(),
        config_name: "content-factory-app@test".to_string(),
        display_name: "Content Factory".to_string(),
        package_root: package.path().to_path_buf(),
        skill_roots: vec![package.path().join("skills")],
        skills: {
            let mut skills =
                lime_skills::build_agent_skill_snapshot_from_roots([lime_skills::AgentSkillRoot {
                    path: package.path().join("skills"),
                    scope: lime_skills::AgentSkillScope::App,
                }])
                .skills;
            for skill in &mut skills {
                skill.name = format!("content-factory-app:{}", skill.name);
            }
            skills
        },
        mcp_server_names: Vec::new(),
    };

    let context = skills_context(
        Some("base".to_string()),
        "写一篇文章",
        &[],
        None,
        None,
        &[plugin_snapshot],
        &[],
    );
    let prompt = context.system_prompt.expect("prompt");
    let snapshot = context.snapshot.expect("snapshot");
    let canonical_skill_path =
        std::fs::canonicalize(skill_dir.join("SKILL.md")).expect("canonical skill path");

    assert!(snapshot.skills.iter().any(|skill| {
        skill.name == "content-factory-app:article-writing"
            && skill.skill_file_path == canonical_skill_path
    }));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Package Article Writing"));
    assert!(!prompt.contains("Use package workflow rules."));
}

#[test]
fn orchestrator_skill_enters_turn_snapshot_once_without_local_body_read() {
    let skill: AgentSkillMetadata = serde_json::from_value(serde_json::json!({
        "skill_id": "orchestrator:delivery:release-notes",
        "name": "delivery:release-notes",
        "description": "Draft source-backed release notes.",
        "scope": "orchestrator",
        "source": "orchestrator",
        "authority": "orchestrator",
        "enabled": true,
        "interface": {
            "display_name": "delivery:release-notes",
            "execution_mode": "mcp_resource",
            "provider": "lime_apps",
            "model": null,
            "argument_hint": null
        },
        "dependencies": { "tools": [] },
        "policy": {
            "allow_implicit_invocation": true,
            "when_to_use": null
        },
        "capabilities": [],
        "directory": "skill://delivery/release-notes",
        "skill_file_path": "skill://delivery/release-notes/SKILL.md"
    }))
    .expect("orchestrator skill metadata");

    let context = skills_context(
        Some("base".to_string()),
        "draft release notes",
        &[],
        None,
        None,
        &[],
        &[skill.clone(), skill],
    );
    let prompt = context.system_prompt.expect("prompt");
    let snapshot = context.snapshot.expect("snapshot");
    let matching = snapshot
        .skills
        .iter()
        .filter(|skill| skill.skill_id == "orchestrator:delivery:release-notes")
        .collect::<Vec<_>>();

    assert!(snapshot.roots.is_empty());
    assert_eq!(snapshot.skills.len(), 1);
    assert_eq!(matching.len(), 1);
    assert_eq!(
        matching[0].skill_file_path,
        Path::new("skill://delivery/release-notes/SKILL.md")
    );
    assert!(prompt.contains("`delivery:release-notes`"));
    assert!(prompt.chars().count() <= lime_skills::DEFAULT_AGENT_SKILL_RENDER_CHAR_BUDGET);
    assert!(!prompt.contains("<selected_skill_instructions>"));
}

#[test]
fn catalog_bound_selection_ignores_unknown_skill_metadata() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(&workspace, "writer", "Writer", "Write clearly.");
    let metadata = serde_json::json!({
        "harness": {
            "service_scene_launch": {
                "service_scene_run": {
                    "skill_key": "missing"
                }
            }
        }
    });

    let names = selected_skill_names(
        "",
        &[&metadata],
        Some(workspace.path()),
        Some(workspace.path()),
    );

    assert!(names.is_empty());
}

#[test]
fn implicit_selection_keeps_body_out_of_system_prompt() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(
        &workspace,
        "fact-check-lab",
        "Fact Check Lab",
        "联网信息检索与事实核验",
    );
    write_skill(&workspace, "writer", "Writer", "写作润色");

    let prompt = append_agent_skills_context_to_system_prompt(
        Some("base".to_string()),
        "帮我做最新事实核验和趋势调研",
        &[],
        Some(workspace.path()),
        Some(workspace.path()),
    )
    .expect("prompt");

    assert!(prompt.contains("`fact-check-lab`"));
    assert!(!prompt.contains("<selected_skill_instructions>"));
    assert!(!prompt.contains("# Body"));
    assert!(prompt.contains("## 可用 Agent Skills"));
}

#[test]
fn implicit_selection_enables_selected_skill_name_for_turn() {
    let workspace = TempDir::new().expect("workspace");
    write_skill(
        &workspace,
        "fact-check-lab",
        "Fact Check Lab",
        "联网信息检索与事实核验",
    );
    write_skill(&workspace, "writer", "Writer", "写作润色");

    let names = selected_skill_names(
        "帮我做最新事实核验和趋势调研",
        &[],
        Some(workspace.path()),
        Some(workspace.path()),
    );

    assert_eq!(names, vec!["fact-check-lab".to_string()]);
}

fn write_skill(workspace: &TempDir, name: &str, display_name: &str, description: &str) {
    let skill_dir = workspace.path().join(".agents/skills").join(name);
    std::fs::create_dir_all(&skill_dir).expect("skill dir");
    std::fs::write(
        skill_dir.join("SKILL.md"),
        format!(
            "---\nname: {display_name}\ndescription: {description}\nmetadata:\n  lime_when_to_use: {description}\n---\n\n# Body\n\nFull body should not be rendered."
        ),
    )
    .expect("skill");
}

fn append_agent_skills_context_to_system_prompt(
    system_prompt: Option<String>,
    user_input: &str,
    metadata_values: &[&Value],
    working_dir: Option<&Path>,
    project_root: Option<&Path>,
) -> Option<String> {
    skills_context(
        system_prompt,
        user_input,
        metadata_values,
        working_dir,
        project_root,
        &[],
        &[],
    )
    .system_prompt
}

// 测试只扫描显式 workspace 和 plugin roots，不读取真实 user/app 技能目录。
fn skill_roots(working_dir: Option<&Path>, project_root: Option<&Path>) -> Vec<AgentSkillRoot> {
    let mut roots = Vec::new();
    for workspace in [project_root, working_dir].into_iter().flatten() {
        for path in lime_core::app_paths::resolve_project_skill_roots(workspace) {
            let root = AgentSkillRoot {
                path,
                scope: lime_skills::AgentSkillScope::Project,
            };
            if !roots.contains(&root) {
                roots.push(root);
            }
        }
    }
    roots
}

fn skills_context(
    system_prompt: Option<String>,
    user_input: &str,
    metadata_values: &[&Value],
    working_dir: Option<&Path>,
    project_root: Option<&Path>,
    plugin_snapshots: &[PluginTurnSnapshot],
    orchestrator_skills: &[AgentSkillMetadata],
) -> AgentSkillsTurnContext {
    agent_skills_context_from_roots(
        system_prompt,
        user_input,
        metadata_values,
        skill_roots(working_dir, project_root),
        plugin_snapshots,
        orchestrator_skills,
    )
}

fn skill_snapshot(
    working_dir: Option<&Path>,
    project_root: Option<&Path>,
    metadata_values: &[&Value],
    plugin_snapshots: &[PluginTurnSnapshot],
) -> AgentSkillSnapshot {
    build_agent_skill_snapshot_from_turn_roots(
        skill_roots(working_dir, project_root),
        metadata_values,
        plugin_snapshots,
        &[],
    )
}

fn selected_skill_names(
    user_input: &str,
    metadata_values: &[&Value],
    working_dir: Option<&Path>,
    project_root: Option<&Path>,
) -> Vec<String> {
    let snapshot = skill_snapshot(working_dir, project_root, metadata_values, &[]);
    selected_agent_skill_selections_with_plugins(user_input, metadata_values, &snapshot, &[])
        .into_iter()
        .map(|selection| selection.locator.name)
        .collect()
}
