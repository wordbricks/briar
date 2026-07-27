#include "bindings/bindings.h"
#import <UIKit/UIKit.h>
#include <cstring>

extern "C" int briar_ios_current_app_icon(char *buffer, size_t length) {
	if (buffer == nullptr || length == 0) {
		return 0;
	}

	__block NSString *iconName = nil;
	void (^readIcon)(void) = ^{
		if (@available(iOS 10.3, *)) {
			iconName = UIApplication.sharedApplication.alternateIconName;
		}
	};
	if (NSThread.isMainThread) {
		readIcon();
	} else {
		dispatch_sync(dispatch_get_main_queue(), readIcon);
	}

	if (iconName == nil) {
		buffer[0] = '\0';
		return 0;
	}
	std::strncpy(buffer, iconName.UTF8String, length - 1);
	buffer[length - 1] = '\0';
	return 1;
}

extern "C" int briar_ios_set_app_icon(const char *iconName) {
	__block BOOL accepted = NO;
	NSString *alternateIcon = iconName == nullptr
		? nil
		: [NSString stringWithUTF8String:iconName];
	void (^changeIcon)(void) = ^{
		if (@available(iOS 10.3, *)) {
			UIApplication *application = UIApplication.sharedApplication;
			if (!application.supportsAlternateIcons) {
				return;
			}
			[application setAlternateIconName:alternateIcon completionHandler:^(NSError *error) {
				if (error != nil) {
					NSLog(@"Unable to change Briar app icon: %@", error.localizedDescription);
				}
			}];
			accepted = YES;
		}
	};
	if (NSThread.isMainThread) {
		changeIcon();
	} else {
		dispatch_sync(dispatch_get_main_queue(), changeIcon);
	}
	return accepted ? 1 : 0;
}

int main(int argc, char * argv[]) {
	ffi::start_app();
	return 0;
}
