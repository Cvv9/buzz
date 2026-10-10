//! Buzz Nest — persistent agent workspace at `~/.buzz`.
//!
//! Creates a shared knowledge directory on first launch so every
//! Buzz-spawned agent starts with orientation (AGENTS.md) and a
//! place to accumulate research, plans, and logs across sessions.
//!
//! Static template content in AGENTS.md (above the managed-section markers)
//! and SKILL.md is refreshed when the embedded template version changes.

use super::{load_managed_agents, load_personas, AgentDefinition, ManagedAgentRecord};
#[cfg(test)]
use super::{BackendKind, RespondTo};
use crate::app_state::AppState;
use crate::commands::{capture_relay_target, fetch_archived_pubkeys_at};
use std::collections::HashSet;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

#[cfg(unix)]
use crate::managed_agents::discovery::known_skill_dirs;
#[cfg(unix)]
use crate::util::create_symlink;

/// Subdirectories created inside the nest.
/// `REPOS` is intentionally absent: it is provisioned by
/// [`super::repos::ensure_repos_symlink`], which makes it either a real directory (default)
/// or a symlink to a user-configured `repos_dir`. Creating it here
/// unconditionally would race a future symlink re-point.
const NEST_DIRS: &[&str] = &[
    "GUIDES",
    "RESEARCH",
    "PLANS",
    "WORK_LOGS",
    "OUTBOX",
    ".scratch",
];

/// Default AGENTS.md content written on first init.
/// Fully static — no runtime interpolation, no secrets, no user paths.
pub(crate) const AGENTS_MD: &str = include_str!("nest_agents.md");

/// Default SKILL.md content for the buzz-cli skill.
/// Written to ~/.buzz/.agents/skills/buzz-cli/SKILL.md on first init.
const BUZZ_CLI_SKILL_MD: &str = include_str!("nest_skill.md");

/// Template content version for AGENTS.md static content (above managed markers).
/// Bump this when changing `nest_agents.md` to trigger refresh on existing installs.
/// Version 1 is implicitly "before this mechanism existed" (no version file).
const NEST_AGENTS_VERSION: u32 = 6;

/// Template content version for SKILL.md.
/// Bump this when changing `nest_skill.md` to trigger refresh on existing installs.
const NEST_SKILL_VERSION: u32 = 6;

const BEGIN_MARKER: &str = "<!-- BEGIN BUZZ MANAGED";
const END_MARKER: &str = "<!-- END BUZZ MANAGED -->";

mod render;
pub use render::{render_dynamic_section, upsert_managed_section};
mod templates;
use templates::{refresh_agents_md_if_stale, refresh_skill_md_if_stale};

/// Canonical skill directory path relative to the nest root.
const CANONICAL_SKILL_DIR: &str = ".agents/skills/buzz-cli";

/// Nest directory name for production builds.
const NEST_DIR_PROD: &str = ".buzz";

/// Process-lifetime nest directory. Initialized once at startup via
/// [`init_nest_dir`] before any call to [`nest_dir`].
///
/// `None` inside the `OnceLock` means "home dir was unresolvable at init time".
/// The outer `None` from `OnceLock::get` means "not initialized yet" —
/// [`nest_dir`] falls back to the prod path in that case, ensuring test code
/// that never calls [`init_nest_dir`] still works.
static NEST_DIR: std::sync::OnceLock<Option<PathBuf>> = std::sync::OnceLock::new();

/// Initialize the process-lifetime nest directory.
///
/// Must be called once at app startup (before any call to [`nest_dir`] that
/// may result in a filesystem operation). Subsequent calls are no-ops — the
/// `OnceLock` is set exactly once.
///
/// `is_dev` should be `true` when the running binary is a dev build — i.e.
/// when the Tauri app-data directory name starts with `"xyz.block.buzz.app.dev"`.
/// Pass `false` for production (signed DMG) builds.
pub fn init_nest_dir(is_dev: bool) {
    let suffix = crate::build_identity::nest_name(is_dev);
    let path = dirs::home_dir().map(|h| h.join(suffix.as_ref()));
    // set() is a no-op when already initialized, which is correct: only the
    // first call (at boot, before any filesystem work) should win.
    let _ = NEST_DIR.set(path);
}

/// Pin the nest root for a child-process test so background nest work cannot
/// reach the user's real nest.
#[cfg(test)]
pub(crate) fn pin_nest_dir_for_test(path: PathBuf) {
    NEST_DIR
        .set(Some(path))
        .expect("nest dir pinned before first use");
}

