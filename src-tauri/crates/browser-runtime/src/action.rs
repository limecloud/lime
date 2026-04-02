use crate::manager::CdpSessionHandle;
use crate::types::{BrowserEvent, BrowserEventPayload, BrowserPageInfo};
use chrono::Utc;
use serde_json::{json, Value};
use std::time::{Duration, Instant};
use tokio::sync::broadcast;

const DEFAULT_ACTION_TIMEOUT_MS: u64 = 15_000;
const NAVIGATION_POLL_INTERVAL_MS: u64 = 250;

pub async fn execute_action(
    session: &CdpSessionHandle,
    action: &str,
    args: Value,
) -> Result<Value, String> {
    match action {
        "navigate" => navigate(session, &args).await,
        "click" => click(session, &args).await,
        "type" | "form_input" => type_text(session, &args).await,
        "javascript" => execute_javascript(session, &args).await,
        "scroll" | "scroll_page" => scroll(session, &args).await,
        "refresh_page" => evaluate_navigation(session, "window.location.reload()").await,
        "go_back" => evaluate_navigation(session, "window.history.back()").await,
        "go_forward" => evaluate_navigation(session, "window.history.forward()").await,
        "get_page_info" | "read_page" | "get_page_text" => {
            let page = session.capture_page_info().await?;
            Ok(json!({
                "tab": {
                    "id": session.state().await.target_id,
                    "title": page.title,
                    "url": page.url,
                },
                "markdown": page.markdown,
                "page_info": page,
            }))
        }
        "find" => find_in_page(session, &args).await,
        "read_console_messages" => {
            let events =
                session.collect_console_messages(args.get("since").and_then(Value::as_u64));
            Ok(json!({ "messages": events }))
        }
        "read_network_requests" => {
            let events = session.collect_network_events(args.get("since").and_then(Value::as_u64));
            Ok(json!({ "events": events }))
        }
        _ => Err(format!("CDP 直连不支持动作: {action}")),
    }
}

async fn navigate(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    let nav_action = get_string_arg(args, &["action"]).unwrap_or_else(|| "goto".to_string());
    if nav_action != "goto" {
        return Err(format!(
            "CDP 直连当前仅支持 navigate.action=goto，收到: {nav_action}"
        ));
    }
    let url = get_string_arg(args, &["url"]).ok_or_else(|| "navigate 需要提供 url".to_string())?;
    let wait_timeout_ms = get_u64_arg(args, &["timeout_ms"]).unwrap_or(DEFAULT_ACTION_TIMEOUT_MS);
    let command_timeout_ms = resolve_navigation_command_timeout_ms(wait_timeout_ms);
    let previous_url = session
        .state()
        .await
        .last_page_info
        .as_ref()
        .map(|page| page.url.clone())
        .filter(|value| !value.trim().is_empty());
    let mut event_rx = session.subscribe();
    let response = session
        .send_command("Page.navigate", json!({ "url": url }), command_timeout_ms)
        .await?;
    if let Some(error_text) = response
        .get("errorText")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Err(format!("导航失败: {error_text}"));
    }
    let page = wait_for_navigation_page(
        session,
        Some(url.as_str()),
        previous_url.as_deref(),
        wait_timeout_ms,
        &mut event_rx,
    )
    .await
    .unwrap_or(BrowserPageInfo {
        title: url.clone(),
        url: url.clone(),
        markdown: format!("# {}\nURL: {}", url, url),
        updated_at: Utc::now().to_rfc3339(),
    });
    Ok(json!({
        "url": url,
        "page_info": page,
    }))
}

