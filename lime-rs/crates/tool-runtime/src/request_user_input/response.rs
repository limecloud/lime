use super::{
    RequestUserInputAnnotation, RequestUserInputQuestion, RequestUserInputRequest,
    RequestUserInputResult, RequestUserInputSurfaceError, requested_schema_field_key,
};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

fn elicitation_field_key(
    question: &RequestUserInputQuestion,
    index: usize,
    total: usize,
) -> String {
    if total == 1 {
        if let Some(header) = question.header.as_deref() {
            let trimmed = header.trim();
            if !trimmed.is_empty() {
                return trimmed.to_string();
            }
        }
        return "answer".to_string();
    }

    if let Some(header) = question.header.as_deref() {
        let normalized = header.trim().to_string();
        if !normalized.is_empty() {
            return normalized;
        }
    }

    format!("question_{}", index + 1)
}

fn normalize_answer_value(question: &RequestUserInputQuestion, value: &Value) -> Option<String> {
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
                Value::Number(number) => Some(number.to_string()),
                Value::Bool(value) => Some(value.to_string()),
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

fn answer_candidate_keys(
    question: &RequestUserInputQuestion,
    index: usize,
    total: usize,
) -> Vec<String> {
    let mut keys = vec![
        question.id.clone().unwrap_or_default(),
        question.question.clone(),
        question.header.clone().unwrap_or_default(),
        requested_schema_field_key(question, index, total),
        elicitation_field_key(question, index, total),
    ];
    if total == 1 {
        keys.push("answer".to_string());
        keys.push("other".to_string());
    }
    keys
}

fn collect_answers(
    request: &RequestUserInputRequest,
    user_data: &Value,
) -> BTreeMap<String, String> {
    let mut answers = BTreeMap::new();
    let total = request.questions.len();

    match user_data {
        Value::String(_) | Value::Array(_) | Value::Number(_) | Value::Bool(_) => {
            if let Some(question) = request.questions.first() {
                if let Some(answer) = normalize_answer_value(question, user_data) {
                    answers.insert(question.question.clone(), answer);
                }
            }
            return answers;
        }
        Value::Object(map) => {
            if let Some(Value::Object(existing_answers)) = map.get("answers") {
                for question in &request.questions {
                    if let Some(value) = existing_answers.get(&question.question) {
                        if let Some(answer) = normalize_answer_value(question, value) {
                            answers.insert(question.question.clone(), answer);
                        }
                    }
                }
            }

            for (index, question) in request.questions.iter().enumerate() {
                if answers.contains_key(&question.question) {
                    continue;
                }

                for key in answer_candidate_keys(question, index, total) {
                    if key.is_empty() {
                        continue;
                    }

                    if let Some(value) = map.get(&key) {
                        if let Some(answer) = normalize_answer_value(question, value) {
                            answers.insert(question.question.clone(), answer);
                            break;
                        }
                    }
                }
            }
        }
        _ => {}
    }

    answers
}

fn collect_annotations(
    request: &RequestUserInputRequest,
    response: &Value,
) -> BTreeMap<String, RequestUserInputAnnotation> {
    let Some(map) = response.as_object() else {
        return BTreeMap::new();
    };
    let Some(Value::Object(annotation_map)) = map.get("annotations") else {
        return BTreeMap::new();
    };

    let total = request.questions.len();
    let mut annotations = BTreeMap::new();
    for (index, question) in request.questions.iter().enumerate() {
        for key in answer_candidate_keys(question, index, total) {
            if key.is_empty() {
                continue;
            }
            let Some(Value::Object(entry)) = annotation_map.get(&key) else {
                continue;
            };
            let preview = entry
                .get("preview")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            let notes = entry
                .get("notes")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_string);
            if preview.is_some() || notes.is_some() {
                annotations.insert(
                    question.question.clone(),
                    RequestUserInputAnnotation { preview, notes },
                );
                break;
            }
        }
    }

    annotations
}

