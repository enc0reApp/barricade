# BARRICADE — architecture

```
 OFFLINE (scripts/)                                   RUNTIME (Next.js on Vercel)
 ─────────────────                                    ───────────────────────────
 content/source/prompts/*.json ─┐                     GET  /api/set      set info for a date
 content/source/schedule.json  ─┼─ check-source       POST /api/round    start round i → prompt + signed token
                                │                     POST /api/answer   match typed text → tier + signed receipt
 Wikipedia pageviews ──────────── fetch-fame (cache)  POST /api/finish   verify receipts → reveal + record stats
                                │                     POST /api/flag     "this should count"
                                └─ build-content ──→  GET  /api/crowd    the Morning After (closed dates only)
                                   content/build/pack.json
                                        │ seal (AES-256-GCM, BARRICADE_SEAL_KEY)
                                        ▼
                                   content/sealed/pack.json.enc  ──→ lib/content/loader.ts (unseal once, cache)
                                   content/sealed/source.json.enc     ↳ dev only: content/build, then content/sample
```

## Principles

- **Answers never ship to the client before the set is finished.** The
  client gets one prompt at a time and only learns an answer's tier after
  typing it.
- **The server owns the clock.** `/api/round` returns an HMAC-signed token
  that records when the round started. `/api/answer` refuses anything after
  `deadline + GRACE_MS`. Starting round 5 early just burns round 5. With a
  store, a player's first start of a round is kept (`SET NX`): asking for the
  same round again returns the original start and deadline, and a round only
  ever yields one receipt (a second accepted answer gets the first one back).
- **Proof of play before the reveal** (today mode). `/api/round` for round
  i > 0 wants round i-1's token plus its receipt, or, with no receipt, round
  i-1's clock must have run out (`deadline + GRACE_MS`). `/api/finish` wants
  every round's token (same date, round, player, puzzle and pack), and a
  missed round's clock must have run out. Without this, one request with
  seven nulls would reveal the live set's answers. The fastest reveal without
  answering is now ~7 × 27.5 s, the same as playing through the UI. Archive
  plays need no tokens.
- **Stateless verification.** Tokens and receipts are signed with
  `BARRICADE_SECRET`, so no session store is needed. `/api/finish` rebuilds
  the outcomes from receipts and never trusts client-reported scores.
- **Rarity is fixed before the day starts.** Every player in a set is scored
  against the same frozen tiers. The real crowd numbers come back in the
  results screen and the Morning After, and feed the next content rebuild.
- **Spoiler-free public repo.** Production content is committed only as
  sealed ciphertext. The sample pack is public and floats: it maps any date
  onto its few demo sets, so local dev always has something to play.
- **Production fails closed.** With `NODE_ENV=production` the loader never
  reads `content/build`, treats a sealed pack without `BARRICADE_SEAL_KEY` as
  a hard error, and refuses any pack of kind `sample` unless
  `BARRICADE_ALLOW_SAMPLE=1` (a deliberate demo / Preview). Routes then answer
  `{ok:false,error:"server",message:"content pack not configured"}`.
  `.vercelignore` keeps `content/source`, `content/build` and `.env*` out of
  CLI uploads, and the build path is excluded from the function file traces.
- **No future-set spoilers.** An off-prompt reply ("X is real — just not an
  answer here") only names entities from sets dated on or before the round's
  date, or in no set at all (`LoadedPack.catalogFor`).

## Dates

A set belongs to a calendar date and players get their **local** date
(`lib/game/day.ts`). At any instant the live dates span UTC−12 to UTC+14.

| date vs. now | meaning |
|---|---|
| after the latest live date | `future` — refused, no spoilers |
| within the live window | `today` — scored, counts toward streak and crowd stats |
| before the live window | `archive` — playable, not scored |
| closed everywhere | crowd stats and answers can be published (`/api/crowd`) |

## Tokens

`v2.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`

- round token: `{ k:"r", d:date, i:index, n:number, s:startMs, p:playerId, h:packId }`
- receipt: `{ k:"c", d:date, i:index, n:number, a:answerId, t:tier, p:playerId, h:packId }`

`h` is the pack identity (`LoadedPack.id`: the first 8 bytes of
`sha256(kind + ":" + epoch)`), `n` the puzzle number. `/api/answer` and
`/api/finish` reject anything minted for another pack or puzzle, so a token
or receipt from a deployment that served the sample (or a preview) never
scores on production, even with the same `BARRICADE_SECRET`. Still, give each
Vercel environment its own secret.

## Crowd stats store

`lib/store/` uses Upstash Redis over REST when `KV_REST_API_URL` and
`KV_REST_API_TOKEN` (or the `UPSTASH_*` equivalents) are set. Otherwise it
uses an in-memory store (dev only; production without Redis records nothing).
Without a production store, `/api/crowd` and `/api/flag` return `unavailable`
(503); finished tickets hide report actions and retain scores and sharing.
A failed stats read hides crowd numbers rather than reporting zero players.
Report writes propagate failures so the UI never confirms a discarded report.

`/api/set` also returns `nextDate`: the next scheduled calendar date, or `null`
at the end of the bill. Tickets count down to that date rather than promising
another set when the schedule has ended. Sample sets continue daily.
Share links and ticket-image metadata follow the active Vercel host before
custom-domain DNS is connected; the configured custom domain still works.

Every key starts with a namespace `{ns}` = `b:{env}:{kind}`: `env` is
`VERCEL_ENV` (production / preview / development), else `NODE_ENV`; `kind` is
the loaded pack's kind (production / sample). Preview, dev and sample-pack
plays never land in production's numbers, even on one shared database:
production reads `b:production:production:{date}:…`.

| key | type | what |
|---|---|---|
| `{ns}:{date}:p:{playerId}` | string, NX, 3-day TTL | first-finish guard |
| `{ns}:{date}:s:{playerId}:{i}` | string (ms), NX, 3-day TTL | round start: no clock restarts (today mode) |
| `{ns}:{date}:a:{playerId}:{i}` | string (answer + receipt JSON), NX, 3-day TTL | the round's one accepted answer (today mode) |
| `{ns}:{date}:src:{ipHash}` | counter, 3-day TTL | counted finishes per client IP |
| `{ns}:{date}:plays` | counter | finished players |
| `{ns}:{date}:distsum` | counter | sum of distances |
| `{ns}:{date}:dist` | hash distance→count | exact distance histogram (steps of 5m) |
| `{ns}:{date}:r{i}` | hash answerId/"miss"→count | answers given per round |
| `{ns}:{date}:rej{i}` | hash normalisedKey→count, ≤ 2000 fields, 30-day TTL | rejected tries, live dates only (for editors; never shown) |
| `{ns}:{date}:fl:{playerId}:{i}` | string, NX, 3-day TTL | one flag per player per round |
| `{ns}:{date}:flsrc:{ipHash}` | counter, 3-day TTL | flags per client IP (cap 20) |
| `{ns}:{date}:flags` | list (capped 1000) | "this should count" reports |

A finished set is written in **one atomic `EVAL`**: the first-finish guard,
the per-IP cap and every counter commit together or not at all, so a lost
reply can't leave the guard set without the play. Past 30 counted finishes
from one client IP (`ipHash` = sha256 of the first `x-forwarded-for` hop, else
`x-real-ip`; IPv6 folded to its /64) on a date, the reveal is unchanged but
the play is not counted. This raises the cost of stuffing the crowd numbers;
it cannot stop bots spread across many IPs (add a Vercel Firewall rate-limit
rule on `/api/*` for that). Rejected tries are logged at answer time, flags
at flag time, each in one atomic `EVAL`.
