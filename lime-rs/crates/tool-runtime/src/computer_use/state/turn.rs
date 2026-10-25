//! Turn authority is supplied by the host at admission, never by model arguments.

use super::*;

impl ComputerUseService {
    pub fn bind_turn(&self, owner: ComputerUseOwner) -> ComputerUseResult<()> {
        if owner.connection.is_empty() || owner.thread_id.is_empty() || owner.turn_id.is_empty() {
            return Err(denied(
                "Computer Use requires a trusted connection and turn",
            ));
        }
        let mut state = self.lock()?;
        let key = (owner.thread_id, owner.turn_id);
        if state
            .turn_connections
            .get(&key)
            .is_some_and(|connection| connection != &owner.connection)
        {
            return Err(denied("Computer Use turn belongs to another connection"));
        }
        state.turn_connections.insert(key, owner.connection);
        Ok(())
    }

    pub async fn execute_for_turn(
        &self,
        thread_id: &str,
        turn_id: &str,
        target: ComputerUseTargetIdentity,
        action: ComputerUseAction,
        load: impl Fn() -> ComputerUseResult<ComputerUsePolicy> + Send + Sync,
    ) -> ComputerUseResult<serde_json::Value> {
        action.validate()?;
        let (owner, grant_id, adapter) = {
            let mut state = self.lock()?;
            state.refresh(load())?;
            let connection = state
                .turn_connections
                .get(&(thread_id.into(), turn_id.into()))
                .ok_or_else(|| denied("Computer Use turn has no trusted connection"))?;
            let grant = state.grants.values().find(|grant| {
                &grant.connection == connection
                    && grant.response.epoch == state.epoch
                    && same_target(&grant.response.target, &target)
                    && grant.response.capabilities.contains(&action.capability())
            }).ok_or_else(|| denied("Computer Use requires an existing target grant from the turn's connection; use Computer Use setup first"))?;
            (
                ComputerUseOwner {
                    connection: connection.clone(),
                    thread_id: thread_id.into(),
                    turn_id: turn_id.into(),
                },
                grant.response.id.clone(),
                grant.response.adapter,
            )
        };
        let lease = self
            .acquire(
                owner.clone(),
                ComputerUseLeaseAcquireParams {
                    adapter,
                    target,
                    thread_id: thread_id.into(),
                    turn_id: turn_id.into(),
                    capability: action.capability(),
                    grant_id: Some(grant_id),
                },
                &load,
            )
            .await?;
        let release = TurnLeaseGuard {
            service: self,
            connection: &owner.connection,
            id: &lease.lease_id,
        };
        if self
            .lock()?
            .turn_connections
            .get(&(thread_id.into(), turn_id.into()))
            != Some(&owner.connection)
        {
            return Err(denied(
                "Computer Use turn connection was canceled during admission",
            ));
        }
        let result = self
            .execute(&owner, &lease.lease_id, lease.epoch, action, &load)
            .await;
        drop(release);
        result
    }
    pub fn disconnect(&self, connection: &str) {
        let mut owners = Vec::new();
        if let Ok(mut state) = self.state.lock() {
            state
                .turn_connections
                .retain(|(thread_id, turn_id), owner| {
                    if owner != connection {
                        return true;
                    }
                    owners.push(ComputerUseOwner {
                        connection: owner.clone(),
                        thread_id: thread_id.clone(),
                        turn_id: turn_id.clone(),
                    });
                    false
                });
            if state.grants.values().any(|g| g.connection == connection)
                || state
                    .leases
                    .values()
                    .any(|l| l.owner.connection == connection)
            {
                state.invalidate();
            }
        }
        self.finish_turns(owners);
    }

    pub fn cancel_turn(&self, thread_id: &str, turn_id: &str) {
        let mut owners = Vec::new();
        if let Ok(mut state) = self.state.lock() {
            if let Some(connection) = state
                .turn_connections
                .remove(&(thread_id.into(), turn_id.into()))
            {
                owners.push(ComputerUseOwner {
                    connection,
                    thread_id: thread_id.into(),
                    turn_id: turn_id.into(),
                });
            }
            state.leases.retain(|_, lease| {
                let matches = lease.owner.thread_id == thread_id && lease.owner.turn_id == turn_id;
                if matches {
                    lease.cancellation.cancel();
                }
                !matches
            });
        }
        self.finish_turns(owners);
    }

    pub fn disconnect_all(&self) {
        let mut owners = Vec::new();
        if let Ok(mut state) = self.state.lock() {
            owners.extend(state.turn_connections.drain().map(
                |((thread_id, turn_id), connection)| ComputerUseOwner {
                    connection,
                    thread_id,
                    turn_id,
                },
            ));
            state.invalidate();
        }
        self.finish_turns(owners);
    }

    fn finish_turns(&self, owners: Vec<ComputerUseOwner>) {
        for owner in owners {
            for adapter in self.adapters.values() {
                adapter.finish_turn(&owner);
            }
        }
    }
}

struct TurnLeaseGuard<'a> {
    service: &'a ComputerUseService,
    connection: &'a str,
    id: &'a str,
}

impl Drop for TurnLeaseGuard<'_> {
    fn drop(&mut self) {
        let _ = self.service.release(self.connection, self.id);
    }
}
