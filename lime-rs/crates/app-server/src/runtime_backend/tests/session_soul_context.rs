use super::*;

#[test]
fn session_config_appends_soul_context_from_config_metadata() {
    let mut request = request_for_test("hello", None, None);
    let options = request.runtime_options.as_mut().expect("runtime options");
    options.runtime_request_mut().provider_preference = Some("openai".to_string());
    options.runtime_request_mut().model_preference = Some("gpt-4.1".to_string());
    let host_request = runtime_request_from_request(&request);
    let scope = session_scope_from_request(&request).expect("session scope");
    let selection = selection_from_explicit_preferences(&request).expect("selection");
    let policy = request_tool_policy_from_request(host_request.as_ref());
    let config_metadata = Some(json!({
        "memory": {
            "soul": {
                "schema": "memory_soul_prompt_context.v2",
                "source": "memory.soul",
                "scope": "interaction_only",
                "styleProfile": {
                    "id": "warm_supportive_companion",
                    "packId": "com.lime.soul.warm-supportive-companion",
                    "tone": "warm_supportive",
                    "allowedMoves": ["Use patient wording."],
                    "forbiddenMoves": ["Do not over-comfort."],
                    "seriousModeFallback": "calm_professional_partner"
                },
                "summary": "Lead with the answer.",
                "communicationStyle": ["State risks plainly"],
                "avoid": ["Do not use vague encouragement"]
            }
        }
    }));

    let config = session_config_from_request(
        &request,
        host_request.as_ref(),
        &scope,
        &selection,
        &policy,
        config_metadata,
    );

    let prompt = config.system_prompt.expect("system prompt");
    assert!(prompt.contains("## Interaction Soul"));
    assert!(prompt.contains("saved app config `memory.soul`"));
    assert!(prompt.contains("`memory.soul` 是配置键，不是文件路径"));
    assert!(prompt.contains("不要为了获取人格、口吻或风格再次调用文件或 memory 工具"));
    assert!(prompt.contains("Style profile: warm_supportive_companion"));
    assert!(prompt.contains("Style pack: com.lime.soul.warm-supportive-companion"));
    assert!(prompt.contains("Lead with the answer."));
    assert!(prompt.contains("State risks plainly"));
    assert!(prompt.contains("generation brief"));
    assert!(prompt.contains("不要尝试读取 `memory.soul` 或 `SOUL.md`"));
}

#[test]
fn session_config_does_not_promote_retired_persona_packs_into_soul_prompt() {
    let mut request = request_for_test(
        "hello",
        None,
        Some(json!({
            "persona_context": {
                "source": "knowledge_pack",
                "scope": "style_context_only",
                "packs": [
                    {
                        "name": "founder-persona",
                        "activation": "implicit",
                        "role": "companion"
                    }
                ],
                "style_profile_contract": {
                    "inherits_global_soul": true,
                    "writes_back_to_global_soul": false,
                    "formal_artifact_voice_source": "generation_brief_only"
                },
                "boundaries": [
                    "Use persona packs as wording preferences and confirmed background only."
                ]
            }
        })),
    );
    let options = request.runtime_options.as_mut().expect("runtime options");
    options.runtime_request_mut().provider_preference = Some("openai".to_string());
    options.runtime_request_mut().model_preference = Some("gpt-4.1".to_string());
    let host_request = runtime_request_from_request(&request);
    let scope = session_scope_from_request(&request).expect("session scope");
    let selection = selection_from_explicit_preferences(&request).expect("selection");
    let policy = request_tool_policy_from_request(host_request.as_ref());
    let config_metadata = Some(json!({
        "memory": {
            "soul": {
                "schema": "memory_soul_prompt_context.v2",
                "source": "memory.soul",
                "scope": "interaction_only",
                "styleProfile": {
                    "id": "cheeky_sassy_executor",
                    "packId": "com.lime.soul.cheeky-sassy-executor",
                    "tone": "cheeky_sassy",
                    "allowedMoves": ["Use light playful phrasing."],
                    "forbiddenMoves": ["Do not invent tool results."],
                    "seriousModeFallback": "calm_professional_partner"
                }
            }
        }
    }));

    let config = session_config_from_request(
        &request,
        host_request.as_ref(),
        &scope,
        &selection,
        &policy,
        config_metadata,
    );

    let prompt = config.system_prompt.expect("system prompt");
    assert!(prompt.contains("## Interaction Soul"));
    assert!(prompt.contains("不要尝试读取 `memory.soul` 或 `SOUL.md`"));
    assert!(prompt.contains("Style profile: cheeky_sassy_executor"));
    assert!(prompt.contains("Style pack: com.lime.soul.cheeky-sassy-executor"));
    assert!(!prompt.contains("Persona knowledge packs (context only)"));
    assert!(!prompt.contains("founder-persona (activation: implicit, role: companion)"));
    assert!(!prompt.contains("Persona context boundaries"));
    assert!(!prompt.contains("writes_back_to_global_soul=false"));
}
