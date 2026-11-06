# BARRICADE — design

> You're at the back of the field, 700 metres from the stage. Every answer is a
> crowd you push through. The rarer the answer, the further the crowd carries you.

The feel: a pixel-art night at a festival. It borrows Krillion's lo-fi,
letter-spaced pixel UI and its suspenseful "how far did it go?" reveal. It
borrows enc0re's ticket stubs, `/// TRIPLE-SLASH ///` calls to action, and
monospace serial numbers. Type is **Geist Pixel** throughout, with Geist Mono
for long small text. Tokens are in `app/tokens.css`.

## Principles

- **For the crowd.** Questions reward going to gigs, following tours, knowing
  festival lineups, venues and scenes. Studio tools and production gear are
  outside the game's subject matter.
- **Authentic pixels.** Draw the scene on a low-resolution canvas (for example
  180×320 logical pixels) and scale it up with `image-rendering: pixelated`. No
  rounded corners. Give panels stepped (notched) corners with `clip-path`.
- **Night palette.** Deep navy sky (`--sky-*`). Stage light in cyan, magenta,
  amber and UV. Ink is warm off-white. Tier colours are `--tier-*`.
- **No strobes.** Light beams sweep slowly. Nothing flashes more than 3 times a
  second, and nothing large ever flashes red. `prefers-reduced-motion` gets a
  still scene and instant reveals.
- **Mobile first** (390px), with a 16px gutter and no horizontal scroll. On
  desktop the game sits in a centred column of about 560px, with the scene
  full-bleed behind it.
- **Tiers are never colour-only.** Every tier chip carries its label.

## The scene (behind every screen)

From the back of the field, looking at the stage:

- **Sky:** a gradient from `--sky-0` to `--sky-3` with a sparse twinkling
  starfield. A faint haze glows above the stage.
- **Stage** at the horizon: truss, a glowing LED wall, PA hangs on each side,
  and 2–4 slowly sweeping beams (cyan, magenta, amber, UV) with soft low fog.
- **Crowd:** rows of pixel silhouettes (heads, shoulders, the odd raised hand,
  phone lights, a flag on a pole, someone on shoulders). Rows nearer the
  viewer are bigger, giving parallax depth.
- **Distance drives the scene.** At 700m the stage is tiny. As the distance
  falls toward 0m, the stage grows until the LED wall fills the top of the
  screen and the barricade rail appears in the foreground.
  `<Scene distance={n} />` animates between distances.
- **Distance ruler** on the right edge: a vertical line with a tick every 50m,
  labels every 100m, and a magenta `YOU ▶` marker. Lore markers sit at fixed
  distances, in Geist Pixel Line, dim:

| m | marker |
|---|---|
| 700 | the car park. you can hear it from here |
| 650 | wristband scanners |
| 600 | the merch line (90 minutes, minimum) |
| 550 | portaloo row. hold your breath |
| 500 | $19 noodles |
| 450 | people sitting on blankets |
| 400 | the delay towers |
| 350 | the flag guy |
| 300 | front-of-house. best mix in the field |
| 250 | the "excuse me, sorry" zone |
| 200 | someone's on someone's shoulders |
| 150 | the circle pit opens here |
| 100 | crowd-surfers incoming |
| 50 | camped out since 6am |
| 0 | THE BARRICADE. you made it. |

## Screens

### 1. Doors (home)

- The scene, with the stage far away.
- Logo **BARRICADE** in Geist Pixel at large size, with a cyan/magenta
  chromatic split (offset 2px) and faint scanlines.
- Under it: **THE DAILY PUSH** (wide tracking), then
  `7 prompts · 25 seconds each · rarer answers get you closer`.
- Primary CTA: **▲ PUSH TO THE FRONT ▲**. A large panel button with a cyan
  glow edge and stepped corners.
- `SET #12 · MON 09 NOV` and `DOORS CLOSE IN 06:12:33` (time until local
  midnight). Show `STREAK 3` when there's a streak.
- Secondary row: `HOW TO PLAY` · `ARCHIVE ⟲` · `LAST NIGHT'S CROWD`.
- **Already played today?** Show your ticket, share buttons and the
  countdown instead of the CTA.
- Footer: `a fstvl.xyz game · made by enc0re`, plus one line:
  `No account. Answers are stored anonymously to work out rarity.`
- **No set today?** (past the end of the schedule) Show
  `DOORS ARE CLOSED TONIGHT` and link the archive.

### 2. The push (a round)

- **HUD** (top): left panel `DISTANCE` / `700m` (it ticks down when you
  move). In the centre, 7 progress squares that fill with the tier colour; the
  current one pulses gently. Below them, `PROMPT 1 OF 7`. Right panel
  `POINTS` / `0`.
- **Prompt card**: a dark panel with stepped corners. `PROMPT 1 OF 7` in
  magenta with wide tracking, the prompt text big (about 26–30px on mobile),
  the optional hint small and dim in Geist Mono, and a foot line
  `▲ rarer answers get you closer ▲`.
- **Input dock**, fixed to the bottom and kept above the iOS keyboard with
  `visualViewport`:
  - **VU-meter timer**: a segmented LED bar, one segment per second, that
    drains. Green, then amber from 10s, then red from 5s. Red is static, never
    flashing. The seconds count is shown as a number too.
  - Text input `type one answer…` with `autocomplete=off`,
    `autocapitalize=off`, `spellcheck=false`, `enterkeyhint=go`, max 80 chars.
    It autofocuses when the round starts.
  - A **PUSH** button in magenta. Enter submits.
