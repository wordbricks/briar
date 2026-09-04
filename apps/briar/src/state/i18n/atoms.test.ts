import { describe, expect, it } from "vitest";

import { en } from "../../i18n/messages/en";
import { ko } from "../../i18n/messages";
import { createTestRegistry } from "../registry";
import {
  localeAtom,
  localeTagAtom,
  publishLocaleCatalog,
  translatorAtom,
} from "./atoms";

/*
  The locale where registry-bound code can read it. What has to hold is that the
  translator is the same one views get — same interpolation, same Korean
  fallback — and that a locale that has not moved notifies nobody.
*/

describe("state/i18n atoms", () => {
  it("starts on the default locale and its catalog", () => {
    const registry = createTestRegistry();

    expect(registry.get(localeAtom)).toBe("ko");
    expect(registry.get(localeTagAtom)).toBe("ko-KR");
    expect(registry.get(translatorAtom)("statusTray.running")).toBe(ko["statusTray.running"]);
  });

  it("follows the catalog the provider publishes", () => {
    const registry = createTestRegistry();

    publishLocaleCatalog(registry, { locale: "en", messages: en });

    expect(registry.get(localeAtom)).toBe("en");
    expect(registry.get(localeTagAtom)).toBe("en-US");
    expect(registry.get(translatorAtom)("statusTray.running")).toBe("Running");
  });

  it("interpolates variables and falls back to Korean for a missing key", () => {
    const registry = createTestRegistry();
    // A catalog missing the key the caller asks for, which is what a partially
    // translated locale looks like.
    publishLocaleCatalog(registry, {
      locale: "en",
      messages: { ...en, "myIssues.count": undefined as never },
    });

    const t = registry.get(translatorAtom);
    expect(t("myIssues.count", { count: 2 })).toBe(
      ko["myIssues.count"].replace("{count}", "2"),
    );
  });

  it("notifies nobody when the published catalog has not moved", () => {
    const registry = createTestRegistry();
    publishLocaleCatalog(registry, { locale: "en", messages: en });
    const before = registry.get(translatorAtom);

    let notifications = -1;
    const unsubscribe = registry.subscribe(
      translatorAtom,
      () => {
        notifications += 1;
      },
      { immediate: true },
    );
    publishLocaleCatalog(registry, { locale: "en", messages: en });
    unsubscribe();

    expect(registry.get(translatorAtom)).toBe(before);
    expect(notifications).toBe(0);
  });
});
