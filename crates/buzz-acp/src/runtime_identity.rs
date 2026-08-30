//! Mutable runtime-facing identity that never changes the Nostr signing key.

use std::sync::{Arc, RwLock};

use buzz_core::hosted_agent_runtime::RuntimeName;

/// Agent-global display name read when a fresh ACP session is created.
#[derive(Debug, Clone)]
pub struct RuntimeIdentity {
    name: Arc<RwLock<Option<String>>>,
}

impl RuntimeIdentity {
    /// Seed the runtime identity from the process configuration.
    pub fn new(name: Option<String>) -> Self {
        Self {
            name: Arc::new(RwLock::new(name)),
        }
    }

    /// Return the current runtime-facing name.
    pub fn name(&self) -> Option<String> {
        self.name.read().ok().and_then(|name| name.clone())
    }

    /// Apply a controller-validated name at the same boundary as model/effort.
    pub fn apply(&self, name: &RuntimeName) {
        if let Ok(mut current) = self.name.write() {
            *current = Some(name.as_str().to_owned());
        } else {
            tracing::error!("runtime identity lock is poisoned; name update was not applied");
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn clones_share_runtime_name_without_touching_signing_identity() {
        let identity = RuntimeIdentity::new(Some("Market Intelligence".into()));
        let clone = identity.clone();
        let name: RuntimeName = serde_json::from_str("\"Research Desk\"").expect("name");

        clone.apply(&name);

        assert_eq!(identity.name().as_deref(), Some("Research Desk"));
    }
}
