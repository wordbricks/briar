import {
  Component,
  createRef,
  type CSSProperties,
  type FocusEvent,
  type InputHTMLAttributes,
} from "react";
import { flushSync } from "react-dom";
import { armMacPasswordEditor } from "../lib/macos-secure-input";
import { isMacDesktopTauri } from "../lib/platform";

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  /** True only while the input is visible, enabled, and allowed to receive text. */
  secureInputEligible: boolean;
};

type State = {
  /** A window deactivation is a hard boundary for the DOM password editor. */
  windowDisarmed: boolean;
};

/**
 * A semantic password input with an explicit WKWebView focus lifecycle on macOS.
 *
 * WebKit owns Secure Event Input's balanced Carbon calls. This component only
 * moves its password editor to a non-secure, accessibility-hidden state before
 * React disables, hides, or removes it. Losing the host window is treated as a
 * hard focus boundary: the declarative latch survives unrelated React renders,
 * unlike an imperative `input.type` mutation.
 */
export class MacSecurePasswordInput extends Component<Props, State> {
  state: State = { windowDisarmed: false };

  private readonly inputRef = createRef<HTMLInputElement>();
  private readonly managesMacSecureInput = isMacDesktopTauri();
  private mayBeArmed = false;

  componentDidMount() {
    if (!this.managesMacSecureInput) return;
    window.addEventListener("blur", this.handleWindowBlur);
    window.addEventListener("focus", this.handleWindowFocus);
  }

  getSnapshotBeforeUpdate(previous: Props) {
    if (
      this.managesMacSecureInput &&
      previous.secureInputEligible &&
      !this.props.secureInputEligible
    ) {
      this.disarmBeforeMutation();
    }
    return null;
  }

  componentDidUpdate() {
    // Required companion for getSnapshotBeforeUpdate; all work is deliberately
    // completed in the pre-mutation phase above.
  }

  componentWillUnmount() {
    if (!this.managesMacSecureInput) return;
    window.removeEventListener("blur", this.handleWindowBlur);
    window.removeEventListener("focus", this.handleWindowFocus);
    this.disarmBeforeMutation();
  }

  private disarmBeforeMutation() {
    const input = this.inputRef.current;
    if (!input) return;

    // Order matters: keep the token out of the accessibility tree before it
    // temporarily has text semantics. Native window deactivation is the hard
    // focus boundary; this pre-mutation path only makes the outgoing editor
    // non-secure before React disables, hides, or removes it.
    input.setAttribute("aria-hidden", "true");
    input.type = "text";
  }

  private handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    if (this.managesMacSecureInput && this.props.secureInputEligible) {
      this.mayBeArmed = true;
      armMacPasswordEditor();
    }
    this.props.onFocus?.(event);
  };

  private handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    // An ordinary field-to-field blur is WebKit's normal password lifecycle.
    // Keep semantic password and accessibility behavior intact.
    this.props.onBlur?.(event);
  };

  private handleWindowBlur = () => {
    const input = this.inputRef.current;
    if (!this.props.secureInputEligible || !this.mayBeArmed || !input) {
      return;
    }

    // Commit text + aria-hidden before blur relinquishes the DOM editor. This
    // deliberately gives up caret restoration at an application boundary.
    flushSync(() => this.setState({ windowDisarmed: true }));
    this.mayBeArmed = false;
    input.blur();
  };

  private handleWindowFocus = () => {
    if (!this.state.windowDisarmed) return;
    // Restore normal password and AX semantics while the field is unfocused.
    flushSync(() => this.setState({ windowDisarmed: false }));
  };

  render() {
    const { secureInputEligible, onBlur, onFocus, style, ...inputProps } =
      this.props;
    const disarmed =
      this.managesMacSecureInput &&
      (!secureInputEligible || this.state.windowDisarmed);
    const maskedStyle = this.managesMacSecureInput
      ? ({ ...style, WebkitTextSecurity: "disc" } as CSSProperties)
      : style;

    return (
      <input
        {...inputProps}
        ref={this.inputRef}
        aria-hidden={disarmed ? true : inputProps["aria-hidden"]}
        onBlur={this.handleBlur}
        onFocus={this.handleFocus}
        style={maskedStyle}
        type={disarmed ? "text" : "password"}
      />
    );
  }
}
