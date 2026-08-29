import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
import {
  htmlArtifactPreviewMaxBytes,
  htmlArtifactPreviewMessageType,
  htmlArtifactPreviewPath,
} from "../../src/lib/html-artifact-preview-contract";
import {
  handlePublicRoute,
  htmlArtifactPreviewDocument,
} from "./public-routes";

const requestShell = (method = "GET") =>
  handlePublicRoute({
    request: new Request(`https://api.example.com${htmlArtifactPreviewPath}`, {
      method,
    }),
    env: {} as Env,
  });

const renderMessage = (html: string) => ({
  type: htmlArtifactPreviewMessageType.render,
  version: 1,
  html,
});

function executableShell() {
  const script = /<script>([\s\S]*)<\/script>/u.exec(
    htmlArtifactPreviewDocument,
  )?.[1];
  if (!script) throw new Error("Preview shell script is missing");
  const postMessage = vi.fn();
  const host = { postMessage };
  type ShellEvent = { data: unknown; source: unknown };
  let listener: ((event: ShellEvent) => void) | undefined;
  const window = {
    parent: host,
    addEventListener(_type: string, nextListener: (event: ShellEvent) => void) {
      listener = nextListener;
    },
    removeEventListener(
      _type: string,
      removedListener: (event: ShellEvent) => void,
    ) {
      if (listener === removedListener) listener = undefined;
    },
  };
  const document = {
    close: vi.fn(),
    open: vi.fn(),
    write: vi.fn(),
  };
  runInNewContext(script, {
    TextEncoder,
    document,
    globalThis: {},
    window,
  });
  const dispatch = (data: unknown, source: unknown = host) => {
    listener?.({ data, source });
  };
  return { dispatch, document, postMessage };
}

describe("HTML artifact preview shell", () => {
  it("serves a data-free one-shot handshake under a restrictive policy", async () => {
    const response = await requestShell();
    expect(response?.status).toBe(200);
    const body = await response!.text();
    expect(body).toContain(htmlArtifactPreviewMessageType.ready);
    expect(body).toContain(htmlArtifactPreviewMessageType.render);
    expect(body).toContain(`const maxBytes=${htmlArtifactPreviewMaxBytes}`);
    expect(body).toContain("accepted=true");
    expect(body).toContain('window.removeEventListener("message",receive)');
    expect(body).not.toContain("Authorization");

    const policy = response!.headers.get("Content-Security-Policy") ?? "";
    for (const directive of [
      "sandbox allow-scripts",
      "default-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "worker-src 'none'",
      "object-src 'none'",
      "form-action 'none'",
    ]) {
      expect(policy).toContain(directive);
    }
    expect(response!.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response!.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("supports HEAD without exposing data and rejects mutating methods", async () => {
    const head = await requestShell("HEAD");
    expect(await head!.text()).toBe("");
    expect(head!.headers.get("Content-Security-Policy")).toContain(
      "default-src 'none'",
    );
    expect(await requestShell("POST")).toBeUndefined();
  });

  it("ignores malformed senders and renders the first valid payload only", () => {
    const shell = executableShell();
    shell.dispatch(renderMessage("<p>wrong source</p>"), {});
    shell.dispatch({ ...renderMessage("<p>wrong version</p>"), version: 2 });
    shell.dispatch({ type: "unknown", version: 1 });
    expect(shell.document.write).not.toHaveBeenCalled();

    shell.dispatch(renderMessage("<button id='first'>Interactive</button>"));
    expect(shell.document.write).toHaveBeenCalledOnce();
    expect(shell.document.write).toHaveBeenCalledWith(
      "<button id='first'>Interactive</button>",
    );
    expect(shell.postMessage).toHaveBeenCalledWith({
      type: htmlArtifactPreviewMessageType.rendered,
      version: 1,
    }, "*");

    shell.dispatch(renderMessage("<p id='second'>Second payload</p>"));
    expect(shell.document.write).toHaveBeenCalledOnce();
  });

  it("rejects an oversized payload permanently without writing it", () => {
    const shell = executableShell();
    shell.dispatch(renderMessage("x".repeat(htmlArtifactPreviewMaxBytes + 1)));
    expect(shell.postMessage).toHaveBeenCalledWith({
      type: htmlArtifactPreviewMessageType.error,
      version: 1,
    }, "*");
    expect(shell.document.write).not.toHaveBeenCalled();

    shell.dispatch(renderMessage("<p id='after-error'>Must stay rejected</p>"));
    expect(shell.document.write).not.toHaveBeenCalled();
  });
});
