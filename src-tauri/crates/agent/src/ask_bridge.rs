//! Ask 工具桥接
//!
//! 将 aster 的 AskTool 回调桥接到 ActionRequiredManager，
//! 通过 elicitation 事件把问题发送到前端并等待用户输入。

use aster::action_required_manager::ActionRequiredManager;
use aster::conversation::message::ActionRequiredScope;
use aster::session_context::{current_action_scope, current_session_id};
use aster::tools::ask::{AskQuestion, AskRequest};
use aster::tools::AskCallback;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_ASK_TIMEOUT_SECS: u64 = 300;
const ASK_USER_QUESTIONS_SCHEMA_KEY: &str = "x-lime-ask-user-questions";

/// 创建 AskTool 回调
pub fn create_ask_callback() -> AskCallback {
    std::sync::Arc::new(|request: AskRequest| {
        Box::pin(async move {
            let prompt = resolve_request_prompt(&request);
            let requested_schema = build_requested_schema(&request);
            let scope = resolve_action_scope();

            match ActionRequiredManager::global()
                .request_and_wait_scoped(
                    scope,
                    prompt.clone(),
                    requested_schema,
                    Duration::from_secs(DEFAULT_ASK_TIMEOUT_SECS),
                )
                .await
            {
                Ok(user_data) => extract_response(&request, &user_data),
                Err(err) => {
                    tracing::warn!(
                        "[AsterAgent][AskBridge] 用户输入等待失败: prompt='{}', err={}",
                        prompt,
                        err
                    );
                    None
                }
            }
        })
    })
}

fn resolve_action_scope() -> ActionRequiredScope {
    current_action_scope().unwrap_or_else(|| {
        let session_id = current_session_id();
        ActionRequiredScope {
            session_id: session_id.clone(),
            thread_id: session_id,
            turn_id: None,
        }
    })
}

fn resolve_request_prompt(request: &AskRequest) -> String {
    request
        .questions
        .first()
        .map(|question| question.question.trim().to_string())
        .filter(|question| !question.is_empty())
        .unwrap_or_else(|| "请提供继续执行所需信息".to_string())
}

fn question_field_key(question: &AskQuestion, index: usize, total: usize) -> String {
    if total == 1 {
        return "answer".to_string();
    }

    if let Some(header) = question.header.as_deref() {
        let normalized = header
            .trim()
            .to_lowercase()
            .chars()
            .map(|ch| {
                if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
                    ch
                } else {
                    '_'
                }
            })
            .collect::<String>()
            .trim_matches('_')
            .to_string();

        if !normalized.is_empty() {
            return normalized;
        }
    }

    format!("question_{}", index + 1)
}

fn build_question_schema(question: &AskQuestion, index: usize, total: usize) -> (String, Value) {
    let field_key = question_field_key(question, index, total);
    let option_labels = question
        .options
        .iter()
        .map(|option| option.display().to_string())
        .collect::<Vec<_>>();

    let mut property = json!({
        "title": question.header.clone().unwrap_or_else(|| question.question.clone()),
        "description": question.question,
    });

    if let Some(object) = property.as_object_mut() {
        if question.multi_select {
            object.insert("type".to_string(), json!("array"));
            object.insert(
                "items".to_string(),
                json!({
                    "type": "string",
                    "enum": option_labels,
                }),
            );
        } else {
            object.insert("type".to_string(), json!("string"));
            if !option_labels.is_empty() {
                object.insert("enum".to_string(), json!(option_labels));
            }
        }
    }

    (field_key, property)
}

/// 构建 elicitation 的请求 schema，同时携带 rich ask 问题元数据。
fn build_requested_schema(request: &AskRequest) -> Value {
    let total = request.questions.len();
    let mut properties = serde_json::Map::new();
    let mut required = Vec::new();

    for (index, question) in request.questions.iter().enumerate() {
        let (field_key, property) = build_question_schema(question, index, total);
        properties.insert(field_key.clone(), property);
        required.push(field_key);
    }

    json!({
        "type": "object",
        "properties": properties,
        "required": required,
        ASK_USER_QUESTIONS_SCHEMA_KEY: request.questions,
    })
}

fn normalize_answer_value(question: &AskQuestion, value: &Value) -> Option<String> {
    let raw_values = match value {
        Value::String(text) => {
            let trimmed = text.trim();
            if trimmed.is_empty() {
                return None;
            }
            vec![trimmed.to_string()]
        }
        Value::Array(items) => items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => {
                    let trimmed = text.trim();
                    if trimmed.is_empty() {
                        None
                    } else {
                        Some(trimmed.to_string())
                    }
                }
                _ => None,
            })
            .collect::<Vec<_>>(),
        Value::Number(number) => vec![number.to_string()],
        Value::Bool(value) => vec![value.to_string()],
        _ => return None,
    };

    if raw_values.is_empty() {
        return None;
    }

    let normalized = raw_values
        .into_iter()
        .map(|raw| {
            question
                .options
                .iter()
                .find(|option| raw == option.display() || raw == option.value)
                .map(|option| option.value.clone())
                .unwrap_or(raw)
        })
        .collect::<Vec<_>>();

    Some(normalized.join(", "))
}

