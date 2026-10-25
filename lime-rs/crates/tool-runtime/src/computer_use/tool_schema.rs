use serde_json::{json, Value};

pub(super) fn input_schema() -> Value {
    let point = json!({"type":"number","exclusiveMinimum":-100000,"exclusiveMaximum":100000});
    let mut operations = Vec::new();
    for (name, properties) in [
        (
            "observe",
            json!({"max_depth":{"type":"integer","minimum":1,"maximum":8},"max_nodes":{"type":"integer","minimum":1,"maximum":512}}),
        ),
        ("screenshot", json!({})),
        (
            "click",
            json!({"x":point,"y":point,"button":{"enum":["left","right","middle"]},"count":{"type":"integer","minimum":1,"maximum":2}}),
        ),
        (
            "type",
            json!({"text":{"type":"string","minLength":1,"maxLength":2048}}),
        ),
        (
            "key",
            json!({"key":{"type":"string","minLength":1,"maxLength":32},"modifiers":{"type":"array","maxItems":4,"items":{"enum":["command","control","option","shift"]}}}),
        ),
        (
            "scroll",
            json!({"x":point,"y":point,"delta_x":{"type":"integer","minimum":-10000,"maximum":10000},"delta_y":{"type":"integer","minimum":-10000,"maximum":10000}}),
        ),
        (
            "drag",
            json!({"x":point,"y":point,"to_x":point,"to_y":point,"duration_ms":{"type":"integer","minimum":50,"maximum":2000}}),
        ),
    ] {
        let mut properties = properties.as_object().unwrap().clone();
        properties.insert("action".into(), json!({"const":name,"type":"string"}));
        let required = properties.keys().cloned().collect::<Vec<_>>();
        operations.push(json!({"type":"object","properties":properties,"required":required,"additionalProperties":false}));
    }
    let action = json!({
        "type":"object",
        "properties":{
            "target":{
                "type":"object",
                "properties":{
                    "type":{"const":"native"},
                    "appId":{"type":"string","minLength":1},
                    "processId":{"type":"integer","minimum":1},
                    "windowId":{"type":"string","minLength":1},
                    "title":{"type":["string","null"]}
                },
                "required":["type","appId","processId","windowId"],
                "additionalProperties":false
            },
            "operation":{"oneOf":operations}
        },
        "required":["target","operation"],
        "additionalProperties":false
    });
    let status = json!({
        "type":"object",
        "properties":{"operation":{
            "type":"object",
            "properties":{"action":{"type":"string","const":"status"}},
            "required":["action"],"additionalProperties":false
        }},
        "required":["operation"],"additionalProperties":false
    });
    let mut properties = action["properties"].clone();
    properties["operation"] =
        json!({"oneOf":[action["properties"]["operation"],status["properties"]["operation"]]});
    json!({
        "type":"object", "properties":properties, "required":["operation"],
        "additionalProperties":false, "oneOf":[action,status]
    })
}
