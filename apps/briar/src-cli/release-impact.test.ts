import { describe, expect, it } from "vitest";
import { releaseImpactReasons, type ReleaseChange } from "./release-impact";

function change(path: string, before = "before", after = "after"): ReleaseChange {
  return { path, before, after };
}

describe("release candidate impact gate", () => {
  it("skips ordinary application changes and release-only version bumps", () => {
    expect(
      releaseImpactReasons([
        change("apps/briar/src/App.tsx"),
        change(
          "package.json",
          '{"name":"briar","version":"1.0.0"}',
          '{"name":"briar","version":"1.0.1"}',
        ),
        change(
          "apps/briar/src-tauri/tauri.conf.json",
          '{"version":"1.0.0","bundle":{"active":true}}',
          '{"version":"1.0.1","bundle":{"active":true}}',
        ),
        change(
          "apps/briar/src-tauri/Cargo.toml",
          '[package]\nname = "briar"\nversion = "1.0.0"\n\n[dependencies]\nserde = "1"\n',
          '[package]\nname = "briar"\nversion = "1.0.1"\n\n[dependencies]\nserde = "1"\n',
        ),
        change(
          "apps/briar/src-tauri/Cargo.lock",
          '[[package]]\nname = "briar"\nversion = "1.0.0"\n',
          '[[package]]\nname = "briar"\nversion = "1.0.1"\n',
        ),
        change(
          "config/release.env",
          "BRIAR_PREVIOUS_VERSION=0.9.0\nBRIAR_RELEASE_CHANNEL=stable\n",
          "BRIAR_PREVIOUS_VERSION=1.0.0\nBRIAR_RELEASE_CHANNEL=stable\n",
        ),
      ]),
    ).toEqual([]);
  });

  it("runs for release pipeline, bundle, dependency, and config changes", () => {
    expect(
      releaseImpactReasons([
        change("scripts/release-macos-production.sh"),
        change("scripts/package-managed-runtime-release.sh"),
        change("apps/briar/package.json"),
        change("apps/briar/turbo.json"),
        change("apps/briar/src-tauri/icons/icon.icns"),
        change("turbo.json"),
        change(
          "package.json",
          '{"name":"briar","version":"1.0.0","scripts":{"build":"old"}}',
          '{"name":"briar","version":"1.0.1","scripts":{"build":"new"}}',
        ),
        change(
          "config/release.env",
          "BRIAR_PREVIOUS_VERSION=0.9.0\nBRIAR_RELEASE_CHANNEL=stable\n",
          "BRIAR_PREVIOUS_VERSION=1.0.0\nBRIAR_RELEASE_CHANNEL=rc\n",
        ),
      ]),
    ).toEqual([
      "apps/briar/package.json",
      "apps/briar/src-tauri/icons/icon.icns",
      "apps/briar/turbo.json",
      "config/release.env",
      "package.json",
      "scripts/package-managed-runtime-release.sh",
      "scripts/release-macos-production.sh",
      "turbo.json",
    ]);
  });

  it("fails closed when a normalized release file cannot be parsed", () => {
    expect(releaseImpactReasons([change("package.json", "{}", "not json")])).toEqual([
      "package.json",
    ]);
  });
});
