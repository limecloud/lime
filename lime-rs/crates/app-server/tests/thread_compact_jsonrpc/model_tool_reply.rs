use super::{json, Value, Wire};

impl Wire {
    pub(super) fn custom_tool_response(self, call_id: &str, name: &str, input: &str) -> String {
        assert!(
            matches!(self, Self::Responses),
            "custom tools require Responses"
        );
        let id = format!("custom-{call_id}");
        let item = json!({"type":"custom_tool_call","id":id,"call_id":call_id,
            "name":name,"input":input,"status":"completed"});
        [
            json!({"type":"response.output_item.added","output_index":0,
                "item":{"type":"custom_tool_call","id":id,"call_id":call_id,"name":name,"input":""}}),
            json!({"type":"response.custom_tool_call_input.delta","item_id":id,
                "output_index":0,"delta":input}),
            json!({"type":"response.custom_tool_call_input.done","item_id":id,
                "output_index":0,"input":input}),
            json!({"type":"response.output_item.done","output_index":0,"item":item}),
            json!({"type":"response.completed","response":{"id":"custom-step","output":[item]}}),
        ]
        .iter()
        .map(|event| format!("data: {event}\n\n"))
        .collect()
    }

    pub(super) fn tool_response(self, call_id: &str, name: &str, arguments: &Value) -> String {
        let args = serde_json::to_string_pretty(arguments).unwrap();
        let events = match self {
            Self::Chat => vec![
                json!({"id":"tool-step","object":"chat.completion.chunk","created":0,"model":self.model(),"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":call_id,"type":"function","function":{"name":name,"arguments":args}}]},"finish_reason":null}]}),
                json!({"id":"tool-step","object":"chat.completion.chunk","created":0,"model":self.model(),"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}),
            ],
            Self::Responses => vec![
                json!({"type":"response.output_item.added","output_index":0,"item":{"type":"function_call","id":format!("fc-{call_id}"),"call_id":call_id,"name":name,"arguments":""}}),
                json!({"type":"response.function_call_arguments.delta","item_id":format!("fc-{call_id}"),"output_index":0,"delta":args}),
                json!({"type":"response.function_call_arguments.done","item_id":format!("fc-{call_id}"),"output_index":0,"arguments":args}),
                json!({"type":"response.output_item.done","output_index":0,"item":{"type":"function_call","id":format!("fc-{call_id}"),"call_id":call_id,"name":name,"arguments":args,"status":"completed"}}),
                json!({"type":"response.completed","response":{"id":"tool-step","output":[{"type":"function_call","id":format!("fc-{call_id}"),"call_id":call_id,"name":name,"arguments":args,"status":"completed"}]}}),
            ],
            Self::Anthropic => vec![
                json!({"type":"message_start","message":{"id":"tool-step","type":"message","role":"assistant","model":self.model(),"usage":{"input_tokens":100,"output_tokens":0}}}),
                json!({"type":"content_block_start","index":0,"content_block":{"type":"tool_use","id":call_id,"name":name,"input":{}}}),
                json!({"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":args}}),
                json!({"type":"content_block_stop","index":0}),
                json!({"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":20}}),
                json!({"type":"message_stop"}),
            ],
            Self::Gemini => vec![
                json!({"candidates":[{"index":0,"content":{"role":"model","parts":[{"functionCall":{"id":call_id,"name":name,"args":arguments}}]}}]}),
                json!({"candidates":[{"index":0,"finishReason":"STOP"}],"usageMetadata":{"promptTokenCount":100,"candidatesTokenCount":20,"totalTokenCount":120}}),
            ],
        };
        events
            .iter()
            .map(|event| format!("data: {event}\n\n"))
            .collect()
    }
}