async fn click(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    if let (Some(x), Some(y)) = (
        args.get("x").and_then(Value::as_f64),
        args.get("y").and_then(Value::as_f64),
    ) {
        session
            .send_command(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mousePressed",
                    "x": x,
                    "y": y,
                    "button": "left",
                    "clickCount": 1,
                }),
                DEFAULT_ACTION_TIMEOUT_MS,
            )
            .await?;
        session
            .send_command(
                "Input.dispatchMouseEvent",
                json!({
                    "type": "mouseReleased",
                    "x": x,
                    "y": y,
                    "button": "left",
                    "clickCount": 1,
                }),
                DEFAULT_ACTION_TIMEOUT_MS,
            )
            .await?;
        return Ok(json!({ "clicked": true, "x": x, "y": y }));
    }

    let selector = get_string_arg(args, &["selector", "target", "ref_id"])
        .ok_or_else(|| "click 需要 selector 或坐标".to_string())?;
    session
        .runtime_evaluate(
            format!(
                r#"
(() => {{
  const element = document.querySelector({selector});
  if (!element) {{
    return {{ ok: false, error: "未找到元素" }};
  }}
  element.click();
  return {{ ok: true }};
}})()
"#,
                selector = serde_json::to_string(&selector)
                    .map_err(|e| format!("编码 selector 失败: {e}"))?
            ),
            true,
            DEFAULT_ACTION_TIMEOUT_MS,
        )
        .await?;
    Ok(json!({ "clicked": true, "selector": selector }))
}

async fn type_text(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    let text = get_string_arg(args, &["text", "value"])
        .ok_or_else(|| "type 需要 text/value 参数".to_string())?;
    if let Some(selector) = get_string_arg(args, &["selector", "target", "ref_id"]) {
        session
            .runtime_evaluate(
                format!(
                    r#"
(() => {{
  const element = document.querySelector({selector});
  if (!element) {{
    return {{ ok: false, error: "未找到输入元素" }};
  }}
  element.focus();
  if ("value" in element) {{
    element.value = {text};
    element.dispatchEvent(new Event("input", {{ bubbles: true }}));
    element.dispatchEvent(new Event("change", {{ bubbles: true }}));
  }} else {{
    element.textContent = {text};
  }}
  return {{ ok: true }};
}})()
"#,
                    selector = serde_json::to_string(&selector)
                        .map_err(|e| format!("编码 selector 失败: {e}"))?,
                    text =
                        serde_json::to_string(&text).map_err(|e| format!("编码文本失败: {e}"))?,
                ),
                true,
                DEFAULT_ACTION_TIMEOUT_MS,
            )
            .await?;
        return Ok(json!({ "typed": true, "selector": selector }));
    }

    session
        .send_command(
            "Input.insertText",
            json!({
                "text": text,
            }),
            DEFAULT_ACTION_TIMEOUT_MS,
        )
        .await?;
    Ok(json!({ "typed": true }))
}

async fn scroll(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    let direction = get_string_arg(args, &["direction"]).unwrap_or_else(|| "down".to_string());
    let amount = args
        .get("amount")
        .and_then(Value::as_i64)
        .unwrap_or(500)
        .max(1);
    let signed_amount = if direction.eq_ignore_ascii_case("up") {
        -amount
    } else {
        amount
    };
    if let Some(selector) = get_string_arg(args, &["selector", "target", "ref_id"]) {
        session
            .runtime_evaluate(
                format!(
                    r#"
(() => {{
  const element = document.querySelector({selector});
  if (!element) {{
    return {{ ok: false, error: "未找到滚动元素" }};
  }}
  element.scrollBy({{ top: {amount}, behavior: "instant" }});
  return {{ ok: true }};
}})()
"#,
                    selector = serde_json::to_string(&selector)
                        .map_err(|e| format!("编码 selector 失败: {e}"))?,
                    amount = signed_amount,
                ),
                true,
                DEFAULT_ACTION_TIMEOUT_MS,
            )
            .await?;
        return Ok(json!({ "scrolled": true, "selector": selector, "amount": signed_amount }));
    }

    session
        .runtime_evaluate(
            format!("window.scrollBy({{ top: {signed_amount}, behavior: \"instant\" }});"),
            false,
            DEFAULT_ACTION_TIMEOUT_MS,
        )
        .await?;
    Ok(json!({ "scrolled": true, "amount": signed_amount }))
}

