# End-to-end sign-in test

`sign-in.spec.ts` drives a real browser through the real Better Auth magic-link flow.

Why not Google? Google blocks automated logins and we never put real credentials into a test. The magic-link flow
exercises the same session, cookie and profile code; the Google button is checked separately (it must start OAuth
with the registered callback URL).

**On staging.** The deployment needs `E2E_SECRET` (a long random string, staging only) and `E2E_EMAIL_DOMAIN`
(e.g. `e2e.uno.example.com`) set with `wrangler secret put --env staging`. Addresses at that domain are captured in
the `e2e_outbox` table instead of being emailed, and are readable through `/api/test/magic-link` only with the secret.
That route returns 404 on production and whenever `E2E_SECRET` is unset.

```
BASE_URL=https://staging.uno.example.com E2E_SECRET=... E2E_EMAIL_DOMAIN=... npx playwright test
```

**Locally.** `npm run build`, copy `apps/worker/.dev.vars.example` to `.dev.vars` (set the secrets, E2E values),
`npm run db:migrate:local -w apps/worker`, `npm run dev:worker`, then run Playwright with `BASE_URL=http://localhost:8787`.
