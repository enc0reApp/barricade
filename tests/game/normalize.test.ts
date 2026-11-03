import { describe, expect, it } from "vitest";
import { matchKeys, NORMALIZE_VERSION, normalize, primaryKey } from "../../lib/game/normalize";

describe("normalize — '!'", () => {
  it("drops a '!' that ends a word (v2)", () => {
    expect(NORMALIZE_VERSION).toBe(2);
    expect(normalize("Wham!")).toBe("wham");
    expect(normalize("Splash!")).toBe("splash");
    expect(normalize("Shindig!")).toBe("shindig");
    expect(normalize("Panic! at the Disco")).toBe("panic at the disco");
    expect(normalize("Go!! Show")).toBe("go show");
    expect(normalize("Wham!, live")).toBe("wham live");
    expect(normalize("!!!")).toBe("");
    expect(primaryKey("Splash!")).toBe(primaryKey("Splash"));
    expect(matchKeys("Shindig!")).toEqual(matchKeys("Shindig"));
  });

  it("keeps a '!' inside a word as an 'i' (P!nk)", () => {
    expect(normalize("P!nk")).toBe("pink");
    expect(normalize("A$AP Rocky")).toBe("asap rocky");
    expect(primaryKey("P!nk")).toBe("pink");
  });
});