async fn execute_javascript(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    let expression = get_string_arg(
        args,
        &[
            "expression",
            "script",
            "code",
            "javascript",
            "text",
            "value",
        ],
    )
    .ok_or_else(|| "javascript 需要 expression/script/code 参数".to_string())?;
    let return_by_value = args
        .get("return_by_value")
        .and_then(Value::as_bool)
        .unwrap_or(true);
    let timeout_ms = get_u64_arg(args, &["timeout_ms"]).unwrap_or(DEFAULT_ACTION_TIMEOUT_MS);
    let result = session
        .runtime_evaluate(expression.clone(), return_by_value, timeout_ms)
        .await?;
    Ok(json!({
        "evaluated": true,
        "expression": expression,
        "result": result,
    }))
}

async fn find_in_page(session: &CdpSessionHandle, args: &Value) -> Result<Value, String> {
    let query =
        get_string_arg(args, &["query"]).ok_or_else(|| "find 需要提供 query 参数".to_string())?;
    let page = if let Some(page_info) = capture_and_sync_page_info(session).await {
        page_info
    } else if let Some(page_info) = session.state().await.last_page_info.clone() {
        page_info
    } else {
        return Err("读取页面信息失败".to_string());
    };
    let matches = find_markdown_matches(&page.markdown, &query, 30);
    Ok(json!({
        "query": query,
        "match_count": matches.len(),
        "matches": matches,
        "page_info": page,
    }))
}

async fn evaluate_navigation(session: &CdpSessionHandle, script: &str) -> Result<Value, String> {
    let previous_url = session
        .state()
        .await
        .last_page_info
        .as_ref()
        .map(|page| page.url.clone())
        .filter(|value| !value.trim().is_empty());
    let mut event_rx = session.subscribe();
    session
        .runtime_evaluate(script.to_string(), false, DEFAULT_ACTION_TIMEOUT_MS)
        .await?;
    let page = if let Some(page_info) = wait_for_navigation_page(
        session,
        None,
        previous_url.as_deref(),
        DEFAULT_ACTION_TIMEOUT_MS,
        &mut event_rx,
    )
    .await
    {
        page_info
    } else if let Some(page_info) = session.state().await.last_page_info.clone() {
        page_info
    } else {
        capture_and_sync_page_info(session)
            .await
            .ok_or_else(|| "读取页面信息失败".to_string())?
    };
    Ok(json!({ "page_info": page }))
}

async fn wait_for_navigation_page(
    session: &CdpSessionHandle,
    expected_url: Option<&str>,
    previous_url: Option<&str>,
    timeout_ms: u64,
    event_rx: &mut broadcast::Receiver<BrowserEvent>,
) -> Option<BrowserPageInfo> {
    let started_at = Instant::now();
    let timeout = Duration::from_millis(timeout_ms.max(500));

    while started_at.elapsed() < timeout {
        let remaining = timeout.saturating_sub(started_at.elapsed());
        let wait_window = remaining.min(Duration::from_millis(NAVIGATION_POLL_INTERVAL_MS));
        match tokio::time::timeout(wait_window, event_rx.recv()).await {
            Ok(Ok(event)) => {
                if let Some(page_info) = page_info_from_event(&event) {
                    if should_accept_navigation_page(
                        Some(page_info.url.as_str()),
                        expected_url,
                        previous_url,
                    ) {
                        return session
                            .state()
                            .await
                            .last_page_info
                            .clone()
                            .or(Some(page_info));
                    }
                }
            }
            Ok(Err(broadcast::error::RecvError::Lagged(_))) | Err(_) => {
                if let Some(page_info) = capture_and_sync_page_info(session).await {
                    if should_accept_navigation_page(
                        Some(page_info.url.as_str()),
                        expected_url,
                        previous_url,
                    ) {
                        return Some(page_info);
                    }
                }
            }
            Ok(Err(broadcast::error::RecvError::Closed)) => break,
        }
    }

    capture_and_sync_page_info(session).await
}

fn page_info_from_event(event: &BrowserEvent) -> Option<BrowserPageInfo> {
    match &event.payload {
        BrowserEventPayload::PageInfoChanged {
            title,
            url,
            markdown,
        } => Some(BrowserPageInfo {
            title: title.clone(),
            url: url.clone(),
            markdown: markdown.clone(),
            updated_at: Utc::now().to_rfc3339(),
        }),
        _ => None,
    }
}

