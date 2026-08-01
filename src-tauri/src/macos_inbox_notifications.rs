use std::{cell::Cell, ptr::NonNull, sync::OnceLock};

use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use block2::{DynBlock, RcBlock};
use futures_channel::oneshot;
use objc2::{
    define_class,
    rc::Retained,
    runtime::{Bool, ProtocolObject},
    AnyThread,
};
use objc2_foundation::{NSError, NSObject, NSObjectProtocol, NSString};
use objc2_user_notifications::{
    UNAuthorizationOptions, UNMutableNotificationContent, UNNotification,
    UNNotificationDefaultActionIdentifier, UNNotificationPresentationOptions,
    UNNotificationRequest, UNNotificationResponse, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};
use tauri::{AppHandle, Emitter, Manager};

use crate::{
    InboxNotificationTarget, PendingInboxNotificationOpens, INBOX_NOTIFICATION_OPEN_AVAILABLE_EVENT,
};

const NOTIFICATION_ID_PREFIX: &str = "briar-inbox:v1:";

static APP_HANDLE: OnceLock<AppHandle> = OnceLock::new();

fn notification_id(target: &InboxNotificationTarget) -> Result<String, String> {
    let payload = serde_json::to_vec(target).map_err(|error| error.to_string())?;
    Ok(format!(
        "{NOTIFICATION_ID_PREFIX}{}",
        URL_SAFE_NO_PAD.encode(payload)
    ))
}

fn target_from_notification_id(identifier: &str) -> Option<InboxNotificationTarget> {
    let payload = identifier.strip_prefix(NOTIFICATION_ID_PREFIX)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn handle_notification_open(target: InboxNotificationTarget) {
    let Some(app) = APP_HANDLE.get() else {
        return;
    };

    app.state::<PendingInboxNotificationOpens>().push(target);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
    let _ = app.emit(INBOX_NOTIFICATION_OPEN_AVAILABLE_EVENT, ());
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "BriarInboxNotificationDelegate"]
    struct InboxNotificationDelegate;

    unsafe impl NSObjectProtocol for InboxNotificationDelegate {}

    unsafe impl UNUserNotificationCenterDelegate for InboxNotificationDelegate {
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present_notification(
            &self,
            _center: &UNUserNotificationCenter,
            _notification: &UNNotification,
            completion_handler: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            completion_handler.call((UNNotificationPresentationOptions::Banner,));
        }

        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive_response(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion_handler: &DynBlock<dyn Fn()>,
        ) {
            let action_identifier = response.actionIdentifier();
            let default_action = unsafe { UNNotificationDefaultActionIdentifier };
            if action_identifier.isEqualToString(default_action) {
                let identifier = response.notification().request().identifier().to_string();
                if let Some(target) = target_from_notification_id(&identifier) {
                    handle_notification_open(target);
                }
            }
            completion_handler.call(());
        }
    }
);

impl InboxNotificationDelegate {
    fn new() -> Retained<Self> {
        let this = Self::alloc().set_ivars(());
        unsafe { objc2::msg_send![super(this), init] }
    }
}

pub(crate) fn install(app: &AppHandle) {
    let _ = APP_HANDLE.set(app.clone());
    static DELEGATE: OnceLock<Retained<InboxNotificationDelegate>> = OnceLock::new();
    DELEGATE.get_or_init(|| {
        let delegate = InboxNotificationDelegate::new();
        UNUserNotificationCenter::currentNotificationCenter()
            .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
        delegate
    });
}

pub(crate) async fn request_permission() -> Result<bool, String> {
    let (sender, receiver) = oneshot::channel::<Result<bool, String>>();
    let sender = Cell::new(Some(sender));
    UNUserNotificationCenter::currentNotificationCenter()
        .requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &RcBlock::new(move |granted: Bool, error: *mut NSError| {
                let Some(sender) = sender.take() else {
                    return;
                };
                let result = NonNull::new(error)
                    .map(|error| unsafe { error.as_ref() }.localizedDescription().to_string())
                    .map_or_else(|| Ok(granted.as_bool()), Err);
                let _ = sender.send(result);
            }),
        );
    receiver
        .await
        .map_err(|_| "Notification permission request was cancelled".to_string())?
}

pub(crate) fn show(
    title: String,
    body: String,
    target: InboxNotificationTarget,
) -> Result<(), String> {
    let identifier = notification_id(&target)?;
    let content = UNMutableNotificationContent::new();
    content.setTitle(&NSString::from_str(&title));
    content.setBody(&NSString::from_str(&body));
    content.setThreadIdentifier(&NSString::from_str("briar-inbox"));
    let request = UNNotificationRequest::requestWithIdentifier_content_trigger(
        &NSString::from_str(&identifier),
        &content,
        None,
    );

    UNUserNotificationCenter::currentNotificationCenter()
        .addNotificationRequest_withCompletionHandler(
            &request,
            Some(&RcBlock::new(move |error: *mut NSError| {
                if let Some(error) = NonNull::new(error) {
                    eprintln!(
                        "Inbox notification failed: {}",
                        unsafe { error.as_ref() }.localizedDescription()
                    );
                }
            })),
        );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target() -> InboxNotificationTarget {
        InboxNotificationTarget {
            message_id: "issue:run-1".to_string(),
            project_id: "project-1".to_string(),
            target_id: "run-1".to_string(),
            kind: "issue".to_string(),
        }
    }

    #[test]
    fn round_trips_the_target_through_the_notification_identifier() {
        let target = target();
        let identifier = notification_id(&target).expect("notification identifier");
        assert_eq!(target_from_notification_id(&identifier), Some(target));
    }

    #[test]
    fn ignores_unrelated_and_malformed_notification_identifiers() {
        assert_eq!(target_from_notification_id("another-app:v1:value"), None);
        assert_eq!(
            target_from_notification_id("briar-inbox:v1:not-base64"),
            None
        );
    }
}
