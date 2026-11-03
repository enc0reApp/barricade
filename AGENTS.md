<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## BARRICADE

- Contract files (change deliberately, then recompile content): `lib/game/{tiers,normalize,day}.ts`, `lib/content/types.ts`, `lib/api/contract.ts`, `lib/share/code.ts`.
- Never commit `content/source/` or `content/build/` (spoilers) — only `content/sealed/` (encrypted) and the public `content/sample/`.
- Docs: `docs/ARCHITECTURE.md`, `docs/DESIGN.md`, `docs/CONTENT.md`.
- Checks: `pnpm typecheck && pnpm test && pnpm content:check`.
