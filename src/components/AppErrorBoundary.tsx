import { Component, type ErrorInfo, type ReactNode } from "react";
import { I18nContext } from "../i18n";

type Props = { children: ReactNode };
type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Briar UI rendering failed", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return <I18nContext.Consumer>{({ t }) => (
      <main style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: 32 }}>
          <section style={{ maxWidth: 520 }}>
            <p>BRIAR UI ERROR</p>
            <h1>{t("error.title")}</h1>
            <p>{this.state.error?.message}</p>
            <button type="button" onClick={() => window.location.reload()}>{t("error.reload")}</button>
          </section>
        </main>
    )}</I18nContext.Consumer>;
  }
}
