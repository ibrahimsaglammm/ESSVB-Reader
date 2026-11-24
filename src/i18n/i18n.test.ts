import { describe, expect, it } from "vitest";
import { tr } from "./tr";
import { en } from "./en";
import { translate } from "./index";

describe("i18n dictionaries", () => {
  it("keeps exact key parity between Turkish and English", () => {
    const trKeys = Object.keys(tr).sort();
    const enKeys = Object.keys(en).sort();
    expect(enKeys).toEqual(trKeys);

    for (const key of trKeys) {
      expect(tr[key as keyof typeof tr].trim().length).toBeGreaterThan(0);
      expect(en[key as keyof typeof en].trim().length).toBeGreaterThan(0);
    }
  });

  it("interpolates placeholders cleanly", () => {
    expect(translate("tr", "versionBadge", { version: "0.1.0" })).toContain("0.1.0");
    expect(translate("en", "versionBadge", { version: "0.1.0" })).toContain("0.1.0");
  });
});
