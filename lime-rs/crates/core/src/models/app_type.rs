use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum AppType {
    Lime,
    Claude,
    Codex,
    Gemini,
}

impl AppType {
    pub fn as_str(&self) -> &'static str {
        match self {
            AppType::Lime => "lime",
            AppType::Claude => "claude",
            AppType::Codex => "codex",
            AppType::Gemini => "gemini",
        }
    }
}

impl std::str::FromStr for AppType {
    type Err = String;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "lime" => Ok(AppType::Lime),
            "claude" => Ok(AppType::Claude),
            "codex" => Ok(AppType::Codex),
            "gemini" => Ok(AppType::Gemini),
            _ => Err(format!("Invalid app type: {s}")),
        }
    }
}

impl std::fmt::Display for AppType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[cfg(test)]
mod tests {
    use super::AppType;

    #[test]
    fn codex_remains_a_supported_external_app_target() {
        let app = "codex"
            .parse::<AppType>()
            .expect("Codex is a supported target");

        assert_eq!(app, AppType::Codex);
        assert_eq!(app.as_str(), "codex");
    }
}
