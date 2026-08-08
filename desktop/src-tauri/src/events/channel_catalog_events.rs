use super::tag;
use nostr::{EventBuilder, Kind};
use uuid::Uuid;

/// Kind 9007 — create a channel with shared catalog metadata.
#[allow(clippy::too_many_arguments)]
pub fn build_create_channel_with_catalog_section(
    channel_id: Uuid,
    name: &str,
    visibility: &str,
    channel_type: &str,
    about: Option<&str>,
    ttl_seconds: Option<i32>,
    catalog_section: Option<&str>,
) -> Result<EventBuilder, String> {
    let name = buzz_sdk_pkg::canonical_channel_name(name);
    if name.trim().is_empty() {
        return Err("channel name is required".into());
    }
    let mut tags = vec![
        tag(vec!["h", &channel_id.to_string()])?,
        tag(vec!["name", name])?,
        tag(vec!["visibility", visibility])?,
        tag(vec!["channel_type", channel_type])?,
    ];
    if let Some(a) = about {
        tags.push(tag(vec!["about", a])?);
    }
    if let Some(ttl) = ttl_seconds {
        tags.push(tag(vec!["ttl", &ttl.to_string()])?);
    }
    if let Some(section) = catalog_section {
        tags.push(tag(vec!["catalog_section", section.trim()])?);
    }
    Ok(EventBuilder::new(Kind::Custom(9007), "").tags(tags))
}

/// Kind 9002 — update channel metadata including the relay-backed catalog
/// section. `Some(None)` clears the section with an empty tag value.
pub fn build_update_channel_with_catalog_section(
    channel_id: Uuid,
    name: Option<&str>,
    about: Option<&str>,
    visibility: Option<&str>,
    ttl: Option<Option<i32>>,
    catalog_section: Option<Option<&str>>,
) -> Result<EventBuilder, String> {
    if name.is_none()
        && about.is_none()
        && visibility.is_none()
        && ttl.is_none()
        && catalog_section.is_none()
    {
        return Err(
            "at least one of name, about, visibility, ttl, or catalog_section must be provided"
                .into(),
        );
    }
    if let Some(v) = visibility {
        if v != "open" && v != "private" {
            return Err("visibility must be \"open\" or \"private\"".into());
        }
    }
    let name = name.map(buzz_sdk_pkg::canonical_channel_name);
    if name.is_some_and(|name| name.trim().is_empty()) {
        return Err("channel name is required".into());
    }
    let mut tags = vec![tag(vec!["h", &channel_id.to_string()])?];
    if let Some(n) = name {
        tags.push(tag(vec!["name", n])?);
    }
    if let Some(a) = about {
        tags.push(tag(vec!["about", a])?);
    }
    if let Some(v) = visibility {
        tags.push(tag(vec!["visibility", v])?);
    }
    if let Some(ttl) = ttl {
        match ttl {
            Some(secs) => tags.push(tag(vec!["ttl", &secs.to_string()])?),
            None => tags.push(tag(vec!["ttl", ""])?),
        }
    }
    if let Some(section) = catalog_section {
        tags.push(tag(vec!["catalog_section", section.unwrap_or("").trim()])?);
    }
    Ok(EventBuilder::new(Kind::Custom(9002), "").tags(tags))
}