fn resolve_option_match(
    question: &RequestUserInputQuestion,
    answer: Option<&str>,
) -> (bool, Option<usize>) {
    let Some(answer) = answer.map(str::trim).filter(|value| !value.is_empty()) else {
        return (false, None);
    };

    for (index, option) in question.options.iter().enumerate() {
        if answer == option.value || answer == option.display() {
            return (true, Some(index));
        }
    }

    (false, None)
}

pub fn normalize_request_user_input_result(
    request: &RequestUserInputRequest,
    response: Value,
) -> Result<RequestUserInputResult, RequestUserInputSurfaceError> {
    let mut answers = collect_answers(request, &response);
    let annotations = collect_annotations(request, &response);
    if answers.is_empty() {
        return Err(RequestUserInputSurfaceError::execution_failed(
            "User response was empty or could not be normalized",
        ));
    }

    let (from_option, option_index) = if request.questions.len() == 1 {
        let question = &request.questions[0];
        let answer = answers.get(&question.question).map(String::as_str);
        let (from_option, option_index) = resolve_option_match(question, answer);
        if let Some(index) = option_index {
            if let Some(option) = question.options.get(index) {
                answers.insert(question.question.clone(), option.value.clone());
            }
        }
        (from_option, option_index)
    } else {
        (false, None)
    };

    Ok(RequestUserInputResult::new(
        response,
        answers,
        annotations,
        from_option,
        option_index,
    ))
}

pub fn extract_response(request: &RequestUserInputRequest, user_data: &Value) -> Option<Value> {
    let answers = collect_answers(request, user_data);
    if answers.is_empty() {
        return None;
    }

    if request.questions.len() == 1 {
        let question_text = request.questions[0].question.clone();
        let answer = answers.get(&question_text)?.clone();
        let mut normalized_answers = Map::new();
        normalized_answers.insert(question_text, Value::String(answer.clone()));
        return Some(json!({
            "answer": answer,
            "answers": normalized_answers
        }));
    }

    Some(json!({ "answers": answers }))
}

pub fn build_elicitation_message(request: &RequestUserInputRequest) -> String {
    if request.questions.len() == 1 {
        return request.questions[0].question.trim().to_string();
    }

    let question_list = request
        .questions
        .iter()
        .enumerate()
        .map(|(index, question)| format!("{}. {}", index + 1, question.question.trim()))
        .collect::<Vec<_>>()
        .join("\n");
    format!("Please answer the following questions:\n{question_list}")
}

pub fn build_elicitation_schema(request: &RequestUserInputRequest) -> Value {
    let total = request.questions.len();
    let mut properties = Map::new();
    let mut required = Vec::with_capacity(total);

    for (index, question) in request.questions.iter().enumerate() {
        let field_key = elicitation_field_key(question, index, total);
        required.push(field_key.clone());

        let description = if question.multi_select {
            let choices = question
                .options
                .iter()
                .map(|option| option.display().to_string())
                .collect::<Vec<_>>()
                .join(", ");
            if choices.is_empty() {
                format!(
                    "{} Separate multiple selections with commas.",
                    question.question
                )
            } else {
                format!(
                    "{} Separate multiple selections with commas. Available choices: {}.",
                    question.question, choices
                )
            }
        } else {
            question.question.clone()
        };

        let mut property = json!({
            "type": "string",
            "description": description,
            "minLength": 1
        });

        if !question.multi_select {
            let labels = question
                .options
                .iter()
                .map(|option| option.display().to_string())
                .collect::<Vec<_>>();
            if !labels.is_empty() {
                property["enum"] = json!(labels);
            }
        }

        properties.insert(field_key, property);
    }

    Value::Object(
        [
            ("type".to_string(), Value::String("object".to_string())),
            (
                "title".to_string(),
                Value::String("User input required".to_string()),
            ),
            (
                "description".to_string(),
                Value::String(
                    "Provide the requested answers so the agent can continue.".to_string(),
                ),
            ),
            ("properties".to_string(), Value::Object(properties)),
            ("required".to_string(), json!(required)),
        ]
        .into_iter()
        .collect(),
    )
}
