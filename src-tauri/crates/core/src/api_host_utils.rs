use url::Url;

const OPENAI_TERMINAL_SUFFIXES: &[&[&str]] = &[
    &["chat", "completions"],
    &["images", "generations"],
    &["responses"],
    &["models"],
];

const OPENAI_MODEL_DISCOVERY_SUFFIXES: &[&[&str]] = &[
    &["chat", "completions"],
    &["images", "generations"],
    &["responses"],
];

pub fn normalize_openai_compatible_api_host(api_host: &str) -> String {
    strip_known_suffixes(api_host, OPENAI_TERMINAL_SUFFIXES)
}

pub fn normalize_openai_model_discovery_host(api_host: &str) -> String {
    strip_known_suffixes(api_host, OPENAI_MODEL_DISCOVERY_SUFFIXES)
}

pub fn is_openai_responses_endpoint(api_host: &str) -> bool {
    has_known_suffix(api_host, &["responses"])
}

fn strip_known_suffixes(api_host: &str, suffixes: &[&[&str]]) -> String {
    let trimmed = api_host.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return String::new();
    }

    let had_scheme = trimmed.starts_with("http://") || trimmed.starts_with("https://");
    let parse_target = if had_scheme {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    if let Ok(mut url) = Url::parse(&parse_target) {
        let mut segments: Vec<String> = url
            .path_segments()
            .map(|items| {
                items
                    .filter(|segment| !segment.is_empty())
                    .map(|segment| segment.to_string())
                    .collect()
            })
            .unwrap_or_default();

        while let Some(matched_len) = suffixes
            .iter()
            .find(|suffix| ends_with_segments(&segments, suffix))
            .map(|suffix| suffix.len())
        {
            segments.truncate(segments.len().saturating_sub(matched_len));
        }

        let path = if segments.is_empty() {
            "/".to_string()
        } else {
            format!("/{}", segments.join("/"))
        };
        url.set_path(&path);
        url.set_query(None);
        url.set_fragment(None);

        let normalized = url.to_string().trim_end_matches('/').to_string();
        return if had_scheme {
            normalized
        } else {
            normalized
                .trim_start_matches("https://")
                .trim_end_matches('/')
                .to_string()
        };
    }

    trimmed.to_string()
}

fn has_known_suffix(api_host: &str, suffix: &[&str]) -> bool {
    let trimmed = api_host.trim().trim_end_matches('/');
    if trimmed.is_empty() {
        return false;
    }

    let parse_target = if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        trimmed.to_string()
    } else {
        format!("https://{trimmed}")
    };

    let Ok(url) = Url::parse(&parse_target) else {
        return false;
    };

    let segments: Vec<&str> = url
        .path_segments()
        .map(|items| items.filter(|segment| !segment.is_empty()).collect())
        .unwrap_or_default();

    ends_with_segments(&segments, suffix)
}

fn ends_with_segments<T: AsRef<str>, U: AsRef<str>>(segments: &[T], suffix: &[U]) -> bool {
    if suffix.len() > segments.len() {
        return false;
    }

    let offset = segments.len() - suffix.len();
    segments[offset..]
        .iter()
        .zip(suffix.iter())
        .all(|(left, right)| left.as_ref() == right.as_ref())
}

#[cfg(test)]
mod tests {
    use super::{
        is_openai_responses_endpoint, normalize_openai_compatible_api_host,
        normalize_openai_model_discovery_host,
    };

    #[test]
    fn test_normalize_openai_compatible_api_host_strips_terminal_endpoints() {
        assert_eq!(
            normalize_openai_compatible_api_host("https://gateway.example.com/proxy/responses"),
            "https://gateway.example.com/proxy"
        );
        assert_eq!(
            normalize_openai_compatible_api_host("https://api.openai.com/v1/chat/completions"),
            "https://api.openai.com/v1"
        );
        assert_eq!(
            normalize_openai_compatible_api_host("https://api.openai.com/v1/models"),
            "https://api.openai.com/v1"
        );
    }

    #[test]
    fn test_normalize_openai_model_discovery_host_keeps_direct_models_endpoint() {
        assert_eq!(
            normalize_openai_model_discovery_host("https://api.openai.com/v1/models"),
            "https://api.openai.com/v1/models"
        );
        assert_eq!(
            normalize_openai_model_discovery_host("https://gateway.example.com/proxy/responses"),
            "https://gateway.example.com/proxy"
        );
    }

    #[test]
    fn test_is_openai_responses_endpoint_detects_terminal_path() {
        assert!(is_openai_responses_endpoint(
            "https://gateway.example.com/proxy/responses"
        ));
        assert!(!is_openai_responses_endpoint("https://api.openai.com/v1"));
    }
}
