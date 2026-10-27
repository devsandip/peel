#import <Foundation/Foundation.h>
#import <ServiceManagement/ServiceManagement.h>
#include <stdlib.h>

// This guard is also enforced by Rust. Synthetic runs cannot change login items.
static int eligibility(void) {
    if (getenv("PEEL_DATA_DIR") != NULL) return 7;
    NSBundle *bundle = NSBundle.mainBundle;
    if (![bundle.bundleIdentifier isEqualToString:@"com.peelnotes.desktop"] ||
        ![bundle.bundleURL.pathExtension isEqualToString:@"app"]) return 6;
    return 0;
}

int peel_login_item_status(void) {
    @autoreleasepool {
        int blocked = eligibility();
        if (blocked) return blocked;
        @try {
            return (int)SMAppService.mainAppService.status;
        } @catch (NSException *exception) {
            return 4;
        }
    }
}

int peel_login_item_change(int enable) {
    @autoreleasepool {
        if (eligibility()) return 0;
        @try {
            NSError *error = nil;
            return enable
                ? [SMAppService.mainAppService registerAndReturnError:&error]
                : [SMAppService.mainAppService unregisterAndReturnError:&error];
        } @catch (NSException *exception) {
            return 0;
        }
    }
}

int peel_login_item_open_settings(void) {
    @autoreleasepool {
        if (eligibility()) return 0;
        @try {
            [SMAppService openSystemSettingsLoginItems];
            return 1;
        } @catch (NSException *exception) {
            return 0;
        }
    }
}
