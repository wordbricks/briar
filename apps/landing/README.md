# Briar landing

The public Briar site is a vinext application deployed to the existing
`briar-landing` Cloudflare Worker. It is one workspace in the repository's Bun
and Turborepo setup; it is not a standalone npm project and is not deployed
through OpenAI Sites.

## Requirements

- Bun 1.4.0, as pinned by the repository root `package.json`
- Node.js 22.13 or newer for vinext tooling

Install dependencies once from the repository root:

```bash
bun install --frozen-lockfile
```

## Development and verification

Run these commands from the repository root so Turborepo uses the workspace
graph and restores the landing build before its rendered-output tests:

```bash
bun run dev:workspace --filter=@briar/landing
bun run lint --filter=@briar/landing
bun run typecheck --filter=@briar/landing
bun run build --filter=@briar/landing
bun run test --filter=@briar/landing
```

Generate optional Drizzle migrations directly in the landing workspace:

```bash
bun --cwd apps/landing run db:generate
```

Site code lives under `app/`, the Cloudflare entry point is
`worker/index.ts`, and `vite.config.ts` defines the local and generated Worker
bindings. `examples/d1/` remains an optional example surface; the production
landing Worker currently has no D1 or R2 binding.

## Cloudflare deployment

Production deploys must be built and tested from merged `main`. vinext writes
the deployable Worker config to `dist/server/wrangler.json`; deploy that exact
config so the generated `ASSETS` and `IMAGES` bindings and Worker-first routes
are preserved:

```bash
bun install --frozen-lockfile
bun run build --filter=@briar/landing
bun run test --filter=@briar/landing
bun --cwd apps/landing wrangler deploy --config dist/server/wrangler.json
```

The production endpoint is
`https://briar-landing.wbai.workers.dev`.

## Google Analytics

Production uses the Briar landing GA4 web stream (`G-SQDQ3YZ6TL`) by default.
Set `NEXT_PUBLIC_GA_MEASUREMENT_ID` only when a staging or test build needs a
different stream. Invalid override IDs disable Google Analytics.

The site emits a `file_download` event for macOS DMG links. The release
Worker's request count remains the source for files actually served.