/// Returns the nest root path (`~/.buzz` for prod, `~/.buzz-dev` for dev),
/// or `None` if the home directory cannot be resolved.
///
/// If [`init_nest_dir`] has not been called yet (e.g. in unit tests), falls
/// back to the production path `~/.buzz`.
pub fn nest_dir() -> Option<PathBuf> {
    match NEST_DIR.get() {
        Some(path) => path.clone(),
        // Not yet initialized — fall back to prod path. Covers test code.
        None => dirs::home_dir().map(|h| h.join(NEST_DIR_PROD)),
    }
}

/// Creates the Buzz nest at `~/.buzz` if it doesn't already exist.
///
/// Delegates to [`ensure_nest_at`] with the resolved nest directory.
/// Returns an error string if the home directory cannot be resolved.
pub fn ensure_nest() -> Result<(), String> {
    let root = nest_dir().ok_or("cannot resolve home directory for nest")?;
    ensure_nest_at(&root)
}

/// Creates a Buzz nest at the given `root` path.
///
/// - Creates the root directory and all subdirectories.
/// - Writes `AGENTS.md` only if it doesn't already exist.
/// - Writes `.agents/skills/buzz-cli/SKILL.md` only if it doesn't already exist.
/// - Creates harness-specific symlinks pointing to the canonical
///   `.agents/skills/buzz-cli` directory for each known provider.
/// - Sets 700 permissions on the root, all subdirectories, and the skill
///   directory tree (Unix).
///
/// Idempotent: safe to call on every launch. Static template content in
/// AGENTS.md (above the managed-section markers) and SKILL.md is refreshed
/// when the embedded template version changes. The managed section in AGENTS.md
/// and any user content below it are preserved.
///
/// Rejects symlinks at the root path to prevent redirect attacks.
///
/// Errors are returned as strings for Tauri compatibility; callers
/// should log and continue rather than aborting app startup.
pub fn ensure_nest_at(root: &Path) -> Result<(), String> {
    // Reject symlinks — we want a real directory, not a redirect.
    // Platform-independent: symlink_metadata works on all OS.
    if root
        .symlink_metadata()
        .map(|m| m.file_type().is_symlink())
        .unwrap_or(false)
    {
        return Err(format!(
            "{} is a symlink; refusing to use as nest root",
            root.display()
        ));
    }

    // Create root and all subdirectories. create_dir_all is idempotent —
    // it succeeds silently if the directory already exists.
    fs::create_dir_all(root).map_err(|e| format!("create {}: {e}", root.display()))?;

    for dir in NEST_DIRS {
        let path = root.join(dir);
        fs::create_dir_all(&path).map_err(|e| format!("create {}: {e}", path.display()))?;
    }

    // REPOS is provisioned separately from NEST_DIRS: it may be a symlink to a
    // user-configured repos_dir (applied later via apply_workspace), so setup
    // must not clobber an existing configured symlink. See repos.rs.
    super::repos::ensure_repos_setup_default(root)?;

    // Write AGENTS.md only if it doesn't already exist.
    // Uses create_new (O_CREAT|O_EXCL) to atomically check-and-create,
    // closing the TOCTOU gap that exists() + write() would leave open.
    // Also guarantees we never clobber a user-edited file.
    let agents_md = root.join("AGENTS.md");
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&agents_md)
    {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(AGENTS_MD.as_bytes())
                .map_err(|e| format!("write {}: {e}", agents_md.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {
            // File already exists — leave it alone (idempotent).
        }
        Err(e) => {
            return Err(format!("create {}: {e}", agents_md.display()));
        }
    }

    // Write buzz-cli skill to the harness-agnostic .agents path.
    // The first-init write uses the new canonical path; migration from
    // the old .claude path is handled in refresh_skill_md_if_stale.
    let agents_skill_dir = root.join(CANONICAL_SKILL_DIR);
    fs::create_dir_all(&agents_skill_dir)
        .map_err(|e| format!("create {}: {e}", agents_skill_dir.display()))?;

    let skill_md = agents_skill_dir.join("SKILL.md");
    match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&skill_md)
    {
        Ok(mut file) => {
            use std::io::Write;
            file.write_all(BUZZ_CLI_SKILL_MD.as_bytes())
                .map_err(|e| format!("write {}: {e}", skill_md.display()))?;
        }
        Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => {}
        Err(e) => {
            return Err(format!("create {}: {e}", skill_md.display()));
        }
    }

    // Create harness-specific symlinks for all known providers.
    // Migration of the old .claude/skills/buzz-cli real dir is handled in
    // refresh_skill_md_if_stale; ensure_skill_symlinks skips paths that already exist.
    ensure_skill_symlinks(root)?;

    // Refresh static content if the embedded template version is newer.
    refresh_agents_md_if_stale(root)?;
    refresh_skill_md_if_stale(root)?;

    // Set owner-only permissions on root and all subdirectories.
    // Skip any path that is a symlink — chmod would affect the target.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let perms = fs::Permissions::from_mode(0o700);
        fs::set_permissions(root, perms.clone())
            .map_err(|e| format!("set permissions on {}: {e}", root.display()))?;
        for dir in NEST_DIRS {
            let path = root.join(dir);
            let is_symlink = path
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);
            if !is_symlink {
                fs::set_permissions(&path, perms.clone())
                    .map_err(|e| format!("set permissions on {}: {e}", path.display()))?;
            }
        }
        // REPOS is provisioned outside NEST_DIRS (it may be a symlink). Only
        // chmod it when it is a real directory — chmod on a symlink would
        // affect the user's external repos_dir target.
        let repos_path = root.join("REPOS");
        let repos_is_symlink = repos_path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if !repos_is_symlink {
            fs::set_permissions(&repos_path, perms.clone())
                .map_err(|e| format!("set permissions on {}: {e}", repos_path.display()))?;
        }
        // Skill directory trees inside root get 700.
        // Build the list from canonical path + all known provider skill dirs.
        let mut skill_perm_dirs = Vec::new();
        {
            let mut accumulated = std::path::PathBuf::new();
            for component in std::path::Path::new(CANONICAL_SKILL_DIR).components() {
                accumulated.push(component);
                skill_perm_dirs.push(root.join(&accumulated));
            }
        }
        for skill_dir in known_skill_dirs() {
            // Ensure every ancestor dir gets 700, not just the leaf.
            let mut accumulated = std::path::PathBuf::new();
            for component in std::path::Path::new(skill_dir).components() {
                accumulated.push(component);
                skill_perm_dirs.push(root.join(&accumulated));
            }
        }
        for dir in skill_perm_dirs {
            let is_symlink = dir
                .symlink_metadata()
                .map(|m| m.file_type().is_symlink())
                .unwrap_or(false);
            if !is_symlink {
                fs::set_permissions(&dir, perms.clone())
                    .map_err(|e| format!("set permissions on {}: {e}", dir.display()))?;
            }
        }
    }

    Ok(())
}

