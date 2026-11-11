use super::{ElicitationResponse, ElicitationRouterError};
use rmcp::model::{
    ElicitationSchema, EnumSchema, MultiSelectEnumSchema, PrimitiveSchema, SingleSelectEnumSchema,
};
use serde_json::Value;

pub(super) fn validate_response_content(
    schema: &ElicitationSchema,
    response: &ElicitationResponse,
) -> Result<(), ElicitationRouterError> {
    let Some(content) = response.content.as_ref() else {
        return Ok(());
    };

    for required in schema.required.as_deref().unwrap_or_default() {
        if !content.contains_key(required) {
            return Err(ElicitationRouterError::InvalidContent(format!(
                "required field `{required}` is missing"
            )));
        }
    }

    for (name, value) in content {
        let Some(property) = schema.properties.get(name) else {
            return Err(ElicitationRouterError::InvalidContent(format!(
                "field `{name}` is not declared by the requested schema"
            )));
        };
        validate_primitive(name, property, value)?;
    }
    Ok(())
}

pub(super) fn validate_primitive(
    name: &str,
    schema: &PrimitiveSchema,
    value: &Value,
) -> Result<(), ElicitationRouterError> {
    let valid = match schema {
        PrimitiveSchema::String(schema) => value.as_str().is_some_and(|value| {
            let length = value.chars().count() as u32;
            schema.min_length.is_none_or(|minimum| length >= minimum)
                && schema.max_length.is_none_or(|maximum| length <= maximum)
                && schema
                    .format
                    .is_none_or(|format| validate_string_format(format, value))
        }),
        PrimitiveSchema::Number(schema) => value.as_f64().is_some_and(|value| {
            schema.minimum.is_none_or(|minimum| value >= minimum)
                && schema.maximum.is_none_or(|maximum| value <= maximum)
        }),
        PrimitiveSchema::Integer(schema) => value.as_i64().is_some_and(|value| {
            schema.minimum.is_none_or(|minimum| value >= minimum)
                && schema.maximum.is_none_or(|maximum| value <= maximum)
        }),
        PrimitiveSchema::Boolean(_) => value.is_boolean(),
        PrimitiveSchema::Enum(schema) => validate_enum(schema, value),
    };

    if valid {
        Ok(())
    } else {
        Err(ElicitationRouterError::InvalidContent(format!(
            "field `{name}` does not match its requested primitive schema"
        )))
    }
}

fn validate_enum(schema: &EnumSchema, value: &Value) -> bool {
    match schema {
        EnumSchema::Single(SingleSelectEnumSchema::Untitled(schema)) => value
            .as_str()
            .is_some_and(|value| schema.enum_.iter().any(|allowed| allowed == value)),
        EnumSchema::Single(SingleSelectEnumSchema::Titled(schema)) => value
            .as_str()
            .is_some_and(|value| schema.one_of.iter().any(|allowed| allowed.const_ == value)),
        EnumSchema::Legacy(schema) => value
            .as_str()
            .is_some_and(|value| schema.enum_.iter().any(|allowed| allowed == value)),
        EnumSchema::Multi(MultiSelectEnumSchema::Untitled(schema)) => {
            validate_multi_select(value, schema.min_items, schema.max_items, |value| {
                schema.items.enum_.iter().any(|allowed| allowed == value)
            })
        }
        EnumSchema::Multi(MultiSelectEnumSchema::Titled(schema)) => {
            validate_multi_select(value, schema.min_items, schema.max_items, |value| {
                schema
                    .items
                    .any_of
                    .iter()
                    .any(|allowed| allowed.const_ == value)
            })
        }
    }
}

fn validate_multi_select(
    value: &Value,
    min_items: Option<u64>,
    max_items: Option<u64>,
    allowed: impl Fn(&str) -> bool,
) -> bool {
    value.as_array().is_some_and(|values| {
        let length = values.len() as u64;
        min_items.is_none_or(|minimum| length >= minimum)
            && max_items.is_none_or(|maximum| length <= maximum)
            && values
                .iter()
                .all(|value| value.as_str().is_some_and(&allowed))
    })
}

fn validate_string_format(format: rmcp::model::StringFormat, value: &str) -> bool {
    match format {
        rmcp::model::StringFormat::Email => value.parse::<email_address::EmailAddress>().is_ok(),
        rmcp::model::StringFormat::Uri => url::Url::parse(value).is_ok(),
        rmcp::model::StringFormat::Date => {
            chrono::NaiveDate::parse_from_str(value, "%Y-%m-%d").is_ok()
        }
        rmcp::model::StringFormat::DateTime => chrono::DateTime::parse_from_rfc3339(value).is_ok(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn enum_forms_enforce_allowed_values_and_selection_shape() {
        for schema in [
            json!({"type": "string", "enum": ["stable", "preview"]}),
            json!({"type": "string", "oneOf": [
                {"const": "stable", "title": "Stable"},
                {"const": "preview", "title": "Preview"}
            ]}),
            json!({"type": "string", "enum": ["stable", "preview"], "enumNames": ["Stable", "Preview"]}),
        ] {
            let schema: EnumSchema = serde_json::from_value(schema).unwrap();
            assert!(validate_enum(&schema, &json!("stable")));
            for invalid in [
                json!("unknown"),
                json!("Stable"),
                json!(7),
                json!(["stable"]),
            ] {
                assert!(
                    !validate_enum(&schema, &invalid),
                    "accepted {invalid:?} for {schema:?}"
                );
            }
        }
        for items in [
            json!({"type": "string", "enum": ["stable", "preview"]}),
            json!({"anyOf": [
                {"const": "stable", "title": "Stable"},
                {"const": "preview", "title": "Preview"}
            ]}),
        ] {
            let schema: EnumSchema = serde_json::from_value(json!({
                "type": "array", "items": items, "minItems": 1, "maxItems": 2
            }))
            .unwrap();
            assert!(validate_enum(&schema, &json!(["stable"])));
            assert!(validate_enum(&schema, &json!(["stable", "preview"])));
            for invalid in [
                json!([]),
                json!(["stable", "preview", "stable"]),
                json!(["unknown"]),
                json!([1]),
                json!("stable"),
            ] {
                assert!(
                    !validate_enum(&schema, &invalid),
                    "accepted {invalid:?} for {schema:?}"
                );
            }
        }
    }
}
