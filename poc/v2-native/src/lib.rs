//! Isolated native reference. Not linked into the Classic Tauri application.
pub mod policy;
pub mod system_vault;
pub mod vault;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Error {
    InvalidProfile,
    InvalidPath,
    PathAlias,
    PathOverlap,
    InvalidScope,
    CloudTargetMismatch,
    LocalModeHasNoVault,
    InvalidSecret,
    VaultUnavailable,
    UnsupportedPlatform,
}
impl std::fmt::Display for Error {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{self:?}")
    }
}
impl std::error::Error for Error {}
pub type Result<T> = std::result::Result<T, Error>;

#[cfg(test)]
mod tests;
