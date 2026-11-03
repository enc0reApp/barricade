/**
 * Accessibility markup of the game components, rendered to static HTML (the
 * test environment is node; there is no DOM). Each block pins one fix.
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { AcceptedAnswer, RoundPrompt } from "../../lib/api/contract";
import CrowdSurfReveal from "../../components/game/CrowdSurfReveal";
import InputDock from "../../components/game/InputDock";
import PromptCard, { promptAnnouncement } from "../../components/game/PromptCard";
import TierCard, { TIER_CARD_ID, hasLongWord } from "../../components/game/TierCard";
import { Flag } from "../../components/game/YourSet";
import { ShareTicket } from "../../components/share/ShareTicket";

const html = (el: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(el);
const noop = () => {};

const prompt: RoundPrompt = {
  index: 1,
  total: 7,
  text: "Name a loudspeaker brand you'd see at a festival or club",
  hint: "Not headphone brands.",
  types: ["gear"],
  seconds: 25,
};

const answer = (name: string): AcceptedAnswer => ({ id: "a1", name, type: "venue", tier: "htbt", points: 100, share: 0.002 });

/** The element with `role="status"` and its inner HTML. */
function statusRegions(markup: string): string[] {
  const out: string[] = [];
  const re = /<(\w+)[^>]*role="status"[^>]*>([\s\S]*?)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(markup))) out.push(m[2]!);
  return out;
}

describe("the prompt is announced when a round starts (C25)", () => {
  it("the announcement names the round, the prompt, its hint and the clock", () => {
    expect(promptAnnouncement(prompt, 1, 7)).toBe(
      "Prompt 2 of 7. Name a loudspeaker brand you'd see at a festival or club. Not headphone brands. 25 seconds.",
    );
    expect(promptAnnouncement({ ...prompt, hint: "Past or present", text: "Name a Berlin nightclub?" }, 0, 7)).toBe(
      "Prompt 1 of 7. Name a Berlin nightclub? Past or present. 25 seconds.",
    );
    expect(promptAnnouncement({ ...prompt, hint: undefined }, 6, 7)).toBe(
      "Prompt 7 of 7. Name a loudspeaker brand you'd see at a festival or club. 25 seconds.",
    );
  });

  it("the card mounts with an empty polite live region, so the prompt is a change to an existing region", () => {
    for (const loading of [true, false]) {
      const markup = html(createElement(PromptCard, { prompt: loading ? null : prompt, loading, index: 1, total: 7 }));
      const regions = statusRegions(markup);
      expect(regions).toHaveLength(1);
      expect(regions[0]).toBe("");
      expect(markup).toMatch(/role="status" aria-live="polite" aria-atomic="true"/);
    }
  });

  it("the hint has an id, and the answer field is described by the prompt, the hint and the feedback line", () => {
    expect(html(createElement(PromptCard, { prompt, index: 1, total: 7 }))).toContain('id="prompt-hint"');
    const dock = html(
      createElement(InputDock, { seconds: 25, msLeft: 25000, value: "", onChange: noop, onSubmit: noop, busy: false, hidden: false, shake: 0 }),
    );
    expect(dock).toContain('aria-describedby="prompt-text prompt-hint feedback"');
  });
});

describe("the round result is tied to the focused button, not an inserted live region (C26)", () => {
  it("hit and miss cards carry the shared id and are not live regions", () => {
    for (const markup of [
      html(createElement(TierCard, { outcome: "htbt", answer: answer("Berghain"), seed: "s" })),
      html(createElement(TierCard, { outcome: "miss", answer: null, seed: "s" })),
    ]) {
      expect(markup).toContain(`id="${TIER_CARD_ID}"`);
      expect(markup).not.toContain('role="status"');
      expect(markup).not.toContain("aria-live");
    }
    expect(TIER_CARD_ID).toBe("tier-card");
  });
});

describe("long single-word answers (C28)", () => {
  it("steps the answer line down for words that can't fit at 24px on a 360px phone", () => {
    expect(hasLongWord("Audunbakkenfestivalen")).toBe(true);
    expect(hasLongWord("Bevrijdingsfestival")).toBe(true);
    expect(hasLongWord("Red Hot Chili Peppers")).toBe(false);
    expect(html(createElement(TierCard, { outcome: "htbt", answer: answer("Audunbakkenfestivalen"), seed: "s" }))).toMatch(/data-long="true"[^>]*>“Audunbakkenfestivalen”/);
    expect(html(createElement(TierCard, { outcome: "htbt", answer: answer("Berghain"), seed: "s" }))).not.toContain("data-long");
  });
});

describe("crowd-surf plaque (C27)", () => {
  it("only the name truncates; both quotes stay outside it", () => {
    const markup = html(createElement(CrowdSurfReveal, { outcome: "side", answer: answer("Holland International Blues Festival"), playing: false, onDone: noop, reduced: true }));
    expect(markup).toMatch(/“<span class="[^"]*plaqueName[^"]*">HOLLAND INTERNATIONAL…<\/span>”/);
  });
});

describe("the flag keeps focus and announces its outcome (C33)", () => {
  const flag = (state: "idle" | "sending" | "sent" | "failed", ack: "focus" | "announce" | null = null) =>
    html(createElement(Flag, { text: "funktion one", flag: state, ack, onSend: noop }));

  it("has a status region before anything happens", () => {
    const markup = flag("idle");
    expect(statusRegions(markup)).toEqual([""]);
    expect(markup).toContain("should “funktion one” have counted?");
  });

  it("never disables the focused button while sending (that would drop focus)", () => {
    const markup = flag("sending");
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).not.toMatch(/<button[^>]*\sdisabled/);
  });

  it("announces a failure through the existing region and keeps the button", () => {
    const markup = flag("failed");
    expect(statusRegions(markup).join("")).toContain("couldn&#x27;t send. try again?");
    expect(markup).toContain("<button");
  });

  it("after a send, the confirmation is either focusable (focus moves there) or inside the live region, never both", () => {
    const focus = flag("sent", "focus");
    expect(focus).toMatch(/<span[^>]*tabindex="-1"[^>]*>thanks\. an editor will take a look at “funktion one”\.<\/span>/);
    expect(statusRegions(focus)).toEqual([""]);

    const announce = flag("sent", "announce");
    expect(statusRegions(announce).join("")).toContain("thanks. an editor will take a look at “funktion one”.");
    expect(announce.match(/thanks\./g)).toHaveLength(1);
  });

  it("a row flagged on an earlier visit shows the confirmation quietly", () => {
    const markup = flag("sent", null);
    expect(markup).toContain("thanks. an editor will take a look");
    expect(statusRegions(markup)).toEqual([""]);
    expect(markup).not.toContain("<button");
  });
});

describe("share ticket stub", () => {
  it("the vertical label's text is ADMIT ONE, with the space", () => {
    const markup = html(createElement(ShareTicket, { number: 1, outcomes: ["htbt", "basement", "tent", "side", "miss", "tote", "main"] }));
    const admit = /<div class="[^"]*admit[^"]*" aria-hidden="true">([\s\S]*?)<\/div>/.exec(markup)?.[1] ?? "";
    expect(admit.replace(/<[^>]+>/g, "")).toBe("ADMIT ONE");
  });
});
