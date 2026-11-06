import { describe, expect, it } from "vitest";
import { keyboardLikelyOpen } from "../../components/game/useViewport";

describe("compact keyboard layout", () => {
  it("recognises an iPhone-sized visual viewport above an open keyboard", () => {
    expect(keyboardLikelyOpen(760, 420, true)).toBe(true);
  });
  it("also compacts when Android resizes both viewports", () => {
    expect(keyboardLikelyOpen(380, 380, true)).toBe(true);
  });
  it("does not mistake a short unfocused page or a regular desktop for a keyboard", () => {
    expect(keyboardLikelyOpen(400, 400, false)).toBe(false);
    expect(keyboardLikelyOpen(800, 800, true)).toBe(false);
  });
  it("leaves pinch zoom free to pan instead of treating it as a keyboard", () => {
    expect(keyboardLikelyOpen(760, 350, true, true)).toBe(false);
  });
});
