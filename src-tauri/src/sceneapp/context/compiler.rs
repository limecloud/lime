use super::dto::{
    ContextCompilerPlan, ContextLayerSnapshot, ContextLayerSourceKind, ReferenceItem,
    SceneAppContextOverlay, TasteProfile,
};
use super::store::PersistedSceneAppContext;
use crate::sceneapp::dto::{SceneAppDescriptor, SceneAppLaunchIntent, SceneAppPattern};
use lime_memory::UnifiedMemory;
use std::collections::{hash_map::DefaultHasher, BTreeSet};
use std::hash::{Hash, Hasher};

fn push_unique(values: &mut Vec<String>, value: Option<String>) {
    let Some(value) = value.map(|item| item.trim().to_string()) else {
        return;
    };
    if value.is_empty() || values.iter().any(|item| item == &value) {
        return;
    }
    values.push(value);
}

fn truncate_summary(value: &str, max_chars: usize) -> String {
    let trimmed = value.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let mut summary = trimmed.chars().take(max_chars).collect::<String>();
    summary.push('…');
    summary
}

fn extract_url_candidate(text: &str) -> Option<String> {
    text.split_whitespace()
        .find(|segment| segment.starts_with("http://") || segment.starts_with("https://"))
        .map(|segment| {
            segment.trim_end_matches(|char: char| {
                matches!(
                    char,
                    '"' | '\'' | ')' | ']' | '}' | ',' | '.' | '>' | '，' | '。' | '）'
                )
            })
        })
        .map(str::to_string)
        .filter(|segment| !segment.is_empty())
}

fn stable_reference_item_id(prefix: &str, key: &str, value: &str) -> String {
    let mut hasher = DefaultHasher::new();
    prefix.hash(&mut hasher);
    key.hash(&mut hasher);
    value.trim().hash(&mut hasher);
    format!("{prefix}-{key}-{:x}", hasher.finish())
}

fn stable_memory_reference_item_id(memory_id: &str) -> String {
    format!("memory:{memory_id}")
}

fn build_reference_content_type(memory: &UnifiedMemory) -> String {
    if extract_url_candidate(memory.content.as_str()).is_some() {
        return "url".to_string();
    }

    match memory.category {
        lime_memory::MemoryCategory::Identity => "style_memory".to_string(),
        lime_memory::MemoryCategory::Preference => "preference_memory".to_string(),
        lime_memory::MemoryCategory::Context => "reference_memory".to_string(),
        lime_memory::MemoryCategory::Experience => "outcome_memory".to_string(),
        lime_memory::MemoryCategory::Activity => "collection_memory".to_string(),
    }
}

pub fn build_reference_library_items(memories: &[UnifiedMemory]) -> Vec<ReferenceItem> {
    memories
        .iter()
        .map(|memory| ReferenceItem {
            id: stable_memory_reference_item_id(memory.id.as_str()),
            label: memory.title.trim().to_string(),
            source_kind: ContextLayerSourceKind::ReferenceLibrary,
            content_type: build_reference_content_type(memory),
            uri: extract_url_candidate(memory.content.as_str()),
            summary: Some(if memory.summary.trim().is_empty() {
                truncate_summary(memory.content.as_str(), 80)
            } else {
                truncate_summary(memory.summary.as_str(), 80)
            }),
            selected: true,
            usage_count: None,
            last_used_at: None,
            last_feedback_label: None,
        })
        .collect()
}

