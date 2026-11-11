//! OS credential APIs only. Never shell commands, browser storage or plaintext fallback.
use crate::vault::{CredentialKey, Secret, SecureVault};
use crate::{Error, Result};
pub struct SystemVault;
impl SystemVault {
    pub fn new() -> Result<Self> {
        if cfg!(any(target_os = "windows", target_os = "macos")) { Ok(Self) } else { Err(Error::UnsupportedPlatform) }
    }
}
impl SecureVault for SystemVault {
    fn read(&mut self, key: &CredentialKey) -> Result<Option<Secret>> { os::read(key) }
    fn write(&mut self, key: &CredentialKey, token: &Secret) -> Result<()> { os::write(key, token) }
    fn delete(&mut self, key: &CredentialKey) -> Result<()> { os::delete(key) }
}
#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod os {
    use super::*;
    pub fn read(_: &CredentialKey) -> Result<Option<Secret>> { Err(Error::UnsupportedPlatform) }
    pub fn write(_: &CredentialKey, _: &Secret) -> Result<()> { Err(Error::UnsupportedPlatform) }
    pub fn delete(_: &CredentialKey) -> Result<()> { Err(Error::UnsupportedPlatform) }
}
#[cfg(any(target_os = "windows", feature = "check-os-bindings"))]
#[cfg_attr(feature = "check-os-bindings", allow(dead_code))]
mod windows_os {
    use super::*;
    use crate::vault::MAX_SECRET_BYTES;
    use std::ffi::c_void;
    #[repr(C)]
    struct Credential { flags:u32, kind:u32, target:*mut u16, comment:*mut u16, last_written:[u32;2], blob_size:u32, blob:*mut u8, persist:u32, attribute_count:u32, attributes:*mut c_void, alias:*mut u16, username:*mut u16 }
    #[cfg_attr(target_os="windows", link(name="Advapi32"))]
    extern "system" {
        fn CredReadW(target:*const u16,kind:u32,flags:u32,out:*mut *mut Credential)->i32;
        fn CredWriteW(value:*const Credential,flags:u32)->i32;
        fn CredDeleteW(target:*const u16,kind:u32,flags:u32)->i32;
        fn CredFree(value:*mut c_void);
    }
    #[cfg_attr(target_os="windows", link(name="Kernel32"))]
    extern "system" { fn GetLastError()->u32; }
    fn target(key:&CredentialKey)->Vec<u16>{format!("{}/{}",key.service(),key.account()).encode_utf16().chain(Some(0)).collect()}
    pub fn read(key:&CredentialKey)->Result<Option<Secret>> {
        let target=target(key);let mut ptr=std::ptr::null_mut();
        unsafe {
            if CredReadW(target.as_ptr(),1,0,&mut ptr)==0 { return if GetLastError()==1168 {Ok(None)}else{Err(Error::VaultUnavailable)}; }
            if ptr.is_null(){return Err(Error::VaultUnavailable);}
            let result=if (*ptr).blob_size==0 || (*ptr).blob_size as usize>MAX_SECRET_BYTES || (*ptr).blob.is_null(){Err(Error::InvalidSecret)}else{Secret::new(std::slice::from_raw_parts((*ptr).blob,(*ptr).blob_size as usize).to_vec()).map(Some)};
            CredFree(ptr.cast());result
        }
    }
    pub fn write(key:&CredentialKey,token:&Secret)->Result<()> {
        let mut target=target(key);let mut username:Vec<u16>=key.account().encode_utf16().chain(Some(0)).collect();
        let value=Credential{flags:0,kind:1,target:target.as_mut_ptr(),comment:std::ptr::null_mut(),last_written:[0;2],blob_size:token.bytes().len() as u32,blob:token.bytes().as_ptr().cast_mut(),persist:2,attribute_count:0,attributes:std::ptr::null_mut(),alias:std::ptr::null_mut(),username:username.as_mut_ptr()};
        if unsafe{CredWriteW(&value,0)}!=0{Ok(())}else{Err(Error::VaultUnavailable)}
    }
    pub fn delete(key:&CredentialKey)->Result<()> {
        let target=target(key);if unsafe{CredDeleteW(target.as_ptr(),1,0)}!=0||unsafe{GetLastError()}==1168{Ok(())}else{Err(Error::VaultUnavailable)}
    }
}
#[cfg(any(target_os = "macos", feature = "check-os-bindings"))]
#[cfg_attr(feature = "check-os-bindings", allow(dead_code))]
mod macos_os {
    use super::*;
    use crate::vault::MAX_SECRET_BYTES;
    use std::ffi::c_void;
    type Item=*mut c_void;
    #[cfg_attr(target_os="macos", link(name="Security",kind="framework"))]
    extern "C" {
        fn SecKeychainFindGenericPassword(chain:Item,service_len:u32,service:*const u8,account_len:u32,account:*const u8,length:*mut u32,data:*mut *mut c_void,item:*mut Item)->i32;
        fn SecKeychainAddGenericPassword(chain:Item,service_len:u32,service:*const u8,account_len:u32,account:*const u8,length:u32,data:*const c_void,item:*mut Item)->i32;
        fn SecKeychainItemModifyAttributesAndData(item:Item,attributes:*const c_void,length:u32,data:*const c_void)->i32;
        fn SecKeychainItemDelete(item:Item)->i32;
        fn SecKeychainItemFreeContent(attributes:*mut c_void,data:*mut c_void)->i32;
    }
    #[cfg_attr(target_os="macos", link(name="CoreFoundation",kind="framework"))]
    extern "C" { fn CFRelease(item:*const c_void); }
    const MISSING:i32=-25300;
    unsafe fn find(key:&CredentialKey,length:*mut u32,data:*mut *mut c_void,item:*mut Item)->i32{SecKeychainFindGenericPassword(std::ptr::null_mut(),key.service().len() as u32,key.service().as_ptr(),key.account().len() as u32,key.account().as_ptr(),length,data,item)}
    pub fn read(key:&CredentialKey)->Result<Option<Secret>> {
        let mut length=0;let mut data=std::ptr::null_mut();let status=unsafe{find(key,&mut length,&mut data,std::ptr::null_mut())};
        if status==MISSING{return Ok(None);}if status!=0{return Err(Error::VaultUnavailable);}
        let result=if length==0||length as usize>MAX_SECRET_BYTES||data.is_null(){Err(Error::InvalidSecret)}else{Secret::new(unsafe{std::slice::from_raw_parts(data.cast::<u8>(),length as usize)}.to_vec()).map(Some)};
        unsafe{SecKeychainItemFreeContent(std::ptr::null_mut(),data);}result
    }
    pub fn write(key:&CredentialKey,token:&Secret)->Result<()> {
        let mut item=std::ptr::null_mut();let found=unsafe{find(key,std::ptr::null_mut(),std::ptr::null_mut(),&mut item)};
        let status=if found==0 {if item.is_null(){return Err(Error::VaultUnavailable);}let status=unsafe{SecKeychainItemModifyAttributesAndData(item,std::ptr::null(),token.bytes().len() as u32,token.bytes().as_ptr().cast())};unsafe{CFRelease(item);}status}
        else if found==MISSING{unsafe{SecKeychainAddGenericPassword(std::ptr::null_mut(),key.service().len() as u32,key.service().as_ptr(),key.account().len() as u32,key.account().as_ptr(),token.bytes().len() as u32,token.bytes().as_ptr().cast(),std::ptr::null_mut())}}
        else{return Err(Error::VaultUnavailable);};
        if status==0{Ok(())}else{Err(Error::VaultUnavailable)}
    }
    pub fn delete(key:&CredentialKey)->Result<()> {
        let mut item=std::ptr::null_mut();let found=unsafe{find(key,std::ptr::null_mut(),std::ptr::null_mut(),&mut item)};
        if found==MISSING{return Ok(());}if found!=0||item.is_null(){return Err(Error::VaultUnavailable);}
        let status=unsafe{SecKeychainItemDelete(item)};unsafe{CFRelease(item);}if status==0{Ok(())}else{Err(Error::VaultUnavailable)}
    }
}

#[cfg(target_os = "windows")]
use windows_os as os;
#[cfg(target_os = "macos")]
use macos_os as os;
