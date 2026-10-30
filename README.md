# UNO

Classic + No Mercy, hosted on Cloudflare (Worker + Durable Objects + D1 + Static Assets). Specs live in `docs/`.

## Layout

`packages/shared` (types/constants, no deps) · `packages/engine` (pure rules) · `packages/bots` · `apps/web` (React/Vite/Tailwind) · `apps/worker` (Worker, DOs, D1).

## Commands

`npm ci` · `npm run lint` · `npm run typecheck` · `npm test` · `npm run build` · `npm run dev:worker` (after a web build) · `npm run dev:web`.

## One-time staging setup (needs your Cloudflare account)

1. Own a real domain on Cloudflare and replace `uno.example.com` in `apps/worker/wrangler.jsonc`, the workflow smoke test, and `docs/`.
2. `npx wrangler login`, then `npx wrangler d1 create uno-staging` and paste the `database_id` into `env.staging.d1_databases`.
3. First deploy from your machine: `npm run deploy:staging` (creates the Worker and attaches the custom domain; HTTPS is automatic).
4. GitHub repo secrets (environment `staging`): `CLOUDFLARE_API_TOKEN` (Workers Scripts:Edit, D1:Edit, Zone/DNS:Edit) and `CLOUDFLARE_ACCOUNT_ID`.
5. Push to `main`; `.github/workflows/deploy-staging.yml` runs lint, typecheck, test, build, deploy, then curls `/api/health`.

Notes: `.npmrc` sets `legacy-peer-deps` (npm 10 crashes resolving vitest's optional peers). Worker tests use `@cloudflare/vitest-plugin`, the renamed successor of the deprecated `@cloudflare/vitest-pool-workers`.

## Accounts

Sign-in (Google + email magic link), profiles and D1 are documented in [docs/AUTH.md](docs/AUTH.md), including the one-time staging setup (Google OAuth client, secrets, email provider).