fn build_reference_items(intent: &SceneAppLaunchIntent) -> Vec<ReferenceItem> {
    let mut items = Vec::new();

    if let Some(user_input) = intent.user_input.as_deref().map(str::trim) {
        if !user_input.is_empty() {
            items.push(ReferenceItem {
                id: stable_reference_item_id("user-input", "input", user_input),
                label: "用户输入".to_string(),
                source_kind: ContextLayerSourceKind::UserInput,
                content_type: if extract_url_candidate(user_input).is_some() {
                    "url".to_string()
                } else {
                    "text".to_string()
                },
                uri: extract_url_candidate(user_input),
                summary: Some(truncate_summary(user_input, 80)),
                selected: true,
                usage_count: None,
                last_used_at: None,
                last_feedback_label: None,
            });
        }
    }

    items.extend(intent.slots.iter().filter_map(|(key, value)| {
        let normalized = value.trim();
        if normalized.is_empty() {
            return None;
        }
        Some(ReferenceItem {
            id: stable_reference_item_id("slot", key.as_str(), normalized),
            label: key.clone(),
            source_kind: ContextLayerSourceKind::Slot,
            content_type: if extract_url_candidate(normalized).is_some() {
                "url".to_string()
            } else {
                "slot".to_string()
            },
            uri: extract_url_candidate(normalized),
            summary: Some(truncate_summary(normalized, 80)),
            selected: true,
            usage_count: None,
            last_used_at: None,
            last_feedback_label: None,
        })
    }));

    items
}

fn merge_reference_item_feedback(
    mut item: ReferenceItem,
    persisted_item: &ReferenceItem,
) -> ReferenceItem {
    if item.summary.is_none() {
        item.summary = persisted_item.summary.clone();
    }
    if item.uri.is_none() {
        item.uri = persisted_item.uri.clone();
    }
    if item.usage_count.is_none() {
        item.usage_count = persisted_item.usage_count;
    }
    if item.last_used_at.is_none() {
        item.last_used_at = persisted_item.last_used_at.clone();
    }
    if item.last_feedback_label.is_none() {
        item.last_feedback_label = persisted_item.last_feedback_label.clone();
    }
    item.selected = item.selected || persisted_item.selected;
    item
}

fn merge_reference_items(
    explicit_reference_items: Vec<ReferenceItem>,
    input_items: Vec<ReferenceItem>,
    persisted_context: Option<&PersistedSceneAppContext>,
) -> Vec<ReferenceItem> {
    let mut seen = BTreeSet::new();
    let mut merged = Vec::new();

    for mut item in explicit_reference_items {
        if let Some(persisted_item) = persisted_context.and_then(|context| {
            context
                .reference_items
                .iter()
                .find(|existing| existing.id == item.id)
        }) {
            item = merge_reference_item_feedback(item, persisted_item);
        }
        if seen.insert(item.id.clone()) {
            merged.push(item);
        }
    }

    for mut item in input_items {
        if let Some(persisted_item) = persisted_context.and_then(|context| {
            context
                .reference_items
                .iter()
                .find(|existing| existing.id == item.id)
        }) {
            item = merge_reference_item_feedback(item, persisted_item);
        }
        if seen.insert(item.id.clone()) {
            merged.push(item);
        }
    }

    if let Some(context) = persisted_context {
        for item in context.reference_items.iter() {
            if !seen.insert(item.id.clone()) {
                continue;
            }
            let mut restored = item.clone();
            restored.source_kind = ContextLayerSourceKind::ReferenceLibrary;
            merged.push(restored);
        }
    }

    merged
}

fn build_memory_refs(intent: &SceneAppLaunchIntent) -> Vec<String> {
    let mut refs = Vec::new();

    push_unique(
        &mut refs,
        intent
            .workspace_id
            .as_ref()
            .map(|workspace_id| format!("workspace:{workspace_id}")),
    );
    push_unique(
        &mut refs,
        intent
            .project_id
            .as_ref()
            .map(|project_id| format!("project:{project_id}")),
    );
    if intent
        .user_input
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
    {
        push_unique(&mut refs, Some("memory_profile:user_input".to_string()));
    }

    refs
}

