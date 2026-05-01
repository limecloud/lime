//! 语音文本处理服务
//!
//! 提供语音识别文本的 Prompt 套用与 LLM 润色能力。

use lime_core::config::VoiceInstruction;

/// 处理文本（应用指令模板）
pub fn process_text(text: &str, instruction: &VoiceInstruction) -> String {
    voice_core::text_polish::apply_prompt_template(text, &instruction.prompt)
}

/// 使用 LLM 润色文本
///
/// 通过本地 API 服务器调用 LLM 进行文本润色。
pub async fn polish_text(
    text: &str,
    instruction: &VoiceInstruction,
    provider: Option<&str>,
    model: Option<&str>,
) -> Result<String, String> {
    if instruction.id == "raw" {
        return Ok(text.to_string());
    }

    let prompt = process_text(text, instruction);
    match call_local_llm(&prompt, provider, model, &instruction.id).await {
        Ok(polished) => Ok(polished),
        Err(error) => {
            tracing::warn!("[语音润色] LLM 润色失败，使用本地轻量清理: {}", error);
            Ok(fallback_polish_text(text))
        }
    }
}

/// LLM 不可用时的轻量清理，避免把 ASR 常见重复词直接暴露给用户。
fn fallback_polish_text(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return String::new();
    }

    let collapsed = collapse_repeated_cjk_phrases(trimmed);
    collapse_repeated_punctuation(&collapsed)
}

fn collapse_repeated_cjk_phrases(text: &str) -> String {
    let chars = text.chars().collect::<Vec<_>>();
    let mut output = Vec::with_capacity(chars.len());
    let mut index = 0;

    while index < chars.len() {
        let mut collapsed = false;
        for size in (1..=4).rev() {
            if index + size * 2 > chars.len() {
                continue;
            }
            let chunk = &chars[index..index + size];
            if !chunk.iter().all(|char| is_cjk_char(*char)) {
                continue;
            }

            let mut repeats = 1;
            while index + size * (repeats + 1) <= chars.len()
                && chars[index..index + size]
                    == chars[index + size * repeats..index + size * (repeats + 1)]
            {
                repeats += 1;
            }

            if repeats > 1 {
                output.extend_from_slice(chunk);
                index += size * repeats;
                collapsed = true;
                break;
            }
        }

        if !collapsed {
            output.push(chars[index]);
            index += 1;
        }
    }

    output.into_iter().collect()
}

fn collapse_repeated_punctuation(text: &str) -> String {
    let mut output = String::with_capacity(text.len());
    let mut previous: Option<char> = None;
    for char in text.chars() {
        if matches!(char, '。' | '，' | ',' | '.' | '！' | '!' | '？' | '?')
            && previous == Some(char)
        {
            continue;
        }
        output.push(char);
        previous = Some(char);
    }
    output
}

fn is_cjk_char(char: char) -> bool {
    matches!(
        char as u32,
        0x4E00..=0x9FFF | 0x3400..=0x4DBF | 0xF900..=0xFAFF
    )
}

/// 调用本地 API 服务器进行 LLM 推理
async fn call_local_llm(
    prompt: &str,
    provider: Option<&str>,
    model: Option<&str>,
    instruction_id: &str,
) -> Result<String, String> {
    use lime_core::config::load_config;

    let config = load_config().map_err(|e| e.to_string())?;
    let base_url = format!("http://{}:{}", config.server.host, config.server.port);
    let api_key = &config.server.api_key;

    voice_core::text_polish::polish_with_local_api(
        &base_url,
        api_key,
        prompt,
        provider,
        model,
        instruction_id,
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::fallback_polish_text;

    #[test]
    fn fallback_polish_collapses_repeated_cjk_phrase() {
        assert_eq!(fallback_polish_text("你好你好你好。"), "你好。");
    }

    #[test]
    fn fallback_polish_keeps_non_repeated_text() {
        assert_eq!(fallback_polish_text("帮我写一段介绍。"), "帮我写一段介绍。");
    }
}
