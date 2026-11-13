use super::{
    super::{store, AccountManager},
    journal::CallJournal,
};
use app_server_protocol::protocol::v2::CloudResource;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tool_runtime::tool_executor::RuntimeToolExecutionRequest;

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(in crate::account) struct ToolIntent {
    pub key: String,
    pub task_id: String,
    pub session_id: String,
    pub epoch: String,
    pub identity: String,
    pub language: String,
    pub tool: String,
    pub arguments: Value,
    pub path: String,
    pub input: Value,
}

impl ToolIntent {
    fn fingerprint(&self) -> Result<String, String> {
        let mut arguments = self.arguments.clone();
        arguments.sort_all_objects();
        let arguments = serde_json::to_vec(&arguments).map_err(|_| "cloud_tool_input_invalid")?;
        let mut hash = Sha256::new();
        for part in [
            b"cloud-tool.pending.v1".as_slice(),
            self.epoch.as_bytes(),
            self.identity.as_bytes(),
            self.session_id.as_bytes(),
            self.tool.as_bytes(),
            self.path.as_bytes(),
            &arguments,
        ] {
            hash.update((part.len() as u64).to_be_bytes());
            hash.update(part);
        }
        Ok(hex::encode(hash.finalize()))
    }

    fn check(self, candidate: &Self) -> Result<Self, String> {
        if self.tool != candidate.tool
            || self.arguments != candidate.arguments
            || self.path != candidate.path
            || self.input != candidate.input
            || self.session_id != candidate.session_id
        {
            return Err("operation_key_conflict".into());
        }
        if self.epoch != candidate.epoch || self.identity != candidate.identity {
            return Err("account_changed".into());
        }
        if self.task_id != self.key {
            return Err("operation_store_invalid".into());
        }
        Ok(self)
    }
}

impl AccountManager {
    pub(super) fn bind_tool_call(
        &self,
        request: &RuntimeToolExecutionRequest<'_>,
        resource: CloudResource,
        path: &str,
        input: Value,
        expected_epoch: &str,
    ) -> Result<ToolIntent, String> {
        let (call_key, arguments) = tool_call(request)?;
        let explicit = request.params["operation_key"].as_str();
        store::with_lock(&self.path, || {
            let state = store::load(&self.path)?;
            if state.epoch != expected_epoch {
                return Err("account_changed".into());
            }
            let account = state.account.as_ref().ok_or("account_login_required")?;
            let language = state
                .authorizations
                .get(&resource)
                .or_else(|| state.authorizations.get(&CloudResource::Default))
                .map(|auth| auth.language.clone())
                .unwrap_or_else(|| "en-US".into());
            let candidate = ToolIntent {
                task_id: call_key.clone(),
                session_id: request.context.session_id().into(),
                key: call_key.clone(),
                epoch: state.epoch,
                identity: Self::plugin_identity_for(account),
                language,
                tool: request.tool_name.into(),
                arguments,
                path: path.into(),
                input,
            };
            let journal = CallJournal::new(&self.path)?;
            // A call binding survives completion and always wins over the pending index.
            if let Some(key) = journal.binding(&call_key)? {
                if explicit.is_some_and(|explicit| explicit != key) {
                    return Err("operation_key_conflict".into());
                }
                return journal
                    .intent(&key)?
                    .ok_or("operation_store_invalid")?
                    .check(&candidate);
            }
            if let Some(original) = journal.intent(&call_key)? {
                if explicit.is_some_and(|key| key != call_key) {
                    return Err("operation_key_conflict".into());
                }
                return original.check(&candidate);
            }
            let key = match explicit {
                Some(key) => Some(key.to_string()),
                None => journal.pending(&candidate.fingerprint()?)?,
            };
            if let Some(key) = key {
                let missing = if explicit.is_some() {
                    "operation_not_found"
                } else {
                    "operation_store_invalid"
                };
                let original = journal.intent(&key)?.ok_or(missing)?.check(&candidate)?;
                journal.bind(&call_key, &original.key)?;
                return Ok(original);
            }
            // Reserve before publishing the intent. A partial local write fails
            // closed, so a crash cannot leave a dispatched intent without its index.
            journal.reserve(&candidate.fingerprint()?, &candidate.key)?;
            journal.save_intent(&candidate)?;
            Ok(candidate)
        })
    }

    pub(super) fn finish_tool_call(&self, intent: &ToolIntent) -> Result<(), String> {
        store::with_lock(&self.path, || {
            self.check_tool_epoch(intent)?;
            CallJournal::new(&self.path)?.finish(&intent.fingerprint()?, &intent.key)
        })
    }

    pub(in crate::account) fn check_tool_epoch(&self, intent: &ToolIntent) -> Result<(), String> {
        let state = store::load(&self.path)?;
        if state.epoch != intent.epoch
            || state
                .account
                .as_ref()
                .map(Self::plugin_identity_for)
                .as_deref()
                != Some(&intent.identity)
        {
            return Err("account_changed".into());
        }
        Ok(())
    }
}

pub(super) fn tool_call(
    request: &RuntimeToolExecutionRequest<'_>,
) -> Result<(String, Value), String> {
    let call = request
        .context
        .tool_identity()
        .ok_or("cloud_tool_identity_required")?;
    let mut hash = Sha256::new();
    for part in [
        "cloud-tool.v1",
        request.context.session_id(),
        call.turn_id(),
        call.call_id(),
    ] {
        if part.is_empty() || part.len() > 256 {
            return Err("cloud_tool_identity_invalid".into());
        }
        hash.update((part.len() as u64).to_be_bytes());
        hash.update(part.as_bytes());
    }
    let call_key = format!("tool_{}", hex::encode(hash.finalize()));
    let mut arguments = request.params.clone();
    arguments
        .as_object_mut()
        .ok_or("cloud_tool_input_invalid")?
        .remove("operation_key");
    Ok((call_key, arguments))
}
