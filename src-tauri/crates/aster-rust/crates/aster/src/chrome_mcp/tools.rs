//! Chrome MCP 工具定义
//! 与官方 Claude Code 保持一致的 17 个工具

use serde::{Deserialize, Serialize};
use serde_json::json;

/// MCP 工具定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct McpTool {
    pub name: String,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: serde_json::Value,
}

/// 获取所有 Chrome MCP 工具定义
pub fn get_chrome_mcp_tools() -> Vec<McpTool> {
    vec![
        javascript_tool(),
        read_page(),
        find(),
        form_input(),
        computer(),
        navigate(),
        resize_window(),
        gif_creator(),
        upload_image(),
        get_page_text(),
        tabs_context_mcp(),
        tabs_create_mcp(),
        update_plan(),
        read_console_messages(),
        read_network_requests(),
        shortcuts_list(),
        shortcuts_execute(),
    ]
}

fn javascript_tool() -> McpTool {
    McpTool {
        name: "javascript_tool".to_string(),
        description: "Execute JavaScript code in the context of the current page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "description": "Must be set to 'javascript_exec'" },
                "text": { "type": "string", "description": "The JavaScript code to execute" },
                "tabId": { "type": "number", "description": "Tab ID to execute the code in" }
            },
            "required": ["action", "text", "tabId"]
        }),
    }
}

fn read_page() -> McpTool {
    McpTool {
        name: "read_page".to_string(),
        description: "Get an accessibility tree representation of elements on the page."
            .to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "filter": { "type": "string", "enum": ["interactive", "all"] },
                "tabId": { "type": "number", "description": "Tab ID to read from" },
                "depth": { "type": "number", "description": "Maximum depth of the tree" },
                "ref_id": { "type": "string", "description": "Reference ID of parent element" }
            },
            "required": ["tabId"]
        }),
    }
}

fn find() -> McpTool {
    McpTool {
        name: "find".to_string(),
        description: "Find elements on the page using natural language.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "query": { "type": "string", "description": "Natural language description" },
                "tabId": { "type": "number", "description": "Tab ID to search in" }
            },
            "required": ["query", "tabId"]
        }),
    }
}

fn form_input() -> McpTool {
    McpTool {
        name: "form_input".to_string(),
        description: "Fill in form fields on the page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "ref_id": { "type": "string", "description": "Reference ID of the form element" },
                "value": { "type": "string", "description": "Value to fill in" },
                "tabId": { "type": "number", "description": "Tab ID containing the form" }
            },
            "required": ["ref_id", "value", "tabId"]
        }),
    }
}

fn computer() -> McpTool {
    McpTool {
        name: "computer".to_string(),
        description: "Perform mouse and keyboard actions on the page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["click", "type", "scroll", "key", "move", "drag"] },
                "ref_id": { "type": "string" },
                "text": { "type": "string" },
                "coordinate": { "type": "array", "items": { "type": "number" } },
                "direction": { "type": "string", "enum": ["up", "down", "left", "right"] },
                "amount": { "type": "number" },
                "tabId": { "type": "number" }
            },
            "required": ["action", "tabId"]
        }),
    }
}

fn navigate() -> McpTool {
    McpTool {
        name: "navigate".to_string(),
        description: "Navigate to a URL or perform browser navigation actions.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "URL to navigate to" },
                "action": { "type": "string", "enum": ["goto", "back", "forward", "reload"] },
                "tabId": { "type": "number" }
            },
            "required": ["tabId"]
        }),
    }
}

fn resize_window() -> McpTool {
    McpTool {
        name: "resize_window".to_string(),
        description: "Resize the browser window to specific dimensions.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "width": { "type": "number", "description": "Window width in pixels" },
                "height": { "type": "number", "description": "Window height in pixels" },
                "tabId": { "type": "number" }
            },
            "required": ["width", "height", "tabId"]
        }),
    }
}

