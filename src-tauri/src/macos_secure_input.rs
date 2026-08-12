//! Keeps WKWebView's Secure Event Input ownership scoped to Briar's focus.
//!
//! WebKit owns the balanced Carbon enable/disable calls. We only drive the
//! public AppKit first-responder lifecycle that WebKit itself observes. The
//! frontend reports a conservative, Briar-local witness when its password
//! editor receives focus; Carbon's process-global flag is never used as an
//! ownership signal.

use objc2_app_kit::{NSResponder, NSView, NSWindow};
use std::sync::{Arc, Mutex, MutexGuard};
use tauri::{Manager, Runtime};

#[derive(Clone)]
pub(crate) struct SecureInputState(Arc<Mutex<FocusState>>);

#[derive(Clone, Debug, PartialEq, Eq)]
struct EditorWitness {
    generation: u64,
    webview_label: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum ResponderState {
    Normal,
    ReleasePending(EditorWitness),
    ReleaseInFlight(EditorWitness),
    Released {
        webview_label: String,
    },
    RestorePending {
        generation: u64,
        webview_label: String,
    },
    RestoreInFlight {
        generation: u64,
        webview_label: String,
    },
}

#[derive(Debug)]
struct FocusState {
    next_generation: u64,
    window_focused: bool,
    editor_witness: Option<EditorWitness>,
    responder: ResponderState,
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum FocusAction {
    None,
    Release(EditorWitness),
    Restore {
        generation: u64,
        webview_label: String,
    },
}

#[derive(Debug, PartialEq, Eq)]
enum ReleaseResult {
    Released,
    OwnershipTransferred,
    RefusedWhileOwned,
}

#[derive(Debug, PartialEq, Eq)]
enum RestoreResult {
    Restored,
    OwnershipTransferred,
    RefusedWhileOwned,
}

impl Default for SecureInputState {
    fn default() -> Self {
        Self(Arc::new(Mutex::new(FocusState {
            next_generation: 0,
            window_focused: true,
            editor_witness: None,
            responder: ResponderState::Normal,
        })))
    }
}

impl SecureInputState {
    fn lock(&self) -> MutexGuard<'_, FocusState> {
        self.0
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    fn arm_editor(&self, webview_label: String) -> FocusAction {
        let mut state = self.lock();
        state.next_generation = state.next_generation.wrapping_add(1);
        let witness = EditorWitness {
            generation: state.next_generation,
            webview_label,
        };

        if state.window_focused
            && matches!(
                state.responder,
                ResponderState::Released { .. }
                    | ResponderState::RestorePending { .. }
                    | ResponderState::RestoreInFlight { .. }
            )
        {
            // A real DOM focus event proves AppKit focus reached this webview,
            // even if a prior automatic restore was refused or superseded.
            state.responder = ResponderState::Normal;
        }

        match &state.responder {
            ResponderState::Released { .. }
            | ResponderState::RestorePending { .. }
            | ResponderState::RestoreInFlight { .. }
                if !state.window_focused =>
            {
                // Our responder break is still installed, so a delayed arm
                // cannot represent a live password editor.
                state.editor_witness = None;
                FocusAction::None
            }
            _ => {
                state.editor_witness = Some(witness.clone());
                state.release_action_if_needed()
            }
        }
    }

    fn set_window_focused(&self, focused: bool) -> FocusAction {
        let mut state = self.lock();
        state.window_focused = focused;

        if focused {
            match state.responder.clone() {
                ResponderState::Released { webview_label } => {
                    state.next_generation = state.next_generation.wrapping_add(1);
                    let generation = state.next_generation;
                    state.responder = ResponderState::RestorePending {
                        generation,
                        webview_label: webview_label.clone(),
                    };
                    FocusAction::Restore {
                        generation,
                        webview_label,
                    }
                }
                ResponderState::ReleasePending(_) => {
                    // Invalidate a queued release. The conservative witness is
                    // retained for the next real deactivation edge.
                    state.responder = ResponderState::Normal;
                    FocusAction::None
                }
                ResponderState::ReleaseInFlight(_)
                | ResponderState::Normal
                | ResponderState::RestorePending { .. }
                | ResponderState::RestoreInFlight { .. } => FocusAction::None,
            }
        } else {
            if let ResponderState::RestorePending { webview_label, .. } = &state.responder {
                state.responder = ResponderState::Released {
                    webview_label: webview_label.clone(),
                };
                return FocusAction::None;
            }
            if let ResponderState::RestoreInFlight { webview_label, .. } = &state.responder {
                state.responder = ResponderState::Released {
                    webview_label: webview_label.clone(),
                };
                return FocusAction::None;
            }
            state.release_action_if_needed()
        }
    }