fn build_tool_refs(descriptor: &SceneAppDescriptor, intent: &SceneAppLaunchIntent) -> Vec<String> {
    let mut refs = descriptor.capability_refs.clone();

    if let Some(runtime_context) = intent.runtime_context.as_ref() {
        if runtime_context.browser_session_attached {
            push_unique(&mut refs, Some("browser_session".to_string()));
        }
        if runtime_context.automation_enabled {
            push_unique(&mut refs, Some("automation".to_string()));
        }
    }

    refs
}

fn build_skill_refs(descriptor: &SceneAppDescriptor) -> Vec<String> {
    let mut refs = Vec::new();

    push_unique(&mut refs, Some(descriptor.id.clone()));
    push_unique(&mut refs, descriptor.linked_service_skill_id.clone());
    push_unique(&mut refs, descriptor.linked_scene_key.clone());
    push_unique(
        &mut refs,
        descriptor
            .composition_profile
            .as_ref()
            .and_then(|profile| profile.blueprint_ref.clone()),
    );

    refs
}

fn build_taste_profile(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppLaunchIntent,
    reference_items: &[ReferenceItem],
    persisted_context: Option<&PersistedSceneAppContext>,
) -> Option<TasteProfile> {
    let has_user_input = intent
        .user_input
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty());
    let persisted_taste_profile =
        persisted_context.and_then(|context| context.taste_profile.as_ref());
    if reference_items.is_empty() && !has_user_input {
        return persisted_taste_profile.cloned();
    }

    let mut keywords = Vec::new();
    if let Some(profile) = persisted_taste_profile {
        for keyword in profile.keywords.iter() {
            push_unique(&mut keywords, Some(keyword.clone()));
        }
    }
    for item in reference_items.iter().filter(|item| {
        matches!(
            item.source_kind,
            ContextLayerSourceKind::ReferenceLibrary | ContextLayerSourceKind::Project
        )
    }) {
        push_unique(&mut keywords, Some(item.label.clone()));
    }
    for alias in descriptor.aliases.iter().take(2) {
        push_unique(&mut keywords, Some(alias.clone()));
    }
    for (key, value) in intent.slots.iter() {
        let normalized_key = key.trim().to_lowercase();
        if !matches!(
            normalized_key.as_str(),
            "style" | "tone" | "mood" | "platform" | "target_language" | "duration"
        ) {
            continue;
        }
        push_unique(
            &mut keywords,
            Some(format!("{key}:{}", truncate_summary(value, 24))),
        );
    }
    if matches!(descriptor.pattern_primary, SceneAppPattern::Reviewer) {
        push_unique(&mut keywords, Some("review-first".to_string()));
    }
    push_unique(&mut keywords, Some(descriptor.output_hint.clone()));

    let mut avoid_keywords = Vec::new();
    if let Some(profile) = persisted_taste_profile {
        for keyword in profile.avoid_keywords.iter() {
            push_unique(&mut avoid_keywords, Some(keyword.clone()));
        }
    }
    if !reference_items.is_empty() {
        push_unique(&mut avoid_keywords, Some("偏离参考素材".to_string()));
    }

    Some(TasteProfile {
        profile_id: format!("taste-{}", descriptor.id),
        summary: if persisted_taste_profile.is_some() && !reference_items.is_empty() {
            format!(
                "当前 TasteProfile 已在项目沉淀基础上，结合 {} 条参考输入更新启发式摘要。",
                reference_items.len()
            )
        } else if persisted_taste_profile.is_some() {
            "当前 TasteProfile 已从项目上下文恢复。".to_string()
        } else if reference_items.is_empty() {
            "当前 TasteProfile 先基于用户输入与场景画像生成启发式摘要。".to_string()
        } else {
            format!(
                "当前 TasteProfile 先基于 {} 条参考输入与场景画像生成启发式摘要。",
                reference_items.len()
            )
        },
        keywords,
        avoid_keywords,
        derived_from_reference_ids: reference_items.iter().map(|item| item.id.clone()).collect(),
        confidence: Some(
            if persisted_taste_profile.is_some() && !reference_items.is_empty() {
                0.72
            } else if persisted_taste_profile.is_some() {
                0.64
            } else if reference_items.is_empty() {
                0.38
            } else {
                0.56
            },
        ),
        feedback_summary: persisted_taste_profile
            .and_then(|profile| profile.feedback_summary.clone()),
        feedback_signals: persisted_taste_profile
            .map(|profile| profile.feedback_signals.clone())
            .unwrap_or_default(),
        last_feedback_at: persisted_taste_profile
            .and_then(|profile| profile.last_feedback_at.clone()),
    })
}

