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
                                   content/sealed/source.json.enc     ↳ falls back to content/sample/pack.json
```

## Principles

- **Answers never ship to the client before the set is finished.** The
  client gets one prompt at a time and only learns an answer's tier after
  typing it.
- **The server owns the clock.** `/api/round` returns an HMAC-signed token
  that records when the round started. `/api/answer` refuses anything after
  `deadline + GRACE_MS`. Starting round 5 early just burns round 5.
- **Stateless verification.** Tokens and receipts are signed with
  `BARRICADE_SECRET`, so no session store is needed. `/api/finish` rebuilds
  the outcomes from receipts and never trusts client-reported scores.
- **Rarity is fixed before the day starts.** Every player in a set is scored
  against the same frozen tiers. The real crowd numbers come back in the
  results screen and the Morning After, and feed the next content rebuild.
- **Spoiler-free public repo.** Production content is committed only as
  sealed ciphertext. The sample pack is public and floats: it maps any date
  onto its few demo sets, so local dev always has something to play.

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

`v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256)>`

- round token: `{ k:"r", d:date, i:index, n:number, s:startMs, p:playerId }`
- receipt: `{ k:"c", d:date, i:index, a:answerId, t:tier, p:playerId }`

## Crowd stats store

`lib/store/` uses Upstash Redis over REST when `KV_REST_API_URL` and
`KV_REST_API_TOKEN` (or the `UPSTASH_*` equivalents) are set. Otherwise it
uses an in-memory store (dev only). Everything is keyed per date:

| key | type | what |
|---|---|---|
| `b:{date}:p:{playerId}` | string, NX, 3-day TTL | first-finish guard |
| `b:{date}:plays` | counter | finished players |
| `b:{date}:distsum` | counter | sum of distances |
| `b:{date}:dist` | hash distance→count | exact distance histogram (steps of 5m) |
| `b:{date}:r{i}` | hash answerId/"miss"→count | answers given per round |
| `b:{date}:rej{i}` | hash normalisedKey→count | rejected tries (for editors; never shown) |
| `b:{date}:flags` | list (capped 1000) | "this should count" reports |

Writes happen once per finished set: one pipelined request to Redis.
Rejected tries are logged at answer time.
