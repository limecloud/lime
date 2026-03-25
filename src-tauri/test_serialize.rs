use serde::{Serialize, Deserialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum AgentMessageContent {
    #[serde(rename = "text")]
    Text { text: String },
    #[serde(rename = "thinking")]
    Thinking { text: String },
}

fn main() {
    let content = vec![
        AgentMessageContent::Text {
            text: "Hello".to_string(),
        },
        AgentMessageContent::Thinking {
            text: "Thinking...".to_string(),
        },
    ];
    
    let json = serde_json::to_string_pretty(&content).unwrap();
    println!("{}", json);
}
