export type AgentBrowserStatus = {
  supported: boolean;
  installed: boolean;
  browserReady: boolean;
  version: string | null;
};

const isTauri = () =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function inspectAgentBrowser(): Promise<AgentBrowserStatus> {
  if (!isTauri()) {
    return {
      supported: false,
      installed: false,
      browserReady: false,
      version: null,
    };
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentBrowserStatus>("inspect_agent_browser");
}

export async function installAgentBrowser(): Promise<AgentBrowserStatus> {
  if (!isTauri()) {
    throw new Error(
      "agent-browser installation is available in the Briar desktop app.",
    );
  }
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<AgentBrowserStatus>("install_agent_browser");
}