    fn finish_release(&self, witness: &EditorWitness, result: ReleaseResult) -> FocusAction {
        let mut state = self.lock();
        if !matches!(
            &state.responder,
            ResponderState::ReleaseInFlight(current) if current == witness
        ) {
            return FocusAction::None;
        }

        match result {
            ReleaseResult::Released => {
                state.editor_witness = None;
                if state.window_focused {
                    state.next_generation = state.next_generation.wrapping_add(1);
                    let generation = state.next_generation;
                    state.responder = ResponderState::RestorePending {
                        generation,
                        webview_label: witness.webview_label.clone(),
                    };
                    FocusAction::Restore {
                        generation,
                        webview_label: witness.webview_label.clone(),
                    }
                } else {
                    state.responder = ResponderState::Released {
                        webview_label: witness.webview_label.clone(),
                    };
                    FocusAction::None
                }
            }
            ReleaseResult::OwnershipTransferred => {
                state.editor_witness = None;
                state.responder = ResponderState::Normal;
                FocusAction::None
            }
            ReleaseResult::RefusedWhileOwned => {
                // Retain the conservative witness for a later deactivation.
                state.responder = ResponderState::Normal;
                FocusAction::None
            }
        }
    }

    fn finish_restore(&self, generation: u64, result: RestoreResult) {
        let mut state = self.lock();
        let webview_label = match &state.responder {
            ResponderState::RestoreInFlight {
                generation: pending_generation,
                webview_label,
            } if *pending_generation == generation => webview_label.clone(),
            ResponderState::Released { webview_label } if !state.window_focused => {
                webview_label.clone()
            }
            _ => return,
        };

        if !state.window_focused {
            state.responder = ResponderState::Released { webview_label };
            return;
        }

        state.responder = match result {
            RestoreResult::Restored | RestoreResult::OwnershipTransferred => ResponderState::Normal,
            RestoreResult::RefusedWhileOwned => ResponderState::Released { webview_label },
        };
    }

    #[cfg(test)]
    fn action_is_current(&self, action: &FocusAction) -> bool {
        let state = self.lock();
        match action {
            FocusAction::None => true,
            FocusAction::Release(witness) => {
                !state.window_focused
                    && matches!(
                        &state.responder,
                        ResponderState::ReleasePending(current)
                            | ResponderState::ReleaseInFlight(current)
                            if current == witness
                    )
            }
            FocusAction::Restore {
                generation,
                webview_label,
            } => {
                state.window_focused
                    && matches!(
                        &state.responder,
                        ResponderState::RestorePending {
                            generation: current_generation,
                            webview_label: current_label,
                        } | ResponderState::RestoreInFlight {
                            generation: current_generation,
                            webview_label: current_label,
                        } if current_generation == generation && current_label == webview_label
                    )
            }
        }
    }

    fn begin_action(&self, action: &FocusAction) -> bool {
        let mut state = self.lock();
        match action {
            FocusAction::None => true,
            FocusAction::Release(witness) => {
                if state.window_focused
                    || state.responder != ResponderState::ReleasePending(witness.clone())
                {
                    return false;
                }
                state.responder = ResponderState::ReleaseInFlight(witness.clone());
                true
            }
            FocusAction::Restore {
                generation,
                webview_label,
            } => {
                if !state.window_focused
                    || state.responder
                        != (ResponderState::RestorePending {
                            generation: *generation,
                            webview_label: webview_label.clone(),
                        })
                {
                    return false;
                }
                state.responder = ResponderState::RestoreInFlight {
                    generation: *generation,
                    webview_label: webview_label.clone(),
                };
                true
            }
        }
    }

