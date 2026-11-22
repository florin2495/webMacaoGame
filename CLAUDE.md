@AGENTS.md

# webMacaoGame (Macao) - project notes for Claude

Macao card game (game 15 of the hub), folder `D:\_DEv\015_Macao`: 2-6 players, each on their own phone, up to 16
spectators. Built on the Șeptica room infrastructure (`D:\_DEv\008_Septica`): rooms, password, spectators + queue,
rejoin, pending kick, Realtime, same test setup. House rules are customizable per room by the host in the lobby
(`macao_rooms.rules`, JSON).

**Status (2026-11-22): skeleton.** The code is still the renamed Șeptica code; the Macao rules engine, rules panel and
game screen are being written. The schema below is already the Macao one (`rules` jsonb, `score`, no `teams`).

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webMacaoGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project connected by hand by the user (suggested name `015_web-macao-game`, domain
  `015web-macao-game.vercel.app`). Production URL: https://games.hailatat.icu/macao (basePath `/macao`; the hub
  proxies `/macao/*` here once its zone and `games.ts` entry are added - **pending** in `000_Startup`).
- `vercel.json` pins `"regions": ["fra1"]` (Frankfurt, next to the Supabase DB).
- Env vars (Vercel + `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Realtime only),
  `SUPABASE_SERVICE_ROLE_KEY`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `macao`).
- **Before every push to main, bump the patch version** in `package.json` (and the two spots in `package-lock.json`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project of the hub)
Every object of this game is prefixed `macao_`. Table names live in `T` in `src/lib/server/db.ts`.
Migrations are run by hand in the Supabase SQL editor - this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | **not yet** | `macao_rooms` (with `rules` jsonb), `macao_players` (kick, presence, seat, role, queue, `score`); RLS on, no policies |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify by effect with the service key.
- Never print or commit the keys in `.env.local`.

## Testing (GitHub Actions, manual only)
Never run tests, tsc, eslint or builds locally (user's rule, `D:\_DEv\CLAUDE.md`). Workflows are `workflow_dispatch`
only, `ubuntu-latest`: `check.yml` (typegen + tsc + eslint + build), `unit-tests.yml` (Vitest), `e2e.yml`
(`scripts/e2e.mjs` against production), `e2e-ui.yml` (Playwright, `tests/ui/*.e2e.ts`). Brand-new game: fix Check
code / Unit tests until green before handing over.
