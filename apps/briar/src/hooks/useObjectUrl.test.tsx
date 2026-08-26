/** @vitest-environment jsdom */

import { act } from "react";
import { createReactTestRoot, renderReactTestRoot } from "../test/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useObjectUrl, type ObjectUrlLoader } from "./useObjectUrl";

function Probe({ loader }: { loader: ObjectUrlLoader | null }) {
  const { failed, source } = useObjectUrl(loader);
  return <output data-failed={String(failed)} data-source={source ?? ""} />;
}

function deferredBlob() {
  let resolve: (blob: Blob) => void = () => undefined;
  let reject: (error: unknown) => void = () => undefined;
  const promise = new Promise<Blob>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

describe("useObjectUrl", () => {
  beforeEach(() => {
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:preview"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
  });

  it("creates a URL for a synchronous Blob and revokes it on unmount", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const blob = new Blob(["preview"]);

    await renderReactTestRoot(root, <Probe loader={() => blob} />);

    expect(container.querySelector("output")?.dataset).toMatchObject({
      failed: "false",
      source: "blob:preview",
    });
    expect(URL.createObjectURL).toHaveBeenCalledWith(blob);

    await cleanup();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
  });

  it("resets state and revokes the previous URL when the loader changes", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const next = deferredBlob();
    const firstLoader = () => new Blob(["first"]);
    const nextLoader = () => next.promise;

    await renderReactTestRoot(root, <Probe loader={firstLoader} />);
    await renderReactTestRoot(root, <Probe loader={nextLoader} />);

    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:preview");
    expect(container.querySelector("output")?.dataset).toMatchObject({
      failed: "false",
      source: "",
    });

    await act(async () => {
      next.resolve(new Blob(["next"]));
      await next.promise;
    });
    expect(container.querySelector("output")?.dataset.source).toBe(
      "blob:preview",
    );

    await cleanup();
  });

  it("ignores a stale promise after the loader changes", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const stale = deferredBlob();
    const current = deferredBlob();
    const staleLoader = () => stale.promise;
    const currentLoader = () => current.promise;

    await renderReactTestRoot(root, <Probe loader={staleLoader} />);
    await renderReactTestRoot(root, <Probe loader={currentLoader} />);
    await act(async () => {
      stale.resolve(new Blob(["stale"]));
      await stale.promise;
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();

    await act(async () => {
      current.resolve(new Blob(["current"]));
      await current.promise;
    });
    expect(URL.createObjectURL).toHaveBeenCalledOnce();
    expect(container.querySelector("output")?.dataset.source).toBe(
      "blob:preview",
    );

    await cleanup();
  });

  it("reports rejected, thrown, and URL creation failures", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const rejectedLoader = () => Promise.reject(new Error("load failed"));

    await act(async () => {
      root.render(<Probe loader={rejectedLoader} />);
      await Promise.resolve();
    });
    expect(container.querySelector("output")?.dataset.failed).toBe("true");

    const thrownLoader = () => {
      throw new Error("load failed");
    };
    await renderReactTestRoot(root, <Probe loader={thrownLoader} />);
    expect(container.querySelector("output")?.dataset.failed).toBe("true");

    vi.mocked(URL.createObjectURL).mockImplementationOnce(() => {
      throw new Error("URL unavailable");
    });
    const blobLoader = () => new Blob(["preview"]);
    await renderReactTestRoot(root, <Probe loader={blobLoader} />);
    expect(container.querySelector("output")?.dataset).toMatchObject({
      failed: "true",
      source: "",
    });

    await cleanup();
  });

  it("ignores a rejection after unmount and accepts a null loader", async () => {
    const { cleanup, container, root } = createReactTestRoot();
    const pending = deferredBlob();
    const loader = () => pending.promise;

    await renderReactTestRoot(root, <Probe loader={null} />);
    expect(container.querySelector("output")?.dataset).toMatchObject({
      failed: "false",
      source: "",
    });

    await renderReactTestRoot(root, <Probe loader={loader} />);
    await cleanup();
    await act(async () => {
      pending.reject(new Error("late failure"));
      await pending.promise.catch(() => undefined);
    });
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });
});
