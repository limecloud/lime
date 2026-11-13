use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(
    Debug, Default, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize, JsonSchema,
)]
#[serde(rename_all = "lowercase")]
pub enum CloudResource {
    #[default]
    Default,
    Market,
    Web,
    Connections,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionInstallation {
    pub installation_id: String,
    pub space_id: String,
}

/// The native owner creates PKCE and receives the callback. No imported tokens.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum LoginAccountParams {
    #[serde(rename_all = "camelCase")]
    Cloud {
        #[serde(default)]
        resource: CloudResource,
        language: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        installation: Option<ConnectionInstallation>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AccountAuthorizationStatus {
    Pending,
    Exchanging,
    Completed,
    Denied,
    Expired,
    Cancelled,
    Failed,
    OutcomeUnknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccountAuthorization {
    pub id: String,
    pub resource: CloudResource,
    pub status: AccountAuthorizationStatus,
    pub expires_at: String,
}

/// The host opens the native owner's URL. Only the native callback proves authorization.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct AccountAuthorizeParams {
    pub thread_id: String,
    pub authorization: AccountAuthorization,
    pub auth_url: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum AuthorizationAction {
    Opened,
    Cancelled,
    Unavailable,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct AccountAuthorizeResponse {
    pub action: AuthorizationAction,
}

/// The host opens the original file approval; the Cloud decision is read separately.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionAuthorizeParams {
    pub thread_id: String,
    pub request_id: String,
    pub approval_url: String,
    pub expires_at: String,
    pub environment: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
pub struct ConnectionAuthorizeResponse {
    pub action: AuthorizationAction,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum LoginAccountResponse {
    #[serde(rename_all = "camelCase")]
    Cloud {
        authorization: AccountAuthorization,
        auth_url: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "snake_case")]
pub enum CloudCredentialStatus {
    Connected,
    Expired,
    Refreshing,
    VerificationRequired,
    OutcomeUnknown,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct CloudResourceCredential {
    pub resource: CloudResource,
    pub audience: String,
    pub scope: String,
    pub expires_at: String,
    pub status: CloudCredentialStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(tag = "type", rename_all = "camelCase", deny_unknown_fields)]
pub enum Account {
    #[serde(rename_all = "camelCase")]
    Cloud {
        base_url: String,
        issuer: String,
        application_id: String,
        client_id: String,
        environment: String,
        user_id: String,
        email: String,
        display_name: String,
        generation: String,
        resources: Vec<CloudResourceCredential>,
    },
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GetAccountParams {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub authorization_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetAccountResponse {
    /// Effective Core origin from native user configuration or the bound account.
    pub service_url: Option<String>,
    /// Configuration failure code; account and logout remain available.
    pub service_error: Option<String>,
    pub account: Option<Account>,
    pub authorizations: Vec<AccountAuthorization>,
}

#[derive(Debug, Default, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
pub struct LogoutAccountResponse {}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct AccountUpdatedNotification {
    pub auth_mode: Option<String>,
    pub plan_type: Option<String>,
}