async fn capture_and_sync_page_info(session: &CdpSessionHandle) -> Option<BrowserPageInfo> {
    let page_info = session.capture_page_info().await.ok()?;
    let current_page_info = session.state().await.last_page_info;
    let should_update = current_page_info.as_ref().is_none_or(|current| {
        current.url != page_info.url
            || current.title != page_info.title
            || current.markdown != page_info.markdown
    });
    if should_update {
        session.update_page_info(page_info.clone()).await;
    }
    Some(page_info)
}

fn should_accept_navigation_page(
    current_url: Option<&str>,
    expected_url: Option<&str>,
    previous_url: Option<&str>,
) -> bool {
    let Some(current_url) = current_url.map(str::trim).filter(|value| !value.is_empty()) else {
        return false;
    };

    if expected_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some_and(|expected_url| urls_equivalent(current_url, expected_url))
    {
        return true;
    }

    match previous_url
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(previous_url) => !urls_equivalent(current_url, previous_url),
        None => true,
    }
}

fn urls_equivalent(left: &str, right: &str) -> bool {
    normalize_url_for_navigation(left) == normalize_url_for_navigation(right)
}

fn normalize_url_for_navigation(url: &str) -> String {
    let trimmed = url.trim();
    if trimmed.len() > "https://".len() {
        trimmed.trim_end_matches('/').to_string()
    } else {
        trimmed.to_string()
    }
}

fn find_markdown_matches(markdown: &str, query: &str, limit: usize) -> Vec<String> {
    let normalized_query = query.trim().to_ascii_lowercase();
    if normalized_query.is_empty() {
        return Vec::new();
    }
    markdown
        .lines()
        .filter(|line| line.to_ascii_lowercase().contains(&normalized_query))
        .take(limit)
        .map(str::to_string)
        .collect()
}

fn get_string_arg(args: &Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        args.get(*key)
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToString::to_string)
    })
}

fn get_u64_arg(args: &Value, keys: &[&str]) -> Option<u64> {
    keys.iter()
        .find_map(|key| args.get(*key).and_then(Value::as_u64))
}

fn resolve_navigation_command_timeout_ms(wait_timeout_ms: u64) -> u64 {
    wait_timeout_ms.max(DEFAULT_ACTION_TIMEOUT_MS)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn should_keep_navigation_command_timeout_at_least_default() {
        assert_eq!(
            resolve_navigation_command_timeout_ms(5_000),
            DEFAULT_ACTION_TIMEOUT_MS
        );
        assert_eq!(resolve_navigation_command_timeout_ms(20_000), 20_000);
    }

    #[test]
    fn should_accept_exact_expected_url_even_when_previous_matches() {
        assert!(should_accept_navigation_page(
            Some("https://github.com/search?q=mcp&type=repositories"),
            Some("https://github.com/search?q=mcp&type=repositories"),
            Some("https://github.com/search?q=mcp&type=repositories"),
        ));
    }

    #[test]
    fn should_accept_url_change_when_expected_differs_only_by_query_order() {
        assert!(should_accept_navigation_page(
            Some("https://github.com/search?type=repositories&q=model%20context%20protocol"),
            Some("https://github.com/search?q=model%20context%20protocol&type=repositories"),
            Some("https://www.36kr.com/newsflashes"),
        ));
    }

    #[test]
    fn should_reject_stale_previous_url() {
        assert!(!should_accept_navigation_page(
            Some("https://www.36kr.com/newsflashes"),
            Some("https://search.bilibili.com/all?keyword=AI%20Agent"),
            Some("https://www.36kr.com/newsflashes"),
        ));
    }

    #[test]
    fn find_markdown_matches_should_match_case_insensitively_and_limit_results() {
        let markdown = [
            "# GitHub",
            "AI Agent Starter",
            "agent framework",
            "AGENT runtime",
            "plain text",
        ]
        .join("\n");

        assert_eq!(
            find_markdown_matches(&markdown, "agent", 2),
            vec![
                "AI Agent Starter".to_string(),
                "agent framework".to_string(),
            ]
        );
    }
}