pub fn build_sceneapp_context_overlay(
    descriptor: &SceneAppDescriptor,
    intent: &SceneAppLaunchIntent,
    persisted_context: Option<&PersistedSceneAppContext>,
    explicit_reference_items: &[ReferenceItem],
) -> SceneAppContextOverlay {
    let input_reference_items = build_reference_items(intent);
    let reference_items = merge_reference_items(
        explicit_reference_items.to_vec(),
        input_reference_items.clone(),
        persisted_context,
    );
    let memory_refs = build_memory_refs(intent);
    let tool_refs = build_tool_refs(descriptor, intent);
    let skill_refs = build_skill_refs(descriptor);
    let taste_profile =
        build_taste_profile(descriptor, intent, &reference_items, persisted_context);

    let mut active_layers = vec!["skill".to_string(), "tool".to_string()];
    if !memory_refs.is_empty() {
        active_layers.push("memory".to_string());
    }
    if !reference_items.is_empty() {
        active_layers.push("reference".to_string());
    }
    if taste_profile.is_some() {
        active_layers.push("taste".to_string());
    }

    let mut notes = Vec::new();
    if !memory_refs.is_empty() {
        notes.push(format!("已装配 {} 条 memory 引用。", memory_refs.len()));
    }
    let restored_reference_count = persisted_context
        .map(|context| context.reference_items.len())
        .unwrap_or(0);
    if restored_reference_count > 0 {
        notes.push(format!(
            "已从项目上下文恢复 {} 条历史参考。",
            restored_reference_count
        ));
    }
    if explicit_reference_items.is_empty()
        && input_reference_items.is_empty()
        && reference_items.is_empty()
    {
        notes.push("当前尚未选中显式参考素材，将主要依赖用户输入与场景画像。".to_string());
    } else if !explicit_reference_items.is_empty() && !input_reference_items.is_empty() {
        notes.push(format!(
            "本次显式带入 {} 条灵感对象，并新增 {} 条输入参考，当前 planning 共带上 {} 条参考。",
            explicit_reference_items.len(),
            input_reference_items.len(),
            reference_items.len()
        ));
    } else if !explicit_reference_items.is_empty() {
        notes.push(format!(
            "本次显式带入 {} 条灵感对象，当前 planning 共带上 {} 条参考。",
            explicit_reference_items.len(),
            reference_items.len()
        ));
    } else if !input_reference_items.is_empty() {
        notes.push(format!(
            "本次新增 {} 条参考输入，当前 planning 共带上 {} 条参考。",
            input_reference_items.len(),
            reference_items.len()
        ));
    } else if !reference_items.is_empty() {
        notes.push(format!(
            "当前 planning 直接复用了 {} 条项目级参考。",
            reference_items.len()
        ));
    }
    if persisted_context
        .and_then(|context| context.taste_profile.as_ref())
        .is_some()
    {
        notes.push("当前已复用项目级 TasteProfile，并按最新输入继续更新。".to_string());
    } else if taste_profile.is_some() {
        notes
            .push("当前 TasteProfile 为启发式摘要，可继续通过场景基线与运行反馈沉淀。".to_string());
    }

    SceneAppContextOverlay {
        compiler_plan: ContextCompilerPlan {
            active_layers,
            memory_refs: memory_refs.clone(),
            tool_refs: tool_refs.clone(),
            reference_count: reference_items.len(),
            notes,
        },
        snapshot: ContextLayerSnapshot {
            workspace_id: intent.workspace_id.clone(),
            project_id: intent.project_id.clone(),
            skill_refs,
            memory_refs,
            tool_refs,
            reference_items,
            taste_profile,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::{build_reference_library_items, build_sceneapp_context_overlay};
    use crate::sceneapp::catalog::get_sceneapp_descriptor;
    use crate::sceneapp::context::dto::{ContextLayerSourceKind, ReferenceItem, TasteProfile};
    use crate::sceneapp::context::store::PersistedSceneAppContext;
    use crate::sceneapp::dto::{SceneAppLaunchIntent, SceneAppRuntimeContext};
    use lime_memory::UnifiedMemory;
    use std::collections::BTreeMap;

    #[test]
    fn should_build_reference_and_taste_overlay_for_sceneapp_launch() {
        let descriptor = get_sceneapp_descriptor("x-article-export")
            .expect("x-article-export descriptor should exist");
        let mut slots = BTreeMap::new();
        slots.insert(
            "article_url".to_string(),
            "https://x.com/openai/article/123".to_string(),
        );
        slots.insert("target_language".to_string(), "中文".to_string());

        let overlay = build_sceneapp_context_overlay(
            &descriptor,
            &SceneAppLaunchIntent {
                sceneapp_id: "x-article-export".to_string(),
                entry_source: Some("sceneapp_card".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-export".to_string()),
                user_input: Some("请导出这篇文章并保持原始语气".to_string()),
                reference_memory_ids: Vec::new(),
                slots,
                runtime_context: Some(SceneAppRuntimeContext {
                    browser_session_attached: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            None,
            &[],
        );

        assert!(overlay
            .compiler_plan
            .active_layers
            .contains(&"reference".to_string()));
        assert!(overlay
            .compiler_plan
            .active_layers
            .contains(&"taste".to_string()));
        assert_eq!(overlay.compiler_plan.reference_count, 3);
        assert!(overlay
            .snapshot
            .tool_refs
            .contains(&"browser_session".to_string()));
        assert!(overlay.snapshot.taste_profile.is_some());
    }

    #[test]
    fn should_merge_persisted_sceneapp_context_into_overlay() {
        let descriptor = get_sceneapp_descriptor("story-video-suite")
            .expect("story-video-suite descriptor should exist");
        let mut slots = BTreeMap::new();
        slots.insert("style".to_string(), "科技感、快节奏".to_string());
        let persisted_context = PersistedSceneAppContext {
            sceneapp_id: "story-video-suite".to_string(),
            workspace_id: Some("workspace-default".to_string()),
            project_id: Some("project-video".to_string()),
            reference_items: vec![ReferenceItem {
                id: "saved-reference-1".to_string(),
                label: "竞品拆解".to_string(),
                source_kind: ContextLayerSourceKind::ReferenceLibrary,
                content_type: "text".to_string(),
                uri: None,
                summary: Some("保留结论前置和对比镜头。".to_string()),
                selected: true,
                usage_count: Some(2),
                last_used_at: Some("2026-04-16T12:00:00.000Z".to_string()),
                last_feedback_label: Some("复核阻塞".to_string()),
            }],
            taste_profile: Some(TasteProfile {
                profile_id: "taste-story-video-suite".to_string(),
                summary: "偏好快节奏科技感表达。".to_string(),
                keywords: vec!["快节奏".to_string()],
                avoid_keywords: vec!["冗长铺垫".to_string()],
                derived_from_reference_ids: vec!["saved-reference-1".to_string()],
                confidence: Some(0.66),
                feedback_summary: Some("最近一次运行卡在复核环节。".to_string()),
                feedback_signals: vec!["review_blocked".to_string()],
                last_feedback_at: Some("2026-04-16T12:00:00.000Z".to_string()),
            }),
            last_feedback_run_id: Some("sceneapp-run-42".to_string()),
        };

        let overlay = build_sceneapp_context_overlay(
            &descriptor,
            &SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("sceneapp_detail_preview".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-video".to_string()),
                user_input: Some("做一个 30 秒新品短视频".to_string()),
                reference_memory_ids: Vec::new(),
                slots,
                runtime_context: None,
            },
            Some(&persisted_context),
            &[],
        );

        assert_eq!(overlay.compiler_plan.reference_count, 3);
        assert!(overlay
            .compiler_plan
            .notes
            .iter()
            .any(|note| note.contains("恢复 1 条历史参考")));
        assert!(overlay
            .compiler_plan
            .notes
            .iter()
            .any(|note| note.contains("复用项目级 TasteProfile")));
        assert!(overlay
            .snapshot
            .reference_items
            .iter()
            .any(|item| item.label == "竞品拆解"
                && matches!(item.source_kind, ContextLayerSourceKind::ReferenceLibrary)
                && item.usage_count == Some(2)
                && item.last_feedback_label.as_deref() == Some("复核阻塞")));
        assert!(overlay
            .snapshot
            .taste_profile
            .as_ref()
            .is_some_and(|profile| profile.summary.contains("项目沉淀基础")
                && profile.feedback_summary.as_deref() == Some("最近一次运行卡在复核环节。")
                && profile
                    .feedback_signals
                    .iter()
                    .any(|signal| signal == "review_blocked")));
    }

    #[test]
    fn should_promote_selected_memory_entries_into_reference_items() {
        let descriptor = get_sceneapp_descriptor("story-video-suite")
            .expect("story-video-suite descriptor should exist");
        let explicit_reference_items = build_reference_library_items(&[UnifiedMemory {
            id: "memory-1".to_string(),
            session_id: "session-1".to_string(),
            memory_type: lime_memory::MemoryType::Conversation,
            category: lime_memory::MemoryCategory::Identity,
            title: "夏日短视频语气".to_string(),
            content: "保留轻盈、结论前置和更强的节奏推进。".to_string(),
            summary: "轻盈、结论前置、快节奏。".to_string(),
            tags: vec!["小红书".to_string()],
            metadata: lime_memory::MemoryMetadata {
                confidence: 0.86,
                importance: 7,
                access_count: 0,
                last_accessed_at: None,
                source: lime_memory::MemorySource::Manual,
                embedding: None,
            },
            created_at: 1_712_345_678_900,
            updated_at: 1_712_345_678_900,
            archived: false,
        }]);

        let overlay = build_sceneapp_context_overlay(
            &descriptor,
            &SceneAppLaunchIntent {
                sceneapp_id: "story-video-suite".to_string(),
                entry_source: Some("memory_page".to_string()),
                workspace_id: Some("workspace-default".to_string()),
                project_id: Some("project-video".to_string()),
                user_input: Some("继续整理成 30 秒短视频方案".to_string()),
                reference_memory_ids: vec!["memory-1".to_string()],
                slots: BTreeMap::new(),
                runtime_context: Some(SceneAppRuntimeContext {
                    directory_session_ready_compat: true,
                    ..SceneAppRuntimeContext::default()
                }),
            },
            None,
            explicit_reference_items.as_slice(),
        );

        assert!(overlay
            .snapshot
            .reference_items
            .iter()
            .any(|item| item.id == "memory:memory-1" && item.label == "夏日短视频语气"));
        assert!(!overlay
            .snapshot
            .tool_refs
            .iter()
            .any(|item| item == "cloud_session"));
        assert!(overlay
            .snapshot
            .taste_profile
            .as_ref()
            .is_some_and(|profile| profile
                .keywords
                .iter()
                .any(|keyword| keyword == "夏日短视频语气")));
        assert!(overlay
            .compiler_plan
            .notes
            .iter()
            .any(|note| note.contains("显式带入 1 条灵感对象")));
    }
}