/// Create harness-specific skill symlinks for each known provider.
/// Idempotent: skips any path where `symlink_metadata` succeeds — real
/// directories, valid symlinks, and dangling symlinks are all left alone.
#[cfg(unix)]
fn ensure_skill_symlinks(root: &Path) -> Result<(), String> {
    for skill_dir in known_skill_dirs() {
        let parent = root.join(skill_dir);
        fs::create_dir_all(&parent).map_err(|e| format!("create {}: {e}", parent.display()))?;
        let link = parent.join("buzz-cli");
        if link.symlink_metadata().is_ok() {
            continue; // symlink or real path exists — skip
        }
        let depth = std::path::Path::new(skill_dir).components().count();
        let prefix = "../".repeat(depth);
        let target = format!("{prefix}{CANONICAL_SKILL_DIR}");
        create_symlink(std::path::Path::new(&target), &link)
            .map_err(|e| format!("symlink {} → {}: {e}", link.display(), target))?;
    }
    Ok(())
}

#[cfg(not(unix))]
fn ensure_skill_symlinks(_root: &Path) -> Result<(), String> {
    Ok(())
}

/// Returns the `~/.local/bin` link name for the bundled CLI.
///
/// Dev builds (`is_dev = true`) use `"buzz-dev"` so that a running DMG and a
/// concurrent dev build each own a separate link and never clobber each other —
/// the same isolation that separates `~/.buzz` (prod) from `~/.buzz-dev` (dev).
pub fn cli_link_name(is_dev: bool) -> String {
    crate::build_identity::cli_name(is_dev)
}

