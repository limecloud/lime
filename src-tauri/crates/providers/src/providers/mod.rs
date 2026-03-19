pub mod antigravity;
pub mod claude_custom;
pub mod claude_oauth;
pub mod codex;
pub mod error;
pub mod gemini;
pub mod kiro;
pub mod novita;
pub mod openai_custom;
pub mod traits;
pub mod vertex;

#[cfg(test)]
mod tests;

// Trait exports
#[allow(unused_imports)]
pub use traits::{CredentialProvider, ProviderResult, TokenManager};

#[allow(unused_imports)]
pub use antigravity::AntigravityApiError;
#[allow(unused_imports)]
pub use antigravity::AntigravityProvider;
#[allow(unused_imports)]
pub use antigravity::ANTIGRAVITY_MODELS_FALLBACK;
#[allow(unused_imports)]
pub use claude_custom::ClaudeCustomProvider;
#[allow(unused_imports)]
pub use claude_oauth::ClaudeOAuthProvider;
#[allow(unused_imports)]
pub use codex::CodexProvider;
#[allow(unused_imports)]
pub use error::ProviderError;
#[allow(unused_imports)]
pub use gemini::{GeminiApiKeyCredential, GeminiApiKeyProvider, GeminiProvider};
#[allow(unused_imports)]
pub use kiro::KiroProvider;
#[allow(unused_imports)]
pub use novita::{
    NovitaProvider, NOVITA_API_BASE_URL, NOVITA_DEFAULT_MODEL, NOVITA_EMBEDDING_MODEL,
    NOVITA_SUPPORTED_MODELS,
};
#[allow(unused_imports)]
pub use openai_custom::OpenAICustomProvider;
#[allow(unused_imports)]
pub use vertex::VertexProvider;
