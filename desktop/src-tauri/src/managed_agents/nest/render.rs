use super::{AgentDefinition, ManagedAgentRecord, BEGIN_MARKER, END_MARKER};
use std::{collections::HashSet, fs, io, path::Path};

fn escape_md_cell(s: &str) -> String {
    s.replace('|', "\\|").replace('\n', " ")
}

/// True iff the relay has archived this instance's identity. Membership is
/// tested against the relay's `kind:13535` snapshot (lowercased hex); an empty
/// set (relay unreachable) fails open — see [`regenerate_nest_context`].
fn is_archived(record: &ManagedAgentRecord, archived: &HashSet<String>) -> bool {
    archived.contains(&record.pubkey.to_ascii_lowercase())
}

pub fn render_dynamic_section(
    personas: &[AgentDefinition],
    agents: &[ManagedAgentRecord],
    archived: &HashSet<String>,
    relay_url: &str,
) -> String {
    // Every managed agent is eligible on every community — `relay_url` is a
    // legacy creation-era field that `effective_agent_relay_url()` deliberately
    // ignores, and snapshot-imported records store it empty by design. The only
    // roster filter is identity-archive.
    let live: Vec<&ManagedAgentRecord> = agents
        .iter()
        .filter(|a| !is_archived(a, archived))
        .collect();
    let active_agents = if live.is_empty() {
        "## Active Agents\n\n*(No agents deployed yet. Add agents in the Buzz desktop app.)*"
            .to_string()
    } else {
        let mut table =
            "## Active Agents\n\n| Name | Persona | How to address |\n|------|---------|----------------|"
                .to_string();
        for agent in live {
            let role = agent
                .persona_id
                .as_deref()
                .and_then(|pid| personas.iter().find(|p| p.id == pid))
                .map(|p| p.display_name.as_str())
                .unwrap_or("—");
            let name = escape_md_cell(&agent.name);
            let role_escaped = escape_md_cell(role);
            table.push_str(&format!("\n| {name} | {role_escaped} | @{name} |"));
        }
        table
    };

    let relay_url = relay_url.replace(['\n', '\r'], "");
    format!("{active_agents}\n\n## Workspace\n- Relay: {relay_url}")
}

/// Find a marker that appears at the start of a line (position 0 or preceded by `\n`).
pub(super) fn find_marker_at_line_start(content: &str, marker: &str) -> Option<usize> {
    let mut search_from = 0;
    while let Some(pos) = content[search_from..].find(marker) {
        let abs_pos = search_from + pos;
        if abs_pos == 0 || content.as_bytes()[abs_pos - 1] == b'\n' {
            return Some(abs_pos);
        }
        search_from = abs_pos + 1;
    }
    None
}

/// Find the first valid ordered BEGIN/END marker pair, both at line starts.
/// Returns `(begin_line_start, after_end)` byte offsets for slicing.
fn find_managed_markers(content: &str) -> Option<(usize, usize)> {
    let begin_pos = find_marker_at_line_start(content, BEGIN_MARKER)?;
    let begin_line_start = content[..begin_pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
    let end_pos =
        find_marker_at_line_start(&content[begin_pos..], END_MARKER).map(|p| p + begin_pos)?;
    let end_of_end = end_pos + END_MARKER.len();
    let after_end = if content[end_of_end..].starts_with('\n') {
        end_of_end + 1
    } else {
        end_of_end
    };
    Some((begin_line_start, after_end))
}

/// Remove an orphan BEGIN marker line (one with no matching END after it).
fn strip_orphan_begin_marker(content: &str) -> String {
    if let Some(pos) = find_marker_at_line_start(content, BEGIN_MARKER) {
        let line_start = content[..pos].rfind('\n').map(|p| p + 1).unwrap_or(0);
        let line_end = content[pos..]
            .find('\n')
            .map(|p| pos + p + 1)
            .unwrap_or(content.len());
        format!(
            "{}{}",
            &content[..line_start],
            content[line_end..]
                .strip_prefix('\n')
                .unwrap_or(&content[line_end..])
        )
    } else {
        content.to_string()
    }
}

pub fn upsert_managed_section(file_path: &Path, new_section_content: &str) -> io::Result<()> {
    let current = fs::read_to_string(file_path)?;

    let replacement = format!(
        "{BEGIN_MARKER} — regenerated automatically, do not edit below -->\n{new_section_content}\n{END_MARKER}\n"
    );

    let new_content = match find_managed_markers(&current) {
        Some((begin_line_start, after_end)) => {
            format!(
                "{}{}{}",
                &current[..begin_line_start],
                replacement,
                &current[after_end..]
            )
        }
        None => {
            let cleaned = strip_orphan_begin_marker(&current);
            format!("{}\n\n{}", cleaned.trim_end_matches('\n'), replacement)
        }
    };

    // Skip write when content is unchanged — avoids bumping mtime on every launch.
    if new_content == current {
        return Ok(());
    }

    let parent = file_path.parent().ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::InvalidInput,
            "file path has no parent directory",
        )
    })?;
    let mut tmp = tempfile::NamedTempFile::new_in(parent)?;
    {
        use std::io::Write;
        tmp.write_all(new_content.as_bytes())?;
    }
    tmp.persist(file_path).map_err(|e| e.error)?;

    Ok(())
}