/// Ensures `~/.local/bin/buzz` (prod) or `~/.local/bin/buzz-dev` (dev) is a
/// symlink to the bundled CLI binary.
///
/// The link name is split by `is_dev` so that an installed DMG and a
/// concurrently running dev build each maintain their own symlink and never
/// overwrite each other's target — the same isolation that separates the
/// `~/.buzz` and `~/.buzz-dev` nests (see [`NEST_DIR_DEV`]).
///
/// On every boot: replaces any existing symlink unconditionally (the `buzz` /
/// `buzz-dev` name is our namespace), creates a new one if absent, and leaves
/// regular files alone to avoid clobbering a user-compiled binary.
///
/// Non-fatal: callers should ignore errors — the symlink is a convenience
/// for human Terminal use; agents find the CLI via PATH augmentation.
#[cfg(unix)]
pub fn ensure_cli_symlink(exe_parent: &Path, is_dev: bool) -> Result<(), String> {
    let buzz_bin = exe_parent.join("buzz");
    if !buzz_bin.exists() {
        return Ok(()); // CLI not bundled (e.g., dev builds without sidecars).
    }

    let local_bin = dirs::home_dir()
        .ok_or("cannot resolve home directory")?
        .join(".local")
        .join("bin");
    fs::create_dir_all(&local_bin).map_err(|e| format!("create {}: {e}", local_bin.display()))?;

    let link = local_bin.join(cli_link_name(is_dev));
    match link.symlink_metadata() {
        Ok(meta) if meta.file_type().is_symlink() => {
            let _ = fs::remove_file(&link);
            create_symlink(&buzz_bin, &link)
                .map_err(|e| format!("symlink {}: {e}", link.display()))?;
        }
        Ok(_) => {
            // Regular file or directory — don't clobber.
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            create_symlink(&buzz_bin, &link)
                .map_err(|e| format!("symlink {}: {e}", link.display()))?;
        }
        Err(e) => {
            return Err(format!("stat {}: {e}", link.display()));
        }
    }

    Ok(())
}

/// No-op on non-Unix platforms — symlink management is macOS/Linux only.
#[cfg(not(unix))]
pub fn ensure_cli_symlink(_exe_parent: &Path, _is_dev: bool) -> Result<(), String> {
    Ok(())
}

/// One regeneration worker with a latest-request-wins write fence. Startup
/// persona backfill can request hundreds of renders: intermediate requests must
/// supersede stale writes without each doing their own archive snapshot read.
///
/// Claiming, finishing and committing share one lock. A trigger during a read
/// leaves one latest-generation follow-up; a trigger at worker shutdown either
/// becomes that follow-up or starts a new worker. No debounce or cached archive
/// state is needed. Once a newer generation is requested, an older one cannot
/// publish, even if the newer render fails (the next trigger can try again).
struct NestRegenGate {
    state: Mutex<NestRegenState>,
}

struct NestRegenState {
    highest_requested: u64,
    running: bool,
}

impl NestRegenGate {
    const fn new() -> Self {
        Self {
            state: Mutex::new(NestRegenState {
                highest_requested: 0,
                running: false,
            }),
        }
    }

    /// Claim synchronously, before spawning. Only the idle-to-running caller
    /// owns a worker; all other callers just advance the pending generation.
    fn claim(&self) -> (u64, bool) {
        let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        state.highest_requested += 1;
        let start_worker = !state.running;
        state.running = true;
        (state.highest_requested, start_worker)
    }

