use super::render::find_marker_at_line_start;
use super::{AGENTS_MD, BEGIN_MARKER, BUZZ_CLI_SKILL_MD, NEST_AGENTS_VERSION, NEST_SKILL_VERSION};
#[cfg(unix)]
use crate::util::create_symlink;
use std::{fs, path::Path};

/// Read a version number from a file. Returns 0 if the file doesn't exist or can't be parsed.
fn read_version_file(path: &Path) -> u32 {
    fs::read_to_string(path)
        .ok()
        .and_then(|s| s.trim().parse().ok())
        .unwrap_or(0)
}

/// Refresh AGENTS.md static content if the template version has changed.
///
/// Preserves everything from the `<!-- BEGIN BUZZ MANAGED` marker onward
/// (the dynamic section managed by `upsert_managed_section`). Replaces
/// only the static template content above the marker.
pub(super) fn refresh_agents_md_if_stale(root: &Path) -> Result<(), String> {
    let version_path = root.join(".nest-agents-version");
    if read_version_file(&version_path) >= NEST_AGENTS_VERSION {
        return Ok(());
    }

    let agents_md = root.join("AGENTS.md");
    let current =
        fs::read_to_string(&agents_md).map_err(|e| format!("read {}: {e}", agents_md.display()))?;

    let new_content = match find_marker_at_line_start(&current, BEGIN_MARKER) {
        Some(pos) => {
            // Find the start of the marker line (could be preceded by blank lines).
            let marker_line_start = current[..pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
            // Template content up to (but not including) the managed section,
            // then the existing managed section from the marker onward.
            let template_static = match AGENTS_MD.find(BEGIN_MARKER) {
                Some(tmpl_marker_pos) => {
                    let tmpl_line_start = AGENTS_MD[..tmpl_marker_pos]
                        .rfind('\n')
                        .map(|p| p + 1)
                        .unwrap_or(0);
                    &AGENTS_MD[..tmpl_line_start]
                }
                None => AGENTS_MD,
            };
            format!("{}{}", template_static, &current[marker_line_start..])
        }
        None => {
            // No managed section found — write full template.
            AGENTS_MD.to_string()
        }
    };

    // Atomic write via temp file.
    let parent = agents_md.parent().ok_or("AGENTS.md has no parent dir")?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("tempfile in {}: {e}", parent.display()))?;
    {
        use std::io::Write;
        tmp.write_all(new_content.as_bytes())
            .map_err(|e| format!("write tempfile: {e}"))?;
    }
    tmp.persist(&agents_md)
        .map_err(|e| format!("persist {}: {e}", agents_md.display()))?;

    fs::write(&version_path, format!("{NEST_AGENTS_VERSION}\n"))
        .map_err(|e| format!("write {}: {e}", version_path.display()))?;

    Ok(())
}

/// Refresh SKILL.md if the template version has changed.
///
/// SKILL.md has no user-editable sections — it is fully overwritten on version bump.
pub(super) fn refresh_skill_md_if_stale(root: &Path) -> Result<(), String> {
    let agents_skill_dir = root.join(".agents/skills/buzz-cli");
    let version_path = agents_skill_dir.join(".skill-version");
    if read_version_file(&version_path) >= NEST_SKILL_VERSION {
        return Ok(());
    }

    // Migration: if .claude/skills/buzz-cli exists as a real directory
    // (pre-migration install), copy user's SKILL.md to the new location
    // then remove the old directory so we can replace it with a symlink.
    let old_skill_dir = root.join(".claude/skills/buzz-cli");
    let old_is_real_dir = old_skill_dir
        .symlink_metadata()
        .map(|m| m.file_type().is_dir())
        .unwrap_or(false);

    let skill_content = if old_is_real_dir {
        // Preserve user-edited content during migration.
        fs::read_to_string(old_skill_dir.join("SKILL.md"))
            .unwrap_or_else(|_| BUZZ_CLI_SKILL_MD.to_string())
    } else {
        BUZZ_CLI_SKILL_MD.to_string()
    };

    // Ensure the canonical .agents skill directory exists.
    fs::create_dir_all(&agents_skill_dir)
        .map_err(|e| format!("create {}: {e}", agents_skill_dir.display()))?;

    // Atomic write via temp file.
    let skill_md = agents_skill_dir.join("SKILL.md");
    let mut tmp = tempfile::NamedTempFile::new_in(&agents_skill_dir)
        .map_err(|e| format!("tempfile in {}: {e}", agents_skill_dir.display()))?;
    {
        use std::io::Write;
        tmp.write_all(skill_content.as_bytes())
            .map_err(|e| format!("write tempfile: {e}"))?;
    }
    tmp.persist(&skill_md)
        .map_err(|e| format!("persist {}: {e}", skill_md.display()))?;

    // Replace old real directory with a symlink.
    if old_is_real_dir {
        fs::remove_dir_all(&old_skill_dir)
            .map_err(|e| format!("remove {}: {e}", old_skill_dir.display()))?;
    }

    // Create/replace the .claude/skills/buzz-cli symlink.
    #[cfg(unix)]
    {
        let claude_skills_dir = root.join(".claude/skills");
        fs::create_dir_all(&claude_skills_dir)
            .map_err(|e| format!("create {}: {e}", claude_skills_dir.display()))?;
        let symlink_path = root.join(".claude/skills/buzz-cli");
        // Remove any stale symlink before (re)creating.
        let symlink_exists = symlink_path
            .symlink_metadata()
            .map(|m| m.file_type().is_symlink())
            .unwrap_or(false);
        if symlink_exists {
            fs::remove_file(&symlink_path)
                .map_err(|e| format!("remove symlink {}: {e}", symlink_path.display()))?;
        }
        create_symlink(
            std::path::Path::new("../../.agents/skills/buzz-cli"),
            &symlink_path,
        )
        .map_err(|e| format!("symlink {}: {e}", symlink_path.display()))?;
    }

    fs::write(&version_path, format!("{NEST_SKILL_VERSION}\n"))
        .map_err(|e| format!("write {}: {e}", version_path.display()))?;

    Ok(())
}
