# Writing BARRICADE content

A set is 7 prompts. Each prompt has a closed answer list with a rarity tier per
answer. Players type one answer per prompt. If it's on the list, the crowd
carries it forward by its tier's points. If it's not, they can try again until
the clock runs out.

So the list has to be **complete** (a correct answer that's missing is the
worst thing that can happen to a player) and **correct** (a wrong answer that's
accepted makes the game a joke).

## Files

```
content/source/                  ← gitignored (spoilers). Sealed into content/sealed/.
  schedule.json                  ← SourceSchedule: epoch + days[] of 7 slugs each
  prompts/<slug>.json            ← one SourcePrompt per file
content/sample/source/           ← public demo content, same format
```

Types are in `lib/content/types.ts` (`SourcePrompt`, `SourceAnswer`, `SourceSchedule`).

## A prompt file

```json
{
  "slug": "uk-festivals",
  "text": "Name a music festival held in the UK",
  "hint": "Past or present.",
  "types": ["festival"],
  "difficulty": 2,
  "boundary": "Recurring music festivals held in England, Scotland, Wales or Northern Ireland, any era, including defunct ones. One-off concerts excluded.",
  "rarity": "blend",
  "answers": [
    { "name": "Glastonbury", "type": "festival", "aliases": ["Glastonbury Festival", "Glasto"], "wiki": "Glastonbury_Festival", "guess": "main" },
    { "name": "Boomtown", "type": "festival", "aliases": ["Boomtown Fair"], "wiki": "Boomtown_(festival)", "guess": "tent", "flag": "tote" },
    { "name": "Field Maneuvers", "type": "festival", "wiki": null, "guess": "htbt", "note": "Secret-location dance festival, capped at a few thousand" }
  ],
  "sources": ["https://en.wikipedia.org/wiki/List_of_music_festivals_in_the_United_Kingdom"]
}
```

## Rules for a good prompt

1. **Bounded but deep.** It needs a clear membership rule *and* a long tail.
   Aim for 40–400 answers. Avoid "Name a DJ" (unbounded, unverifiable).
   A few small-list novelty prompts (8–20 answers) are fine, one per set at most.
2. **Unambiguous.** Two fair-minded people must agree whether an answer counts.
   Write that rule into `boundary`, and say the important parts in `hint`.
3. **Written for people who go to shows.** Focus on festival lineups, memorable
   performances, touring routes, venues, clubs, stages, genres and local scenes.
   Sound-system *crews* and the culture around a night out fit. Drum machines,
   synthesizers, studio software, recording studios and equipment-brand quizzes
   do not. A prompt should reward being in the crowd, following a tour or knowing
   a scene. Mix types across the set: at least 4 different `types` in every set,
   at most 2 prompts whose answers are artists. `content:check` and the compiler
   reject scheduled gear and studio prompts in both the main and sample packs.
4. **Answerable in 25 seconds** by someone who goes to shows. Difficulty 1–5
   orders the set: start easy, end deep.
5. Prompt text starts with **"Name"**. Keep it under ~70 characters.

## Rules for answers

- **Complete.** Use list articles, Wikidata, official sites, and your own
  knowledge, then ask: *"what would a festival-goer type that isn't here?"*
- **Correct.** Every answer must satisfy `boundary`. When unsure, research. If
  it's still unclear, leave it out and mention it in `notes`.
- **Real.** Never invent an entity. Every `wiki` title must be a real English
  Wikipedia article (redirects are fine). Use `null` if there isn't one.
- **Aliases** are other spellings people will actually type, such as
  abbreviations, former names, local names, and common misspellings that are
  more than 2 typos away. Case, accents, punctuation, "the", "&"/"and" and
  number words are already handled, so don't list those variants. Watch for
  aliases that collide with a *different* answer.
- **Types** must be accurate. A Berlin club is a `venue`. Berlin is a `city`.
  Funktion-One is a `soundsystem`. Jungle is a `genre`.
- **`guess`**: your honest estimate of how many festival-goers would give this
  answer to *this prompt*:
  - `main`: the obvious ones, maybe 6%+ of players each
  - `side`: well known, roughly 1.5–6%
  - `tent`: you need to be into it, roughly 0.4–1.5%
  - `basement`: real heads, roughly 0.1–0.4%
  - `htbt`: almost nobody, under 0.1%
- **`flag: "tote"`** marks the go-to "obscure" pick that everyone who wants to
  look clever says. Give 0–2 per prompt. It scores 15, less than a normal answer.
- **`rarity`**: use `"guess"` when global fame misleads. For example, Paris is
  very famous, but almost nobody says Paris for "a city that hosts a
  Lollapalooza". Use `"fame"` only for broad prompts where fame ≈ salience.
- **`note`** (optional, under 90 chars) is a fun fact shown on the results
  screen. Add them for deep cuts.

## How tiers are computed

`scripts/build-content.ts`:

1. Merges answers across prompts into entities (same `wiki` title or same
   `type` + name means the same entity).
2. Fetches 12 months of English Wikipedia pageviews per article (cached in
   `content/source/.cache/`). This is the **fame** signal.
3. Per prompt, estimates each answer's share of players:
   `fameShare ∝ views^α`, `guessShare = GUESS_SHARE[guess]`, and
   `blend = exp(0.5·ln fameShare + 0.5·ln guessShare)`, normalised.
4. Maps share to a tier with `SHARE_THRESHOLDS` (`lib/game/tiers.ts`). Flags win.
5. Prints a tier report per prompt. Read it, then nudge `guess`/`flag`/`rarity`
   where it's wrong.

## Commands

```bash
pnpm content:check     # validate every source file + the schedule
pnpm content:fame      # fetch/refresh Wikipedia pageviews (cached)
pnpm content:build     # compile content/source → content/build/pack.json
pnpm content:report    # tier distribution per prompt
pnpm content:seal      # encrypt pack + sources → content/sealed/ (needs BARRICADE_SEAL_KEY)
pnpm content:unseal    # restore content/source from content/sealed (needs the key)
pnpm content:sample    # compile the public sample pack
```

## Isolated exclusive editions

The LA festival edition for November 6, 2026 is separate from the daily
November 9–23 schedule. Its pack and source backup are encrypted in
`content/sealed/la-edm-2026-11-06.json.enc` and
`content/sealed/la-edm-2026-11-06-source.json.enc`.

For a new exclusive, place `schedule.json` and `prompts/*.json` under the
ignored `content/source/special/<edition-slug>/`, then run:

```bash
pnpm exec tsx scripts/build-exclusive.ts <edition-slug>
```

This validates the live-music audience rule, checks canonical answer matching
and verifies each question has a 100-point answer before sealing both pack
and sources. Editorial warnings still need review; short, bounded festival
lineups are an intentional exception for this themed edition. The exclusive
uses fixed editorial tiers for an LA electronic-festival audience.

To serve an edition, set the deployment's `BARRICADE_PACK_PATH` to its sealed
pack and supply `BARRICADE_SEAL_KEY` and a separate `BARRICADE_SECRET` through
environment variables. Do not change the main pack or publish plaintext.
The normal unseal command restores the main bundle only; exclusive source
backups use the same `source` AES-GCM label and relative-file bundle format.