fn collect_answers(request: &AskRequest, user_data: &Value) -> serde_json::Map<String, Value> {
    let mut answers = serde_json::Map::new();
    let total = request.questions.len();

    match user_data {
        Value::String(_) | Value::Array(_) | Value::Number(_) | Value::Bool(_) => {
            if let Some(question) = request.questions.first() {
                if let Some(answer) = normalize_answer_value(question, user_data) {
                    answers.insert(question.question.clone(), json!(answer));
                }
            }
            return answers;
        }
        Value::Object(map) => {
            if let Some(Value::Object(existing_answers)) = map.get("answers") {
                for question in &request.questions {
                    if let Some(value) = existing_answers.get(&question.question) {
                        if let Some(answer) = normalize_answer_value(question, value) {
                            answers.insert(question.question.clone(), json!(answer));
                        }
                    }
                }
            }

            for (index, question) in request.questions.iter().enumerate() {
                if answers.contains_key(&question.question) {
                    continue;
                }

                for key in [
                    question.question.clone(),
                    question.header.clone().unwrap_or_default(),
                    question_field_key(question, index, total),
                ] {
                    if key.is_empty() {
                        continue;
                    }

                    if let Some(value) = map.get(&key) {
                        if let Some(answer) = normalize_answer_value(question, value) {
                            answers.insert(question.question.clone(), json!(answer));
                            break;
                        }
                    }
                }
            }

            if answers.is_empty() && total == 1 {
                let candidate = map.get("other").or_else(|| map.get("answer"));
                if let (Some(question), Some(value)) = (request.questions.first(), candidate) {
                    if let Some(answer) = normalize_answer_value(question, value) {
                        answers.insert(question.question.clone(), json!(answer));
                    }
                }
            }
        }
        _ => {}
    }

    answers
}

/// 从前端回传的 user_data 中提取 AskTool 可消费的结构化答案。
pub fn extract_response(request: &AskRequest, user_data: &Value) -> Option<Value> {
    let answers = collect_answers(request, user_data);
    if answers.is_empty() {
        return None;
    }

    if request.questions.len() == 1 {
        let question_text = request.questions[0].question.clone();
        let answer = answers.get(&question_text)?.clone();
        return Some(json!({
            "answer": answer,
            "answers": {
                question_text: answer,
            }
        }));
    }

    Some(json!({ "answers": answers }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use aster::session_context::{with_action_scope, with_session_id};

    #[tokio::test]
    async fn resolve_action_scope_prefers_runtime_scope() {
        let scope = ActionRequiredScope {
            session_id: Some("session-1".to_string()),
            thread_id: Some("thread-1".to_string()),
            turn_id: Some("turn-1".to_string()),
        };

        let resolved = with_action_scope(scope.clone(), async { resolve_action_scope() }).await;

        assert_eq!(resolved, scope);
    }

    #[tokio::test]
    async fn resolve_action_scope_falls_back_to_session_id() {
        let resolved = with_session_id(Some("session-2".to_string()), async {
            resolve_action_scope()
        })
        .await;

        assert_eq!(
            resolved,
            ActionRequiredScope {
                session_id: Some("session-2".to_string()),
                thread_id: Some("session-2".to_string()),
                turn_id: None,
            }
        );
    }

    #[test]
    fn build_requested_schema_embeds_questions_extension() {
        let request = AskRequest {
            questions: vec![AskQuestion {
                question: "你希望主色调是什么？".to_string(),
                header: Some("主色调".to_string()),
                options: vec![
                    aster::tools::AskOption {
                        value: "blue-purple".to_string(),
                        label: Some("蓝紫".to_string()),
                        description: Some("冷色科技感".to_string()),
                        preview: None,
                    },
                    aster::tools::AskOption {
                        value: "cyber-green".to_string(),
                        label: Some("赛博绿".to_string()),
                        description: Some("高亮未来感".to_string()),
                        preview: None,
                    },
                ],
                multi_select: false,
            }],
        };

        let schema = build_requested_schema(&request);
        assert_eq!(
            schema
                .get(ASK_USER_QUESTIONS_SCHEMA_KEY)
                .and_then(|value| value.as_array())
                .map(|value| value.len()),
            Some(1)
        );
        assert_eq!(
            schema["properties"]["answer"]["enum"],
            serde_json::json!(["蓝紫", "赛博绿"])
        );
    }

    #[test]
    fn extract_response_normalizes_question_answers() {
        let request = AskRequest {
            questions: vec![
                AskQuestion::new("第一问"),
                AskQuestion {
                    question: "第二问".to_string(),
                    header: Some("mode".to_string()),
                    options: vec![
                        aster::tools::AskOption::with_label("auto", "自动执行"),
                        aster::tools::AskOption::with_label("confirm", "确认后执行"),
                    ],
                    multi_select: false,
                },
            ],
        };

        let response = extract_response(
            &request,
            &serde_json::json!({
                "question_1": "先看结构",
                "mode": "确认后执行"
            }),
        )
        .expect("expected normalized response");

        assert_eq!(
            response,
            serde_json::json!({
                "answers": {
                    "第一问": "先看结构",
                    "第二问": "confirm"
                }
            })
        );
    }

    #[test]
    fn extract_response_normalizes_multi_select_answers() {
        let request = AskRequest {
            questions: vec![AskQuestion {
                question: "请选择能力".to_string(),
                header: Some("skills".to_string()),
                options: vec![
                    aster::tools::AskOption::with_label("analysis", "分析"),
                    aster::tools::AskOption::with_label("coding", "编码"),
                ],
                multi_select: true,
            }],
        };

        let response = extract_response(
            &request,
            &serde_json::json!({
                "answer": ["分析", "编码"]
            }),
        )
        .expect("expected normalized response");

        assert_eq!(
            response,
            serde_json::json!({
                "answer": "analysis, coding",
                "answers": {
                    "请选择能力": "analysis, coding"
                }
            })
        );
    }
}
