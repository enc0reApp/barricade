/**
 * Layout and contrast rules that fixed real defects on phones. These read the
 * CSS directly (no browser here), so they pin the specific declarations that
 * carry each fix; docs/screenshots show the result.
 */

import { describe, expect, it } from "vitest";
import { contrast, declsFor, hexToRgb, over, readCss } from "./css";

describe("game frame with the keyboard up (C23)", () => {
  const game = readCss("components/game/Game.module.css");
  const dock = readCss("components/game/InputDock.module.css");
  const hud = readCss("components/game/Hud.module.css");
  const card = readCss("components/game/PromptCard.module.css");

  it("the card slot is the part that shrinks, and scrolls instead of pushing the dock out", () => {
    const slot = declsFor(game, ".cardSlot");
    expect(slot.get("min-height")).toBe("0");
    expect(slot.get("overflow-y")).toBe("auto");
    expect(slot.get("flex")).toBe("0 1 auto");
  });

  it("the HUD, feedback line, dock and KEEP button never shrink", () => {
    expect(declsFor(hud, ".hud").get("flex-shrink")).toBe("0");
    expect(declsFor(dock, ".dock").get("flex-shrink")).toBe("0");
    expect(declsFor(dock, ".feedback").get("flex-shrink")).toBe("0");
    expect(declsFor(game, ".keep").get("flex-shrink")).toBe("0");
  });

  it("the prompt card compacts while the frame says the keyboard is open", () => {
    expect(declsFor(card, "[data-kb] .card").get("padding")).toBeDefined();
    expect(declsFor(card, "[data-kb] .foot").get("display")).toBe("none");
    // The hint carries round rules ("Not speaker brands."): it must stay.
    expect(declsFor(card, "[data-kb] .hint").get("display")).toBeUndefined();
  });
});

describe("reveal: the hidden dock leaves the flow (C24)", () => {
  const game = readCss("components/game/Game.module.css");
  const dock = readCss("components/game/InputDock.module.css");

  it("a hidden dock is absolutely positioned but still rendered (so it can take focus)", () => {
    const hidden = declsFor(dock, ".dock[data-hidden]");
    expect(hidden.get("position")).toBe("absolute");
    expect(hidden.get("bottom")).toBe("0");
    expect(hidden.has("display")).toBe(false);
    expect(hidden.has("visibility")).toBe(false);
  });

  it("the reveal slot and ruler clear the KEEP button including the home-indicator inset", () => {
    expect(declsFor(game, ".revealSlot").get("bottom")).toBe("calc(118px + var(--safe-bottom))");
    expect(declsFor(game, '.frame[data-phase="reveal"]').get("--ruler-bottom")).toBe("calc(118px + var(--safe-bottom))");
  });
});

describe("crowd-surf plaque stays on screen (C27)", () => {
  const css = readCss("components/game/CrowdSurfReveal.module.css");

  it("the carry spans the track and the plaque can't outgrow it", () => {
    const carry = declsFor(css, ".carry");
    expect(carry.get("left")).toBe("50%");
    expect(carry.get("width")).toBe("100%");
    expect(declsFor(css, ".plaque").get("max-width")).toBe("100%");
    const name = declsFor(css, ".plaqueName");
    expect(name.get("min-width")).toBe("0");
    expect(name.get("text-overflow")).toBe("ellipsis");
  });
});

describe("long single-word answers wrap inside the card (C28)", () => {
  it("TierCard and YourSet answers use overflow-wrap: anywhere (break-word doesn't lower min-content)", () => {
    expect(declsFor(readCss("components/game/TierCard.module.css"), ".answer").get("overflow-wrap")).toBe("anywhere");
    expect(declsFor(readCss("components/game/YourSet.module.css"), ".answer").get("overflow-wrap")).toBe("anywhere");
  });
});

describe("PUSH TO THE FRONT fits narrow phones (C29)", () => {
  it("Doors CTA steps down below 420px and keeps its desktop size above", () => {
    const css = readCss("components/game/Doors.module.css");
    expect(declsFor(css, ".cta").get("font-size")).toBe("19px");
    const narrow = declsFor(css, ".cta", "max-width: 419px");
    expect(narrow.get("font-size")).toMatch(/^clamp\(/);
    expect(narrow.get("letter-spacing")).toBe("0.16em");
  });

  it("the shared big button does the same (the /how CTA has no module class) and centres safely", () => {
    const css = readCss("app/globals.css");
    expect(declsFor(css, ".px-btn--big").get("font-size")).toBe("18px");
    expect(declsFor(css, ".px-btn--big", "max-width: 419px").get("letter-spacing")).toBe("0.16em");
    expect(declsFor(css, ".px-btn").get("justify-content")).toBe("safe center");
  });
});

describe("ARCHIVE · NOT SCORED stamp contrast (C31)", () => {
  it("is at least 4.5:1 on the ticket paper, including the darker texture stripes", () => {
    const stamp = declsFor(readCss("components/game/Ticket.module.css"), ".stamp");
    const opacity = Number(stamp.get("opacity") ?? "1");
    const ink = hexToRgb(stamp.get("color")!);
    const paperHex = declsFor(readCss("app/globals.css"), ":root").get("--paper")!;
    const paper = hexToRgb(paperHex);
    const stripe = over(hexToRgb("#0b0d17"), 0.018, paper);
    expect(contrast(over(ink, opacity, paper), paper)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(over(ink, opacity, stripe), stripe)).toBeGreaterThanOrEqual(4.5);
  });
});

describe("share page secondary link is a real tap target (C32)", () => {
  it("is at least 44px tall", () => {
    const sec = declsFor(readCss("app/s/[code]/page.module.css"), ".secondary");
    expect(parseInt(sec.get("min-height") ?? "0", 10)).toBeGreaterThanOrEqual(44);
    expect(sec.get("display")).toMatch(/flex/);
  });
});

describe("share ticket stub reads ADMIT ONE", () => {
  it("letters and the gap never shrink", () => {
    const css = readCss("components/share/ShareTicket.module.css");
    expect(declsFor(css, ".admit > span").get("flex")).toBe("none");
    expect(declsFor(css, ".admitGap").get("white-space")).toBe("pre");
  });
});

describe("Morning After tier label style (C30)", () => {
  it("the visible per-row tier label is styled in the tier colour", () => {
    const tier = declsFor(readCss("components/crowd/CrowdView.module.css"), ".ansTier");
    expect(tier.get("color")).toBe("var(--c)");
    expect(tier.get("grid-row")).toBe("2");
  });
});
