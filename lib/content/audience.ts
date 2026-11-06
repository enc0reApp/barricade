/** Editorial gate for playable schedules. Historical fixtures can retain legacy entity types. */
import type { SourcePrompt, SourceSchedule } from "./types";
import type { ValidationIssue } from "./validate";

const PRODUCTION_TRIVIA = /\b(?:drum machines?|synthesi[sz]ers?|recording studios?|DAWs?|DJ (?:apps?|equipment)|pro[- ]audio|loudspeaker brands?|audio plug[- ]?ins?)\b/i;

export function audienceIssues(prompts: readonly SourcePrompt[], schedule: SourceSchedule | null): ValidationIssue[] {
  const scheduled = new Set(schedule?.days.flatMap((d) => d.prompts) ?? []);
  return prompts.filter((p) => scheduled.has(p.slug) && (p.types.includes("gear") || PRODUCTION_TRIVIA.test(p.text))).map((p) => ({
    severity: "error" as const,
    file: `prompts/${p.slug}.json`,
    message: "scheduled prompts must test live-music knowledge: gigs, festivals, lineups, venues, tours and scenes; studio and equipment trivia is out of scope",
  }));
}
