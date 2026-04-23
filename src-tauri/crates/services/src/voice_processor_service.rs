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
    call_local_llm(&prompt, provider, model, &instruction.id).await
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
