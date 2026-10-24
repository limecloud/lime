use super::*;
use core_foundation::{
    base::{Boolean, CFType, TCFType},
    string::{CFString, CFStringRef},
};
use std::ffi::c_void;

#[link(name = "CoreFoundation", kind = "framework")]
unsafe extern "C" {
    fn CFPreferencesCopyAppValue(key: CFStringRef, application_id: CFStringRef) -> *mut c_void;
    fn CFPreferencesAppValueIsForced(key: CFStringRef, application_id: CFStringRef) -> Boolean;
}

pub(super) fn read(key: &str) -> Result<Option<String>, ConfigError> {
    let key = CFString::new(key);
    let domain = CFString::new(PREFERENCES_DOMAIN);
    read_forced(
        || unsafe {
            CFPreferencesAppValueIsForced(key.as_concrete_TypeRef(), domain.as_concrete_TypeRef())
                != 0
        },
        || {
            let value = unsafe {
                CFPreferencesCopyAppValue(key.as_concrete_TypeRef(), domain.as_concrete_TypeRef())
            };
            if value.is_null() {
                None
            } else {
                // Copy 返回自有引用，由 CFType 在离开作用域时释放。
                Some(unsafe { CFType::wrap_under_create_rule(value) })
            }
        },
        |value| value.downcast::<CFString>().map(|value| value.to_string()),
    )
}
