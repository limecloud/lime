//! Local account commands use the same App Server owner as Desktop and TUI.

use crate::connection::ConnectionArgs;
use crate::exec::locale::{Label, Locale};
use anyhow::{bail, Context, Result};
use app_server_client::RequestHandle;
use app_server_protocol::protocol::v2::{
    Account, AccountAuthorizationStatus as Status, CloudCredentialStatus, CloudResource,
    GetAccountParams, GetAccountResponse, LoginAccountParams, LoginAccountResponse,
    LogoutAccountResponse, METHOD_ACCOUNT_LOGIN_START, METHOD_ACCOUNT_LOGOUT, METHOD_ACCOUNT_READ,
};
use clap::Args;
use std::process::ExitCode;
use std::time::Duration;

#[derive(Debug, Args)]
pub(crate) struct LoginCommand {
    #[command(subcommand)]
    action: Option<LoginAction>,
    /// Print account metadata as JSON. Credentials are never exported.
    #[arg(long, global = true)]
    json: bool,
    /// Print the sign-in URL without opening a browser.
    #[arg(long)]
    no_browser: bool,
    /// Authorize the shared market separately from the default account sign-in.
    #[arg(long, global = true, value_enum, default_value = "default")]
    resource: LoginResource,
    #[arg(long, global = true, value_name = "LOCALE")]
    pub(crate) locale: Option<String>,
    #[command(flatten)]
    pub(crate) connection: ConnectionArgs,
}

#[derive(Debug, clap::Subcommand)]
enum LoginAction {
    /// Read local account and original authorization status.
    Status,
}

#[derive(Debug, Clone, Copy, clap::ValueEnum)]
enum LoginResource {
    Default,
    Market,
}

impl From<LoginResource> for CloudResource {
    fn from(value: LoginResource) -> Self {
        match value {
            LoginResource::Default => Self::Default,
            LoginResource::Market => Self::Market,
        }
    }
}

#[derive(Debug, Args)]
pub(crate) struct LogoutCommand {
    #[arg(long, value_name = "LOCALE")]
    pub(crate) locale: Option<String>,
    #[command(flatten)]
    pub(crate) connection: ConnectionArgs,
}

impl LoginCommand {
    pub(crate) async fn run(self) -> ExitCode {
        let locale = Locale::resolve(self.locale.as_deref());
        report(run_login(self, locale).await)
    }
}

impl LogoutCommand {
    pub(crate) async fn run(self) -> ExitCode {
        report(
            async {
                ensure_local(&self.connection)?;
                let locale = Locale::resolve(self.locale.as_deref());
                let _: LogoutAccountResponse = serde_json::from_value(
                    crate::request_value(
                        &self.connection,
                        METHOD_ACCOUNT_LOGOUT,
                        serde_json::json!({}),
                    )
                    .await?,
                )?;
                println!("{}", locale.label(Label::LoggedOut));
                Ok(ExitCode::SUCCESS)
            }
            .await,
        )
    }
}