    fn cancel_pending(&self, action: &FocusAction) {
        let mut state = self.lock();
        match action {
            FocusAction::None => {}
            FocusAction::Release(witness)
                if state.responder == ResponderState::ReleasePending(witness.clone()) =>
            {
                // Retain the witness so a later deactivation can retry.
                state.responder = ResponderState::Normal;
            }
            FocusAction::Restore {
                generation,
                webview_label,
            } if state.responder
                == (ResponderState::RestorePending {
                    generation: *generation,
                    webview_label: webview_label.clone(),
                }) =>
            {
                state.responder = ResponderState::Released {
                    webview_label: webview_label.clone(),
                };
            }
            FocusAction::Release(_) | FocusAction::Restore { .. } => {}
        }
    }
}

impl FocusState {
    fn release_action_if_needed(&mut self) -> FocusAction {
        if self.window_focused || self.responder != ResponderState::Normal {
            return FocusAction::None;
        }
        let Some(witness) = self.editor_witness.clone() else {
            return FocusAction::None;
        };
        self.responder = ResponderState::ReleasePending(witness.clone());
        FocusAction::Release(witness)
    }
}

pub(crate) fn arm_password_editor<R: Runtime>(webview: &tauri::Webview<R>) {
    let state = webview.state::<SecureInputState>().inner().clone();
    let action = state.arm_editor(webview.label().to_owned());
    dispatch_webview_action(webview, state, action);
}

pub(crate) fn handle_focus_changed<R: Runtime>(window: &tauri::Window<R>, focused: bool) {
    let state = window.state::<SecureInputState>().inner().clone();
    let action = state.set_window_focused(focused);
    let label = match &action {
        FocusAction::Release(witness) => witness.webview_label.as_str(),
        FocusAction::Restore { webview_label, .. } => webview_label.as_str(),
        FocusAction::None => return,
    };
    let Some(webview) = window
        .webviews()
        .into_iter()
        .find(|webview| webview.label() == label)
    else {
        state.cancel_pending(&action);
        return;
    };
    dispatch_webview_action(&webview, state, action);
}

fn dispatch_webview_action<R: Runtime>(
    webview: &tauri::Webview<R>,
    state: SecureInputState,
    action: FocusAction,
) {
    match action.clone() {
        FocusAction::None => {}
        FocusAction::Release(witness) => {
            let callback_state = state.clone();
            let callback_webview = webview.clone();
            if webview
                .with_webview(move |platform_webview| {
                    if !callback_state.begin_action(&FocusAction::Release(witness.clone())) {
                        return;
                    }
                    // SAFETY: Tauri runs this closure on the main thread with
                    // live WKWebView and NSWindow handles.
                    let result = unsafe { release_owned_first_responder(&platform_webview) };
                    let follow_up = callback_state.finish_release(&witness, result);
                    dispatch_webview_action(&callback_webview, callback_state, follow_up);
                })
                .is_err()
            {
                state.cancel_pending(&action);
            }
        }
        FocusAction::Restore {
            generation,
            webview_label,
        } => {
            let callback_state = state.clone();
            if webview
                .with_webview(move |platform_webview| {
                    if !callback_state.begin_action(&FocusAction::Restore {
                        generation,
                        webview_label: webview_label.clone(),
                    }) {
                        return;
                    }
                    // SAFETY: Same main-thread and live-handle guarantees.
                    let result = unsafe { restore_webview_first_responder(&platform_webview) };
                    callback_state.finish_restore(generation, result);
                })
                .is_err()
            {
                state.cancel_pending(&action);
            }
        }
    }
}

unsafe fn release_owned_first_responder(
    webview: &tauri::webview::PlatformWebview,
) -> ReleaseResult {
    // SAFETY: The caller upholds the concrete AppKit types and main-thread rule.
    let window = unsafe { &*webview.ns_window().cast::<NSWindow>() };
    // Tauri exposes the outer WKWebView while AppKit can install one of its
    // private content views as first responder. Bound the fallback to that
    // view subtree so a sheet or unrelated native control is never disturbed.
    // SAFETY: WKWebView inherits from NSView.
    let webview_view = unsafe { &*webview.inner().cast::<NSView>() };
    let webview_owns_responder = window
        .firstResponder()
        .as_deref()
        .and_then(|responder| responder.downcast_ref::<NSView>())
        .is_some_and(|responder_view| {
            std::ptr::eq(responder_view, webview_view)
                || responder_view.isDescendantOf(webview_view)
        });
    if !webview_owns_responder {
        return ReleaseResult::OwnershipTransferred;
    }
    if window.makeFirstResponder(None) {
        ReleaseResult::Released
    } else {
        ReleaseResult::RefusedWhileOwned
    }
}

unsafe fn restore_webview_first_responder(
    webview: &tauri::webview::PlatformWebview,
) -> RestoreResult {
    // SAFETY: The caller upholds the concrete AppKit types and main-thread rule.
    let window = unsafe { &*webview.ns_window().cast::<NSWindow>() };
    // SAFETY: WKWebView inherits from NSResponder.
    let responder = unsafe { &*webview.inner().cast::<NSResponder>() };
    let window_responder = window as *const NSWindow as *const NSResponder;
    let owns_current_responder = window
        .firstResponder()
        .as_deref()
        .is_some_and(|current| std::ptr::eq(current, window_responder));
    if !owns_current_responder {
        return RestoreResult::OwnershipTransferred;
    }
    if window.makeFirstResponder(Some(responder)) {
        RestoreResult::Restored
    } else {
        RestoreResult::RefusedWhileOwned
    }
}

#[cfg(test)]
mod tests {
    use super::{FocusAction, SecureInputState};