- **Feedback line** above the dock (`aria-live=polite`):
  - unknown: `"banana": not on tonight's list. try again`
  - off-prompt: `BERGHAIN is real — just not an answer here.`
  - expired: `time's up`
  - The input does a small 150ms shake on reject (none with reduced motion).
    You can retry until the clock runs out.
- **Accepted: the crowd-surf reveal.** This is the signature moment. It lasts
  about 2–3 seconds and a tap skips it.
  1. The input locks. Your answer appears as a pixel plaque held up by pixel
     hands at the bottom of the field.
  2. The crowd passes it forward. It travels up past dashed **tier lines**,
     each labelled like `MAIN STAGE · 10` in its tier colour. The lines are
     spaced in proportion to points: MAIN STAGE 10, TOTE BAG 15, SIDE STAGE
     30, THE TENT 60, BASEMENT 85, YOU HAD TO BE THERE 100. It eases and
     slows near each line (suspense) and stops at its tier.
  3. **Tier card**: the tier label large in the tier colour, `"Berghain"`,
     `+85 · 85m closer`, a flavour line, and
     `≈0.3% of the crowd said this`. Include the answer's `note` if it has one.
  4. The HUD distance ticks down, the YOU marker moves, and the stage grows.
  5. **▲ KEEP PUSHING ▲** advances (manual, like Krillion; Enter works too).
     After round 7 it reads **▲ SEE WHERE YOU ENDED UP ▲**.
- **Miss** (clock hits 0): `TIME'S UP. the crowd didn't budge.` then KEEP
  PUSHING.

Flavour lines, chosen at random per tier:

- MAIN STAGE: "The answer everyone yells." · "Half the field said that." · "Solid. Predictable. Loud."
- TOTE BAG: "The 'obscure' pick that isn't." · "Everyone's deep cut." · "Nice tote bag."
- SIDE STAGE: "Real ones know." · "A respectable push."
- THE TENT: "Now we're moving." · "You know your stuff."
- BASEMENT: "Sweaty room. Great system." · "Heads only."
- YOU HAD TO BE THERE: "You had to be there. You were." · "Nobody else said that."

### 3. The ticket (results)

This is the enc0re touch: a ticket stub. The same layout is used on the page
and in the OG image (`app/s/[code]/opengraph-image.tsx`).

```
┌──────────────────────────────────────┬─ ─ ┬───────────┐
│ BARRICADE            SET #12         │  ·  │ A         │
│ MON 09 NOV 2026                      │  ·  │ D  SET    │
│                                      │  ·  │ M  #12    │
│        14m                           │  ·  │ I         │
│   FROM THE STAGE                     │  ·  │ T         │
│                                      │  ·  │           │
│  ■ ■ ■ ■ ■ ■ ■   (tier squares)      │  ·  │ ║│║║│║│║  │
│  POINTS 686 · BEAT 64% OF THE CROWD  │  ·  │ (barcode) │
│  fstvl.xyz                           │  ·  │           │
└──────────────────────────────────────┴─ ─ ┴───────────┘
```

- The paper is off-white `#F1EEE8` and the ink is `#0B0D17`, in Geist Pixel.
  Half-circle notches sit at the top and bottom of the dotted perforation. The
  stub carries `ADMIT ONE` vertically.
- The **barcode** is a pixel barcode generated deterministically from the
  share code.
- A distance of 0 shows **ON THE BARRICADE** in place of the number.
- On mobile the ticket may be portrait, with the stub at the bottom and the
  perforation horizontal.
- Below the ticket: **/// SHARE YOUR TICKET ///**. This uses
  `navigator.share` with the text and URL when available; otherwise it copies
  the text and shows `COPIED`. Also include `COPY TEXT`.
- **YOUR SET**: 7 rows, each with the prompt, your answer and tier chip, and
  `≈0.6% said this` (the real crowd percentage when the server has it), or
  `missed`. Each row expands to **YOU COULD HAVE SAID**, the server's `picks`
  grouped by tier with notes. On missed rounds, offer a quiet link:
  `should "<your last try>" have counted?` It sends `/api/flag`.
- Crowd line: `you beat 64% of the crowd · 3,412 played`.
- `DOORS OPEN IN 06:12:33`, plus links to the archive and last night's crowd.

### 4. Archive (`/archive`, `/archive/[number]`)

A list of past sets: number, date, title, and your result if you played it
(distance and squares). Archive play shows an `ARCHIVE · NOT SCORED` banner
and never touches the streak.

### 5. How to play (`/how`)

The rules, a tier table (colour chip, label, points, blurb), and how rarity
works: Wikipedia fame, editorial calls, then the real crowd.

### 6. Last night's crowd (`/crowd`, `/crowd/[date]`)

The Morning After page: plays, average distance, a pixel-bar histogram of
distances, and for each prompt the top answers with % bars in tier colours,
plus `lone wolves: N answers only one person gave`. It opens once the date is
closed everywhere; before that it shows `the crowd's still in the field —
opens in 04:12:00`.

## Motion

- Beam sweep: 8–14s per cycle. Star twinkle: 2–6s. The HUD distance counts
  over 600ms. The reveal takes 1.6–2.6s depending on tier.
- With reduced motion: a static scene, the reveal jumps straight to the tier
  card, and the counter sets instantly.

## Copy voice

Short, dry and affectionate about festival life. Lowercase for feedback lines,
UPPERCASE with wide tracking for labels. Never mean about wrong answers.
