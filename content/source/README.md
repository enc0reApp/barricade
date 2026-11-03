# content/source (gitignored)

Real puzzle sources live here locally and are **never committed** — they're spoilers.
They are backed up, encrypted, in `content/sealed/source.json.enc` (`pnpm content:seal`)
and restored with `pnpm content:unseal` (needs `BARRICADE_SEAL_KEY`).

Format: see `docs/CONTENT.md` and `lib/content/types.ts`.
