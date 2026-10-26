#import <CoreLocation/CoreLocation.h>
#import <Foundation/Foundation.h>
#import <UserNotifications/UserNotifications.h>
#include <node_api.h>
#include <string>

// Runs inside Electron's main process. These permissions belong to the app
// delivering notifications and hosting websites, not the Computer Use helper.
namespace {
struct Result {
    std::string state;
    bool failed;
};

napi_value text(napi_env env, const char *value) {
    napi_value result;
    napi_create_string_utf8(env, value, NAPI_AUTO_LENGTH, &result);
    return result;
}

const char *notificationState(UNAuthorizationStatus status) {
    switch (status) {
        case UNAuthorizationStatusNotDetermined: return "notDetermined";
        case UNAuthorizationStatusDenied: return "denied";
        case UNAuthorizationStatusAuthorized:
        case UNAuthorizationStatusProvisional: return "granted";
        default: return "unknown";
    }
}

void complete(napi_env env, napi_value, void *context, void *data) {
    auto result = static_cast<Result *>(data);
    if (env) {
        auto deferred = static_cast<napi_deferred>(context);
        napi_value value = text(env, result->state.c_str());
        if (result->failed) {
            napi_value error;
            napi_create_error(env, nullptr, value, &error);
            napi_reject_deferred(env, deferred, error);
        } else {
            napi_resolve_deferred(env, deferred, value);
        }
    }
    delete result;
}

napi_value notification(napi_env env, bool request) {
    napi_deferred deferred;
    napi_value promise;
    napi_create_promise(env, &deferred, &promise);
    napi_threadsafe_function callback;
    const auto status = napi_create_threadsafe_function(
        env, nullptr, nullptr, text(env, "desktop-permissions"), 0, 1,
        nullptr, nullptr, deferred, complete, &callback);
    if (status != napi_ok) {
        napi_value error;
        napi_create_error(env, nullptr, text(env, "Unable to initialize notification permissions"), &error);
        napi_reject_deferred(env, deferred, error);
        return promise;
    }
    void (^deliver)(Result *) = ^(Result *result) {
        if (napi_call_threadsafe_function(callback, result, napi_tsfn_nonblocking) != napi_ok) delete result;
        napi_release_threadsafe_function(callback, napi_tsfn_release);
    };
    @try {
        UNUserNotificationCenter *center = [UNUserNotificationCenter currentNotificationCenter];
        void (^read)(void) = ^{
            [center getNotificationSettingsWithCompletionHandler:^(UNNotificationSettings *settings) {
                deliver(new Result{notificationState(settings.authorizationStatus), false});
            }];
        };
        if (request) {
            [center requestAuthorizationWithOptions:(UNAuthorizationOptionAlert | UNAuthorizationOptionSound | UNAuthorizationOptionBadge)
                completionHandler:^(BOOL, NSError *error) {
                    if (error) deliver(new Result{"Unable to request notification permissions", true});
                    else read();
                }];
        } else read();
    } @catch (NSException *) {
        deliver(new Result{"Notification permissions require a valid application bundle", true});
    }
    return promise;
}

CLLocationManager *locationManager() {
    static CLLocationManager *manager = [[CLLocationManager alloc] init];
    return manager;
}

napi_value location(napi_env env, bool request) {
    if (![NSThread isMainThread]) {
        napi_throw_error(env, nullptr, "Location permissions require the main thread");
        return nullptr;
    }
    CLLocationManager *manager = locationManager();
    if (request && manager.authorizationStatus == kCLAuthorizationStatusNotDetermined) {
        // Do not start location updates or collect coordinates during setup.
        [manager requestWhenInUseAuthorization];
    }
    const char *state;
    if (![CLLocationManager locationServicesEnabled]) state = "restricted";
    else switch (manager.authorizationStatus) {
        case kCLAuthorizationStatusNotDetermined: state = "notDetermined"; break;
        case kCLAuthorizationStatusRestricted: state = "restricted"; break;
        case kCLAuthorizationStatusDenied: state = "denied"; break;
        case kCLAuthorizationStatusAuthorized: state = "granted"; break;
        default: state = "unknown";
    }
    return text(env, state);
}

napi_value readNotifications(napi_env env, napi_callback_info) { return notification(env, false); }
napi_value requestNotifications(napi_env env, napi_callback_info) { return notification(env, true); }
napi_value readLocation(napi_env env, napi_callback_info) { return location(env, false); }
napi_value requestLocation(napi_env env, napi_callback_info) { return location(env, true); }
}

NAPI_MODULE_INIT() {
    napi_property_descriptor methods[] = {
        {"readNotifications", nullptr, readNotifications, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"requestNotifications", nullptr, requestNotifications, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"readLocation", nullptr, readLocation, nullptr, nullptr, nullptr, napi_default, nullptr},
        {"requestLocation", nullptr, requestLocation, nullptr, nullptr, nullptr, napi_default, nullptr},
    };
    napi_define_properties(env, exports, sizeof(methods) / sizeof(methods[0]), methods);
    return exports;
}
