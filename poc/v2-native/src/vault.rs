use crate::policy::{identity, CloudTarget, Profile, WorkspaceKind};
use crate::{Error, Result};
use std::fmt;
pub const MAX_SECRET_BYTES: usize = 2048;

/// Deliberately no Clone/Display/serialization. Debug never includes secret content.
pub struct Secret(Vec<u8>);
impl Secret {
    pub fn new(bytes: Vec<u8>) -> Result<Self> {
        let value = Self(bytes);
        if value.0.is_empty() || value.0.len() > MAX_SECRET_BYTES || std::str::from_utf8(&value.0).is_err() || value.0.iter().any(|b| b.is_ascii_control()) { return Err(Error::InvalidSecret); }
        Ok(value)
    }
    #[cfg(any(target_os = "windows", target_os = "macos", test, feature = "check-os-bindings"))]
    pub(crate) fn bytes(&self) -> &[u8] { &self.0 }
}
impl fmt::Debug for Secret { fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result { f.write_str("Secret([REDACTED])") } }
impl Drop for Secret {
    fn drop(&mut self) { for byte in &mut self.0 { unsafe { std::ptr::write_volatile(byte, 0); } } }
}
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CredentialKey { service: String, account: String }
impl CredentialKey { pub fn service(&self) -> &str { &self.service } pub fn account(&self) -> &str { &self.account } }
fn uuid(value: &str) -> bool { value.len() == 36 && value.bytes().enumerate().all(|(i,c)| if [8,13,18,23].contains(&i) { c == b'-' } else { c.is_ascii_digit() || (b'a'..=b'f').contains(&c) }) }
#[derive(Debug, Clone)]
pub struct AccountScope { target: CloudTarget, owner: String, device: String }
impl AccountScope {
    pub fn new(target: CloudTarget, owner: &str, device: &str) -> Result<Self> {
        if !uuid(owner) || !uuid(device) { return Err(Error::InvalidScope); }
        Ok(Self { target, owner: owner.into(), device: device.into() })
    }
}
pub trait SecureVault {
    fn read(&mut self, key: &CredentialKey) -> Result<Option<Secret>>;
    fn write(&mut self, key: &CredentialKey, secret: &Secret) -> Result<()>;
    fn delete(&mut self, key: &CredentialKey) -> Result<()>;
}
pub struct SessionVault<B: SecureVault> { backend: B, key: CredentialKey }
impl<B: SecureVault> SessionVault<B> {
    pub fn new(profile: Profile, kind: WorkspaceKind, scope: AccountScope, factory: impl FnOnce() -> Result<B>) -> Result<Self> {
        if profile != Profile::ConnectedPreview || kind != WorkspaceKind::Online { return Err(Error::LocalModeHasNoVault); }
        let key = CredentialKey { service: format!("{}.auth.v1", identity(profile)?.app_id), account: format!("{}:{}:{}:{}", scope.target.env().key(), scope.target.project(), scope.owner, scope.device) };
        Ok(Self { backend: factory()?, key })
    }
    pub fn read_refresh_token(&mut self) -> Result<Option<Secret>> { self.backend.read(&self.key) }
    pub fn write_refresh_token(&mut self, token: &Secret) -> Result<()> { self.backend.write(&self.key, token) }
    pub fn logout(&mut self) -> Result<()> { self.backend.delete(&self.key) }
    pub fn key(&self) -> &CredentialKey { &self.key }
}
