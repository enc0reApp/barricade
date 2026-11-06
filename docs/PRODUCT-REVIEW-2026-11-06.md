# BARRICADE product review — 6 November 2026

The core loop is coherent: seven short prompts, a clear rarity incentive, immediate
feedback and a ticket worth sharing. The code and API checks support the launch
flow. Player engagement and the real-phone experience still need live validation.

## Changes shipped in this review

- **Reports tell the truth.** Production without Redis previously confirmed an
  answer report and discarded it. Finished sets now hide unavailable report
  actions, the API refuses unavailable submissions, and a failed database write
  remains retryable instead of showing an editor confirmation.
- **Crowd numbers distinguish absence from failure.** An unconfigured or failed
  store no longer appears as a crowd of zero. Scores, tickets and sharing keep
  working while the crowd page explains that numbers are unavailable.
- **Return messages follow the schedule.** Results previously promised doors at
  the next midnight even after the final set. They now use the next scheduled
  date, handle gaps, and offer the archive when the current bill ends.
- **Shares work before domain cutover.** Shares from the live Vercel host stay
  on that host, including explicit Open Graph and Twitter image URLs. The
  configured custom domain remains supported. Unrelated request hosts do not
  become share origins.
- **The visible clock reflects server work.** A slow round-start store write
  previously made the client show time already spent on the server. The reply
  now reports the server clock after that work.
- **The rules clarify commitment.** The first accepted answer locks in, and
  typo forgiveness is described as applying to common typos.

The visual design stays intact: centred desktop play, the pixel festival field,
crowd-surf reveal, and the ticket. New recovery messages use the existing panels
and give players an archive action.

## Verification

- TypeScript check: passed.
- Vitest: 320 tests across 24 files passed, including 11 new regressions covering
  unavailable reports, retryable writes, stats outages, schedule gaps and ending,
  active-host sharing, and slow server timing.
- Next.js production build: passed.
- Source validation: 106 prompt files, 16,160 answers, 15 scheduled days,
  1 unscheduled prompt, 0 errors, 89 editorial warnings. Warnings include short
  lists, redundant aliases and missing Wikipedia titles; this review did not
  independently fact-check all answers.
- Recompiled private content: gameplay pack unchanged. Every scheduled round
  offers a 100-point answer, so 0m is attainable in all 15 sets. Neither plaintext
  puzzle content nor secrets are included in the commit.
- HTTP sample game: all seven rounds accepted, invalid/empty guesses rejected,
  original round deadline retained, premature reveal refused, and repeat finish
  kept the same score without counting twice.
- HTTP production smoke: the sealed schedule returns the prelaunch state and
  refuses Nov 9 play before launch. Home, rules and share pages return 200.
- Share card: working-host metadata verified; generated 1200×630 PNG inspected.
- Browser automation failed with a connection error and blank render in this
  environment. Interactive desktop, mobile keyboard, screen-reader and real
  iPhone QA could not be completed here.

## Remaining launch work and product limits

1. Verify the `fstvl.xyz` DNS cutover. It did not resolve in this session's network
   check; the public Vercel endpoint answered correctly.
2. Connect Upstash before relying on crowd numbers, editor reports or durable
   round claims. Without it, the game is playable but those server records are
   unavailable.
3. Test on a physical iPhone: keyboard visibility on the first and subsequent
   prompts, submitting at the buzzer, background/foreground, reload, ticket
   scrolling and native sharing. Complete interactive desktop QA too.
4. Add content beyond November 23 before promising an ongoing daily game.
5. Add request limits before substantial promotion. Known matching limitations
   (a real place close to an unknown deep cut) and editable cosmetic share codes
   remain; receipt-verified scores and crowd writes are separate from share codes.
6. Back up the seal key in the owner's password manager and verify Vercel's
   GitHub access. Neither operation was performed by this code review.

This session pushes reviewed source to GitHub. Production deployment and DNS
changes are separate operations; the live site's previous build is not proof
that these fixes have deployed.
