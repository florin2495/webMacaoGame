@AGENTS.md

# webMacaoGame (Macao) - project notes for Claude

Macao card game (game 15 of the hub), folder `D:\_DEv\015_Macao`: 2-6 players, each on their own phone, up to 16
spectators. Built on the Șeptica room infrastructure (`D:\_DEv\008_Septica`): rooms, password, spectators + queue,
rejoin, pending kick, Realtime, same test setup.

## House rules (user's requirement)
Every rule below is a **room setting the host picks in the lobby, after creating the room and before dealing**
(`RulesPanel`, `POST /settings`, stored in `macao_rooms.rules`, copied into each deal). Defaults in `DEFAULT_RULES`
(`src/lib/rules.ts`): hand size, jokers on/off + how many cards each joker gives, where 2/3 go (suit / color / any),
2 on 3 and 3 on 2, joker on anything or by color (colored on ♥♦, black on ♠♣), jokers stack with 2/3, anything on a
joker, stop card (4 / A / none, any suit or same suit, on anything), skip card (A / 4 / none, on anything, stacks,
can be stopped), change-suit card (7 / J / none, on anything), several same-rank cards at once, play the drawn card,
finish on a special card, Macao + penalty, round end (first out / until one is left). Stop and skip never share a rank.
- "Macao" and "Contra-Macao" are two small, low-key buttons (user: they must not catch the eye). Macao can be said
  with at most two cards; Contra-Macao catches everyone left with one card who did not say it.
- Putting the last 2, 3 or 4 equal cards down at once finishes without saying Macao (user's requirement).
- A player who leaves or is kicked during a round (host kick: pending 10 s, "Ignoră") is removed from the deal and the
  round goes on without them (cards under the stock, their penalty dropped, turn passes on); below 2 players it is
  cancelled (user's requirement). An empty stock is refilled by shuffling every played card except the top one.

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webMacaoGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project connected by hand by the user, domain `015web-macao-game.vercel.app`. Production URL:
  https://games.hailatat.icu/macao (basePath `/macao`; the hub's zone and `games.ts` entry were added in hub v0.5.9).
- `vercel.json` pins `"regions": ["fra1"]` (Frankfurt, next to the Supabase DB).
- Env vars (Vercel + `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Realtime only),
  `SUPABASE_SERVICE_ROLE_KEY`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `macao`).
  Hub leaderboard game `macao` (test rooms `e2e-test-…` never report).
- **Before every push to main, bump the patch version** in `package.json` (and the two spots in `package-lock.json`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project of the hub)
Every object of this game is prefixed `macao_`. Table names live in `T` in `src/lib/server/db.ts`.
Migrations are run by hand in the Supabase SQL editor - this list is the source of truth.
**Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes, verified 2026-11-22 by effect: service key 200 on both tables (incl. `rules`, `score`, `queued_at`, `role`), anon 401 | `macao_rooms` (with `rules` jsonb), `macao_players` (kick, presence, seat, role, queue, `wins`, `score`); RLS on, no policies |

Rules for schema changes:
- New migration = new numbered file in `supabase/migrations/`, additive when possible, folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify by effect with the service key.
- Never print or commit the keys in `.env.local`.

## Code map
- `src/lib/rules.ts` - `Rules`, `DEFAULT_RULES`, `normalizeRules` (any JSON -> valid rules), `updateRules` (stop/skip swap), `describeRules`.
- `src/lib/macao.ts` - pure engine: deck (52 + jokers `XB`/`XR`), `newDeal`, `fits` / `playProblem` / `legalCards`,
  `playCards` (same-rank multi-play, suit for the change card), `drawCard` / `passTurn`, `takePenalty`, `sitOutTurn`,
  `sayMacao` / `catchMacao`, `autoMove` (host's "Joacă pentru el"), `standings`. Tested in `macao.test.ts`
  (incl. 150 random full games with random rules: they always end and never lose a card).
- `src/lib/server/room.ts` - load/auth, `saveRoom` (version check), `applyMove` (end of round: winner's wins +1,
  everyone's score += cards left, hub leaderboard), per-player `buildState` / `gameView` (own hand only).
- Routes: `play` `{cards, suit?}`, `draw`, `pass`, `take`, `sit`, `macao`, `catch`, `skip`, `settings` `{rules}`, plus the
  room routes from Șeptica (join, ready, start, kick, leave, lobby, new-round, queue, reorder, state).
- UI: `Lobby` + `RulesPanel`, `Game` (seats grid, pile + stock, actions, hand with multi-select and suit picker, log).
- Abandoned rooms (600 s) and the 10-minute lobby/finished expiry work as in Șeptica (`cleanupAbandonedRooms`).

## Testing (GitHub Actions, manual only)
Never run tests, tsc, eslint or builds locally (user's rule, `D:\_DEv\CLAUDE.md`). Workflows are `workflow_dispatch`
only, `ubuntu-latest`: `check.yml` (typegen + tsc + eslint + build), `unit-tests.yml` (Vitest), `e2e.yml`
(`scripts/e2e.mjs`, API against the deployed site), `e2e-ui.yml` (Playwright, `tests/ui/*.e2e.ts`, desktop Chromium +
iPhone 13). E2E needs the repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (set).
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- Test ids used by `tests/ui` (renaming one breaks it): `home-submit`, `tab-create` / `tab-join`, `room-list`,
  `join-submit`, `room` (`data-status`, `data-round`, `data-version`), `room-code`, `leave`, `lobby-players`, `ready`,
  `start-game`, `rules-panel`, `rule-<key>` selects, `my-hand` (buttons `data-card`, `data-legal`), `play-selected`,
  `suit-picker`, `suit-S|H|D|C`, `pile` (`data-top`), `chosen-suit`, `draw`, `take`, `sit`, `pass`, `macao`, `catch`,
  `seat` (`data-player-id`, `data-turn`, `data-count`), `game-status`, `game-log`, `finished-panel`, `new-round`,
  `back-to-lobby`, `spectator-list`, `spectator-status`, `queue-toggle`.