    #[test]
    fn deactivation_after_arm_requests_release() {
        let state = SecureInputState::default();
        assert_eq!(state.arm_editor("main".into()), FocusAction::None);

        let action @ FocusAction::Release(_) = state.set_window_focused(false) else {
            panic!("an armed editor must be released on deactivation");
        };
        assert!(state.action_is_current(&action));
    }

    #[test]
    fn arm_after_deactivation_also_requests_release() {
        let state = SecureInputState::default();
        assert_eq!(state.set_window_focused(false), FocusAction::None);

        let action @ FocusAction::Release(_) = state.arm_editor("main".into()) else {
            panic!("a late arm must observe the inactive window");
        };
        assert!(state.action_is_current(&action));
    }

    #[test]
    fn reactivation_invalidates_a_queued_release() {
        let state = SecureInputState::default();
        state.arm_editor("main".into());
        let action @ FocusAction::Release(_) = state.set_window_focused(false) else {
            unreachable!();
        };

        assert_eq!(state.set_window_focused(true), FocusAction::None);
        assert!(!state.action_is_current(&action));

        let next @ FocusAction::Release(_) = state.set_window_focused(false) else {
            panic!("the conservative witness must survive cancellation");
        };
        assert!(state.action_is_current(&next));
    }

    #[test]
    fn a_release_completed_after_reactivation_requests_restore() {
        let state = SecureInputState::default();
        state.arm_editor("main".into());
        let FocusAction::Release(witness) = state.set_window_focused(false) else {
            unreachable!();
        };

        assert!(state.begin_action(&FocusAction::Release(witness.clone())));
        // Model the main-thread AppKit call completing after focus came back:
        // the in-flight token still owns the responder transition.
        assert_eq!(state.set_window_focused(true), FocusAction::None);
        let action @ FocusAction::Restore { .. } =
            state.finish_release(&witness, super::ReleaseResult::Released)
        else {
            panic!("a late successful release must be restored");
        };
        assert!(state.action_is_current(&action));
    }

    #[test]
    fn deactivation_during_restore_keeps_the_responder_break_owned() {
        let state = SecureInputState::default();
        state.arm_editor("main".into());
        let FocusAction::Release(witness) = state.set_window_focused(false) else {
            unreachable!();
        };
        assert!(state.begin_action(&FocusAction::Release(witness.clone())));
        let _ = state.finish_release(&witness, super::ReleaseResult::Released);

        let action @ FocusAction::Restore { generation, .. } = state.set_window_focused(true)
        else {
            unreachable!();
        };
        assert!(state.begin_action(&action));
        assert_eq!(state.set_window_focused(false), FocusAction::None);
        state.finish_restore(generation, super::RestoreResult::OwnershipTransferred);

        let FocusAction::Restore { .. } = state.set_window_focused(true) else {
            panic!("a cancelled restore must remain owned for the next activation");
        };
    }

    #[test]
    fn scheduling_failure_cancels_only_the_matching_pending_action() {
        let state = SecureInputState::default();
        state.arm_editor("main".into());
        let action @ FocusAction::Release(_) = state.set_window_focused(false) else {
            unreachable!();
        };

        state.cancel_pending(&action);
        let retry @ FocusAction::Release(_) = state.set_window_focused(false) else {
            panic!("the witness must remain retryable");
        };
        assert!(state.action_is_current(&retry));
    }

    #[test]
    fn a_real_editor_focus_recovers_from_a_refused_restore() {
        let state = SecureInputState::default();
        state.arm_editor("main".into());
        let FocusAction::Release(witness) = state.set_window_focused(false) else {
            unreachable!();
        };
        assert!(state.begin_action(&FocusAction::Release(witness.clone())));
        let _ = state.finish_release(&witness, super::ReleaseResult::Released);
        let action @ FocusAction::Restore { generation, .. } = state.set_window_focused(true)
        else {
            unreachable!();
        };
        assert!(state.begin_action(&action));
        state.finish_restore(generation, super::RestoreResult::RefusedWhileOwned);

        assert_eq!(state.arm_editor("main".into()), FocusAction::None);
        let FocusAction::Release(_) = state.set_window_focused(false) else {
            panic!("new editor focus must make later deactivation releasable");
        };
    }
}