fn gif_creator() -> McpTool {
    McpTool {
        name: "gif_creator".to_string(),
        description: "Manage GIF recording and export for browser automation sessions.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "action": { "type": "string", "enum": ["start", "stop", "capture", "export", "status"] },
                "filename": { "type": "string" },
                "tabId": { "type": "number" }
            },
            "required": ["action"]
        }),
    }
}

fn upload_image() -> McpTool {
    McpTool {
        name: "upload_image".to_string(),
        description: "Upload an image to a file input element on the page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "ref_id": { "type": "string" },
                "image_data": { "type": "string", "description": "Base64-encoded image data" },
                "file_path": { "type": "string", "description": "Local file path to upload" },
                "tabId": { "type": "number" }
            },
            "required": ["ref_id", "tabId"]
        }),
    }
}

fn get_page_text() -> McpTool {
    McpTool {
        name: "get_page_text".to_string(),
        description: "Get the text content of the current page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "tabId": { "type": "number" }
            },
            "required": ["tabId"]
        }),
    }
}

fn tabs_context_mcp() -> McpTool {
    McpTool {
        name: "tabs_context_mcp".to_string(),
        description: "Get information about currently open browser tabs.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "createIfEmpty": { "type": "boolean" }
            },
            "required": []
        }),
    }
}

fn tabs_create_mcp() -> McpTool {
    McpTool {
        name: "tabs_create_mcp".to_string(),
        description: "Creates a new empty tab in the MCP tab group.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "url": { "type": "string", "description": "Optional URL to navigate to" }
            },
            "required": []
        }),
    }
}

fn update_plan() -> McpTool {
    McpTool {
        name: "update_plan".to_string(),
        description: "Update the current automation plan displayed to the user.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "plan": { "type": "string", "description": "The updated plan text" }
            },
            "required": ["plan"]
        }),
    }
}

fn read_console_messages() -> McpTool {
    McpTool {
        name: "read_console_messages".to_string(),
        description: "Read console messages from the browser developer tools.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Regex pattern to filter" },
                "tabId": { "type": "number" },
                "limit": { "type": "number", "description": "Maximum number of messages" }
            },
            "required": ["tabId"]
        }),
    }
}

fn read_network_requests() -> McpTool {
    McpTool {
        name: "read_network_requests".to_string(),
        description: "Read network requests made by the page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "pattern": { "type": "string", "description": "Regex pattern to filter by URL" },
                "tabId": { "type": "number" },
                "limit": { "type": "number" }
            },
            "required": ["tabId"]
        }),
    }
}

fn shortcuts_list() -> McpTool {
    McpTool {
        name: "shortcuts_list".to_string(),
        description: "List available keyboard shortcuts for the current page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "tabId": { "type": "number" }
            },
            "required": ["tabId"]
        }),
    }
}

fn shortcuts_execute() -> McpTool {
    McpTool {
        name: "shortcuts_execute".to_string(),
        description: "Execute a keyboard shortcut on the page.".to_string(),
        input_schema: json!({
            "type": "object",
            "properties": {
                "shortcut": { "type": "string", "description": "Keyboard shortcut to execute" },
                "tabId": { "type": "number" }
            },
            "required": ["shortcut", "tabId"]
        }),
    }
}

/// 获取工具名称列表（带 MCP 前缀）
pub fn get_tool_names_with_prefix() -> Vec<String> {
    get_chrome_mcp_tools()
        .iter()
        .map(|tool| format!("mcp__claude-in-chrome__{}", tool.name))
        .collect()
}

/// Chrome MCP 工具常量
pub const CHROME_MCP_TOOLS: &[&str] = &[
    "javascript_tool",
    "read_page",
    "find",
    "form_input",
    "computer",
    "navigate",
    "resize_window",
    "gif_creator",
    "upload_image",
    "get_page_text",
    "tabs_context_mcp",
    "tabs_create_mcp",
    "update_plan",
    "read_console_messages",
    "read_network_requests",
    "shortcuts_list",
    "shortcuts_execute",
];