fn report(result: Result<ExitCode>) -> ExitCode {
    match result {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

fn ensure_local(connection: &ConnectionArgs) -> Result<()> {
    if connection.remote.remote.is_some() || connection.remote.remote_auth_token_env.is_some() {
        bail!("account_local_host_required");
    }
    Ok(())
}

async fn read(handle: &RequestHandle, id: Option<String>) -> Result<GetAccountResponse> {
    Ok(handle
        .request(
            METHOD_ACCOUNT_READ,
            GetAccountParams {
                authorization_id: id,
            },
        )
        .await?)
}

fn default_authorization(
    account: &GetAccountResponse,
) -> Option<&app_server_protocol::protocol::v2::AccountAuthorization> {
    account
        .authorizations
        .iter()
        .find(|a| a.resource == CloudResource::Default)
}

fn resource_ready(account: &GetAccountResponse, resource: CloudResource) -> bool {
    match (&account.account, resource) {
        (Some(_), CloudResource::Default) => true,
        (Some(Account::Cloud { resources, .. }), _) => resources
            .iter()
            .any(|c| c.resource == resource && c.status == CloudCredentialStatus::Connected),
        _ => false,
    }
}

fn login_label(locale: Locale, resource: CloudResource, label: Label) -> &'static str {
    locale.label(match (resource, label) {
        (CloudResource::Market, Label::LoginInterrupted) => Label::MarketLoginInterrupted,
        (CloudResource::Market, Label::LoginUnknown) => Label::MarketLoginUnknown,
        (_, label) => label,
    })
}

fn print_resource_status(
    account: &GetAccountResponse,
    resource: CloudResource,
    locale: Locale,
    json: bool,
) -> Result<ExitCode> {
    if resource == CloudResource::Default {
        return print_account(account, locale, json);
    }
    println!("{}", serde_json::to_string_pretty(account)?);
    Ok(if resource_ready(account, resource) {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    })
}

async fn run_login(args: LoginCommand, locale: Locale) -> Result<ExitCode> {
    ensure_local(&args.connection)?;
    let resource = CloudResource::from(args.resource);
    let session = crate::start_session(&args.connection).await?;
    let handle = session.request_handle();
    let result = async {
        let mut account = read(&handle, None).await?;
        if let Some(authorization) = account
            .authorizations
            .iter()
            .find(|a| a.resource == resource)
        {
            if matches!(
                authorization.status,
                Status::Pending | Status::Exchanging | Status::OutcomeUnknown
            ) {
                // Read the original transaction first, including any saved exchange
                // candidate. Never replace a pending or unknown authorization.
                account = read(&handle, Some(authorization.id.clone())).await?;
            }
        }
        if matches!(args.action, Some(LoginAction::Status)) {
            return print_resource_status(&account, resource, locale, args.json);
        }
        if let Some(authorization) = account
            .authorizations
            .iter()
            .find(|a| a.resource == resource)
        {
            match authorization.status {
                Status::Pending | Status::Exchanging => {
                    eprintln!("{}", locale.label(Label::LoginPending));
                    return wait(
                        &handle,
                        authorization.id.clone(),
                        resource,
                        locale,
                        args.json,
                    )
                    .await;
                }
                Status::OutcomeUnknown => {
                    bail!("{}", login_label(locale, resource, Label::LoginUnknown))
                }
                _ => {}
            }
        }
        if resource_ready(&account, resource) {
            return print_resource_status(&account, resource, locale, args.json);
        }
        if let Some(error) = &account.service_error {
            bail!("{error}");
        }
        let origin = account
            .service_url
            .ok_or_else(|| anyhow::anyhow!("account_service_unconfigured"))?;
        let response: LoginAccountResponse = handle
            .request(
                METHOD_ACCOUNT_LOGIN_START,
                LoginAccountParams::Cloud {
                    resource,
                    language: locale.tag().into(),
                    installation: None,
                },
            )
            .await?;
        let LoginAccountResponse::Cloud {
            authorization,
            auth_url,
        } = response;
        if authorization.resource != resource
            || authorization.status != Status::Pending
            || authorization.id.trim().is_empty()
            || !auth_url.starts_with(&format!("{origin}/api/v1/client/auth/authorize?"))
            || auth_url.chars().any(char::is_control)
        {
            bail!("authorization_invalid");
        }
        eprintln!("{}\n{auth_url}", locale.label(Label::LoginOpen));
        if !args.no_browser {
            // A browser failure still leaves a usable original URL. Opening it
            // proves no authorization and never registers a product user.
            let url = auth_url.clone();
            let _ = tokio::task::spawn_blocking(move || webbrowser::open(&url)).await;
        }
        wait(&handle, authorization.id, resource, locale, args.json).await
    }
    .await;
    let shutdown = session.shutdown().await;
    let result = result?;
    shutdown?;
    Ok(result)
}

async fn wait(
    handle: &RequestHandle,
    id: String,
    resource: CloudResource,
    locale: Locale,
    json: bool,
) -> Result<ExitCode> {
    let original = async {
        loop {
            let account = read(handle, Some(id.clone())).await?;
            let authorization = account
                .authorizations
                .iter()
                .find(|a| a.resource == resource && a.id == id)
                .ok_or_else(|| anyhow::anyhow!("account_changed"))?;
            match authorization.status {
                Status::Pending | Status::Exchanging => {}
                Status::Completed if account.account.is_some() => {
                    return print_resource_status(&account, resource, locale, json)
                }
                Status::Completed => bail!("account_changed"),
                Status::OutcomeUnknown => {
                    bail!("{}", login_label(locale, resource, Label::LoginUnknown))
                }
                Status::Denied => bail!("authorization_rejected"),
                Status::Expired => bail!("authorization_expired"),
                Status::Cancelled => bail!("authorization_cancelled"),
                Status::Failed => bail!("authorization_failed"),
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        }
    };
    tokio::select! {
        result = tokio::time::timeout(Duration::from_secs(600), original) => {
            result.context(login_label(locale, resource, Label::LoginInterrupted))?
        }
        signal = tokio::signal::ctrl_c() => {
            signal?;
            // Interrupt only this wait. Logout is an explicit separate command.
            eprintln!("{}", login_label(locale, resource, Label::LoginInterrupted));
            Ok(ExitCode::from(130))
        }
    }
}

fn print_account(account: &GetAccountResponse, locale: Locale, json: bool) -> Result<ExitCode> {
    if json {
        println!("{}", serde_json::to_string_pretty(account)?);
    } else if let Some(Account::Cloud {
        display_name,
        email,
        ..
    }) = &account.account
    {
        println!("{}\n{display_name}\n{email}", locale.label(Label::LoggedIn));
    } else {
        println!("{}", locale.label(Label::LoggedOut));
        if let Some(authorization) = default_authorization(account) {
            println!("{}", serde_json::to_string(authorization)?);
        }
        if let Some(error) = &account.service_error {
            eprintln!("{error}");
        }
    }
    Ok(if account.account.is_some() {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    })
}

#[cfg(test)]
mod tests;