    /// Return work only to the caller that starts the worker. The callback is
    /// the real regeneration path, supplied here so tests can hold its I/O.
    fn request<'a, F, Fut>(
        &'a self,
        mut regenerate: F,
    ) -> Option<impl std::future::Future<Output = ()> + 'a>
    where
        F: FnMut(u64) -> Fut + 'a,
        Fut: std::future::Future<Output = Result<(), String>> + 'a,
    {
        let (mut generation, start_worker) = self.claim();
        if !start_worker {
            return None;
        }
        Some(async move {
            loop {
                if let Err(error) = regenerate(generation).await {
                    eprintln!("buzz-desktop: nest context regeneration failed: {error}");
                }
                let mut state = self.state.lock().unwrap_or_else(|p| p.into_inner());
                if state.highest_requested == generation {
                    state.running = false;
                    return;
                }
                generation = state.highest_requested;
            }
        })
    }

    /// Probe the exact claim/commit lock, including inside the commit hook.
    #[cfg(test)]
    fn try_claim(&self) -> Option<u64> {
        let mut state = match self.state.try_lock() {
            Ok(state) => state,
            Err(std::sync::TryLockError::WouldBlock) => return None,
            Err(std::sync::TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
        };
        state.highest_requested += 1;
        state.running = true;
        Some(state.highest_requested)
    }

    /// Commit `content` for `generation`, dropping the write once a newer
    /// generation has been *requested* (regardless of whether that newer
    /// generation has written or ever will). Returns whether the file was
    /// written. The lock spans the compare and the write so the check-and-write
    /// is atomic and no await occurs while it is held.
    fn commit(&self, agents_md: &Path, content: &str, generation: u64) -> io::Result<bool> {
        self.commit_hooked(agents_md, content, generation, || {})
    }

    /// [`commit`] with a hook invoked while the lock is held, after the
    /// eligibility compare and before the write. Production passes a no-op, so
    /// this is exactly [`commit`]; tests pass a hook that calls [`try_claim`]
    /// to prove no claim can land inside the compare-then-write window — the
    /// probe reports the lock held here, whereas the flawed
    /// separate-watermark/separate-write-lock design would report it free. The
    /// `impl FnOnce` monomorphizes the no-op away.
    fn commit_hooked(
        &self,
        agents_md: &Path,
        content: &str,
        generation: u64,
        under_lock: impl FnOnce(),
    ) -> io::Result<bool> {
        let requested = self
            .state
            .lock()
            .map_err(|_| io::Error::other("nest regen gate lock poisoned"))?;
        if generation < requested.highest_requested {
            return Ok(false);
        }
        under_lock();
        upsert_managed_section(agents_md, content)?;
        Ok(true)
    }
}

// A best-effort roster refresh must not strand every newer edit behind an old
// relay's unbounded NIP-11 body or admission wait. Bound the complete archive
// operation, not just request headers; timeout preserves the existing fail-open.
const NEST_ARCHIVE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);

/// Process-wide regeneration owner and ordered write gate.
static NEST_REGEN: NestRegenGate = NestRegenGate::new();

pub async fn regenerate_nest_context<R: tauri::Runtime>(
    app: &AppHandle<R>,
    generation: u64,
) -> Result<(), String> {
    let nest = nest_dir().ok_or("cannot resolve home directory for nest")?;
    let agents_md = nest.join("AGENTS.md");

    if !agents_md.exists() {
        return Ok(());
    }

    let personas = load_personas(app)?;
    let agents = load_managed_agents(app)?;
    let state = app.state::<AppState>();
    // Capture the relay target once, before any network work, so this
    // generation's rendered footer, NIP-11 signer, and snapshot query all
    // belong to one relay even if a workspace switch changes the override
    // between the two archive awaits below.
    let target = capture_relay_target(&state);
    // Identity-archived agents live only in the relay's `kind:13535` snapshot;
    // local records all read `is_active: true`. Fails open (empty set → render
    // everyone) so an unreachable relay can't blank the roster. The archive read
    // uses the same captured target as the rendered relay; a later generation's
    // task always wins the commit, so a fallback-relay boot render cannot bury a
    // later apply_workspace render.
    let archived: HashSet<String> = match tokio::time::timeout(
        NEST_ARCHIVE_TIMEOUT,
        fetch_archived_pubkeys_at(&state, &target),
    )
    .await
    {
        Ok(pubkeys) => pubkeys.into_iter().collect(),
        Err(_) => {
            eprintln!(
                "buzz-desktop: nest archive read timed out; rendering without archive filter"
            );
            HashSet::new()
        }
    };
    let content = render_dynamic_section(&personas, &agents, &archived, &target.ws_url);
    NEST_REGEN
        .commit(&agents_md, &content, generation)
        .map_err(|e| format!("regenerate nest context: {e}"))?;

    Ok(())
}

/// Fire-and-forget regeneration: one worker reads the latest state, with one
/// pending follow-up if another trigger arrives. Failures still warn and leave
/// the file for the next trigger; they never strand the worker as running.
/// Archive/unarchive can race the relay's snapshot update, so an archived agent
/// may still linger until the next trigger, as before.
pub fn try_regenerate_nest<R: tauri::Runtime>(app: &AppHandle<R>) {
    let app = app.clone();
    if let Some(work) = NEST_REGEN.request(move |generation| {
        let app = app.clone();
        async move { regenerate_nest_context(&app, generation).await }
    }) {
        tauri::async_runtime::spawn(work);
    }
}

#[cfg(test)]
mod regen_tests;
#[cfg(test)]
mod regen_trigger_tests;
#[cfg(test)]
mod render_tests;
#[cfg(test)]
mod tests;
