//! Fsynced execution receipts. Recovery never re-executes a recorded grant.
use anyhow::{bail, Context, Result};
use buzz_core::workflow_execution::ExecutionDecision;
use nostr::Event;
use serde::{Deserialize, Serialize};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};
use uuid::Uuid;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct ProcessIdentity {
    pub pid: u32,
    pub start_ticks: String,
    pub boot: String,
    pub namespace: String,
}

impl ProcessIdentity {
    pub fn capture(pid: u32) -> Result<Self> {
        let stat = std::fs::read_to_string(format!("/proc/{pid}/stat"))?;
        let after = stat.rsplit_once(')').context("invalid process identity")?.1;
        let start_ticks = after
            .split_whitespace()
            .nth(19)
            .context("missing process start identity")?
            .to_owned();
        Ok(Self {
            pid,
            start_ticks,
            boot: std::fs::read_to_string("/proc/sys/kernel/random/boot_id")?
                .trim()
                .into(),
            namespace: std::fs::read_link("/proc/self/ns/pid")?
                .to_string_lossy()
                .into_owned(),
        })
    }

    /// A reused PID/namespace is not permission to signal somebody else's process.
    pub async fn verify_stopped(&self) -> bool {
        if std::fs::read_to_string("/proc/sys/kernel/random/boot_id")
            .ok()
            .as_deref()
            .map(str::trim)
            != Some(self.boot.as_str())
            || std::fs::read_link("/proc/self/ns/pid")
                .ok()
                .map(|p| p.to_string_lossy().into_owned())
                .as_deref()
                != Some(self.namespace.as_str())
        {
            return false;
        }
        if crate::acp::process_group_gone(self.pid) {
            return true;
        }
        let Ok(current) = Self::capture(self.pid) else {
            return false;
        };
        if current.start_ticks != self.start_ticks {
            return false;
        }
        #[cfg(unix)]
        {
            if nix::sys::signal::killpg(
                nix::unistd::Pid::from_raw(self.pid as i32),
                nix::sys::signal::Signal::SIGKILL,
            )
            .is_err()
            {
                return false;
            }
        }
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(5);
        while tokio::time::Instant::now() < deadline {
            if crate::acp::process_group_gone(self.pid) {
                return true;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
        false
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) enum Phase {
    Claiming,
    RecoveringClaim,
    Granted,
    Starting,
    Running,
    Stopped,
    Done,
    Stalled,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct Attempt {
    pub claim: Event,
    pub grant: Option<ExecutionDecision>,
    pub phase: Phase,
    pub process: Option<ProcessIdentity>,
    pub result: Option<Event>,
    pub pending_receipt: Option<Event>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub(crate) struct TaskRecord {
    pub event: Event,
    pub attempts: Vec<Attempt>,
    pub terminal: bool,
    pub fallback: bool,
}

impl TaskRecord {
    /// A durable grant is consumed even if a crash occurs before child spawn.
    pub fn can_claim(&self, manual: bool) -> bool {
        !self.terminal
            && self.attempts.len() < if manual { 2 } else { 10 }
            && self
                .attempts
                .iter()
                .all(|attempt| attempt.phase == Phase::Done && attempt.result.is_none())
    }
}

#[cfg(unix)]
type JournalLock = nix::fcntl::Flock<File>;
#[cfg(not(unix))]
type JournalLock = File;
fn lock_journal(file: File) -> Result<JournalLock> {
    #[cfg(unix)]
    {
        nix::fcntl::Flock::lock(file, nix::fcntl::FlockArg::LockExclusiveNonblock).map_err(
            |(_, error)| {
                anyhow::anyhow!("workflow state is already owned by another supervisor: {error}")
            },
        )
    }
    #[cfg(not(unix))]
    {
        let _ = file;
        bail!("workflow journal requires Unix file locking");
    }
}

pub(crate) struct Journal {
    // Held for the lifetime of this supervisor, across atomic journal renames.
    _lock: JournalLock,
    path: PathBuf,
    pub tasks: BTreeMap<Uuid, TaskRecord>,
}
impl Journal {
    pub fn grant_is_new(&self, grant: &ExecutionDecision) -> bool {
        self.tasks
            .values()
            .flat_map(|task| &task.attempts)
            .filter_map(|attempt| attempt.grant.as_ref())
            .all(|prior| {
                prior.grant_id != grant.grant_id
                    && !(prior.run_id == grant.run_id && prior.ordinal == grant.ordinal)
            })
    }

    pub fn open(directory: &Path) -> Result<Self> {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create(true).truncate(false);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let lock = options.open(directory.join("supervisor.lock"))?;
        let lock = lock_journal(lock)?;
        let path = directory.join("journal.json");
        let tasks = if path.exists() {
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                let meta = std::fs::symlink_metadata(&path)?;
                if !meta.is_file() || meta.mode() & 0o777 != 0o600 || meta.uid() != 1001 {
                    bail!("unsafe workflow journal ownership");
                }
            }
            serde_json::from_reader(File::open(&path)?)?
        } else {
            BTreeMap::new()
        };
        Ok(Self {
            _lock: lock,
            path,
            tasks,
        })
    }
    pub fn save(&self) -> Result<()> {
        let parent = self.path.parent().context("journal parent")?;
        let temp = parent.join(format!(".journal-{}.tmp", Uuid::new_v4()));
        let mut options = OpenOptions::new();
        options.write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt;
            options.mode(0o600);
        }
        let mut file = options.open(&temp)?;
        file.write_all(&serde_json::to_vec(&self.tasks)?)?;
        file.sync_all()?;
        std::fs::rename(&temp, &self.path)?;
        File::open(parent)?.sync_all()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use buzz_core::workflow_execution::DecisionKind;
    use nostr::{EventBuilder, Keys, Kind};

    fn fixture() -> (Uuid, TaskRecord, ExecutionDecision) {
        let keys = Keys::generate();
        let id = Uuid::new_v4();
        let event = EventBuilder::new(Kind::from(46008), "task")
            .sign_with_keys(&keys)
            .unwrap();
        let grant = ExecutionDecision {
            version: 1,
            community_id: Uuid::new_v4(),
            agent_pubkey: keys.public_key().to_hex(),
            instance_id: Uuid::new_v4(),
            run_id: Uuid::new_v4(),
            task_id: id,
            grant_id: Uuid::new_v4(),
            channel_id: Uuid::new_v4(),
            ordinal: 1,
            revision: 2,
            deadline: chrono::Utc::now().timestamp() + 1200,
            decision: DecisionKind::Grant,
        };
        (
            id,
            TaskRecord {
                event,
                attempts: vec![],
                terminal: false,
                fallback: false,
            },
            grant,
        )
    }
    fn attempt(record: &TaskRecord, grant: &ExecutionDecision, phase: Phase) -> Attempt {
        Attempt {
            claim: record.event.clone(),
            grant: Some(grant.clone()),
            phase,
            process: None,
            result: None,
            pending_receipt: None,
        }
    }
    #[test]
    fn journal_has_one_supervisor_owner_even_before_first_save() {
        let dir = std::env::temp_dir().join(format!("buzz-lock-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let first = Journal::open(&dir).unwrap();
        assert!(Journal::open(&dir).is_err());
        drop(first);
        assert!(Journal::open(&dir).is_ok());
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test]
    fn fsynced_restart_preserves_two_attempt_budget_and_consumed_grants() {
        let dir = std::env::temp_dir().join(format!("buzz-journal-{}", Uuid::new_v4()));
        std::fs::create_dir(&dir).unwrap();
        let (id, mut task, grant) = fixture();
        task.attempts.push(attempt(&task, &grant, Phase::Done));
        assert!(task.can_claim(true));
        let second = ExecutionDecision {
            ordinal: 2,
            grant_id: Uuid::new_v4(),
            ..grant.clone()
        };
        task.attempts.push(attempt(&task, &second, Phase::Done));
        task.fallback = true;
        let journal = Journal {
            _lock: lock_journal(File::open(&dir).unwrap()).unwrap(),
            path: dir.join("journal.json"),
            tasks: BTreeMap::from([(id, task)]),
        };
        journal.save().unwrap();
        // Deserialize exactly the persisted state. Production open additionally
        // verifies UID1001, which native developer test users cannot impersonate.
        let reloaded = Journal {
            _lock: lock_journal(journal._lock.try_clone().unwrap()).unwrap(),
            path: journal.path.clone(),
            tasks: serde_json::from_reader(File::open(&journal.path).unwrap()).unwrap(),
        };
        assert!(!reloaded.tasks[&id].can_claim(true));
        assert!(reloaded.tasks[&id].can_claim(false));
        assert!(!reloaded.grant_is_new(&grant));
        assert!(!reloaded.grant_is_new(&second));
        assert!(!reloaded.grant_is_new(&ExecutionDecision {
            grant_id: Uuid::new_v4(),
            ..second
        }));
        assert!(reloaded.tasks[&id].fallback);
        std::fs::remove_dir_all(dir).unwrap();
    }
    #[test]
    fn uncertain_stop_and_unacknowledged_receipt_never_allow_retry() {
        for phase in [
            Phase::Claiming,
            Phase::RecoveringClaim,
            Phase::Granted,
            Phase::Starting,
            Phase::Running,
            Phase::Stopped,
            Phase::Stalled,
        ] {
            let (_, mut task, grant) = fixture();
            task.attempts.push(attempt(&task, &grant, phase));
            assert!(!task.can_claim(true));
        }
    }
    #[test]
    fn two_targets_cannot_reconsume_same_run_ordinal() {
        let (id, mut task, grant) = fixture();
        task.attempts.push(attempt(&task, &grant, Phase::Done));
        let journal = Journal {
            _lock: lock_journal(File::open(std::env::temp_dir()).unwrap()).unwrap(),
            path: "unused".into(),
            tasks: BTreeMap::from([(id, task)]),
        };
        let other = ExecutionDecision {
            task_id: Uuid::new_v4(),
            grant_id: Uuid::new_v4(),
            ..grant.clone()
        };
        assert!(!journal.grant_is_new(&other));
        assert!(journal.grant_is_new(&ExecutionDecision {
            ordinal: 2,
            ..other
        }));
    }
    #[tokio::test]
    async fn different_pid_namespace_is_never_treated_as_verified_stopped() {
        let identity = ProcessIdentity {
            pid: u32::MAX,
            start_ticks: "1".into(),
            boot: "old-kernel".into(),
            namespace: "old-container".into(),
        };
        assert!(!identity.verify_stopped().await);
    }
}
