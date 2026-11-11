use crate::{Error, Result};
use std::path::{Component, Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Profile { Classic, ConnectedPreview }
impl Profile { pub fn key(self) -> &'static str { match self { Self::Classic => "local-classic", Self::ConnectedPreview => "connected-preview" } } }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum WorkspaceKind { OfflineOnly, Online }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudEnv { Development, Production }
impl CloudEnv { pub fn key(self) -> &'static str { match self { Self::Development => "development", Self::Production => "production" } } }
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CloudTarget { env: CloudEnv, project: &'static str }
impl CloudTarget {
    pub fn new(env: CloudEnv, project: &str) -> Result<Self> {
        let expected = match env { CloudEnv::Development => "vsphftnmfzfoufasjttd", CloudEnv::Production => "hutqsfftioxtredcjhsy" };
        if project != expected { return Err(Error::CloudTargetMismatch); }
        Ok(Self { env, project: expected })
    }
    pub fn env(self) -> CloudEnv { self.env }
    pub fn project(self) -> &'static str { self.project }
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Identity {
    pub profile: Profile,
    pub app_id: &'static str,
    pub product_name: &'static str,
    pub config_directory: &'static str,
    pub release_repository: Option<&'static str>,
}
pub fn identity(profile: Profile) -> Result<Identity> {
    let source = include_str!("../profiles.tsv");
    let mut found = None;
    for line in source.lines().skip(1) {
        let fields: Vec<_> = line.split('|').collect();
        if fields.len() != 5 { return Err(Error::InvalidProfile); }
        if fields[0] != profile.key() { continue; }
        if found.is_some() || fields[1].is_empty() || fields[2].is_empty() || fields[3].is_empty() || fields[3].contains(['/', '\\', '.', ':']) { return Err(Error::InvalidProfile); }
        found = Some(Identity { profile, app_id: fields[1], product_name: fields[2], config_directory: fields[3], release_repository: if fields[4].is_empty() { None } else { Some(fields[4]) } });
    }
    found.ok_or(Error::InvalidProfile)
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Layout {
    pub config_root: PathBuf,
    pub native_root: PathBuf,
    pub settings: PathBuf,
    pub project_root: Option<PathBuf>,
    pub registry: Option<PathBuf>,
    pub online_cache: Option<PathBuf>,
    pub diagnostics: PathBuf,
    pub updates: Option<PathBuf>,
    pub instance_namespace: String,
}
fn absolute(base: &Path) -> Result<()> {
    if !base.is_absolute() || base.components().any(|c| matches!(c, Component::ParentDir)) { return Err(Error::InvalidPath); }
    Ok(())
}
pub fn layout(profile: Profile, base: &Path, target: Option<CloudTarget>) -> Result<Layout> {
    absolute(base)?;
    let id = identity(profile)?;
    let config_root = base.join(id.config_directory);
    let native_root = base.join(id.app_id);
    let project_root = match (profile, target) {
        (Profile::Classic, None) => None,
        (Profile::ConnectedPreview, Some(t)) => Some(config_root.join(t.env.key()).join(t.project)),
        _ => return Err(Error::CloudTargetMismatch),
    };
    Ok(Layout { settings: config_root.join("config.json"), registry: project_root.as_ref().map(|p| p.join("workspaces.sqlite")), online_cache: project_root.as_ref().map(|p| p.join("online-cache")), diagnostics: native_root.join("diagnostics"), updates: id.release_repository.map(|_| native_root.join("updates")), instance_namespace: format!("{}:instance", id.app_id), config_root, native_root, project_root })
}
/// Validate existing directories before a native bootstrap creates profile files.
/// No file creation, config discovery, migration or link following is performed here.
pub fn validate_existing_root(root: &Path, protected: &[PathBuf]) -> Result<()> {
    absolute(root)?;
    if protected.is_empty() { return Err(Error::InvalidPath); }
    if !root.is_dir() { return Err(Error::InvalidPath); }
    let actual = std::fs::canonicalize(root).map_err(|_| Error::InvalidPath)?;
    if actual != root { return Err(Error::PathAlias); }
    for original in protected {
        let source = std::fs::canonicalize(original).map_err(|_| Error::InvalidPath)?;
        if actual.starts_with(&source) || source.starts_with(&actual) { return Err(Error::PathOverlap); }
    }
    Ok(())
}
pub fn updater_repository(profile: Profile) -> Result<&'static str> {
    identity(profile)?.release_repository.ok_or(Error::InvalidProfile)
}
