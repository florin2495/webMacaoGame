// End-to-end test of the Macao API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /macao]
// Plain Node 20+ fetch, no dependencies. Run by .github/workflows/e2e.yml against the deployed site.
// Every room is named e2e-test-... (never counted on the hub leaderboard) and removed at the end: everyone leaves,
// then leftovers are deleted in the DB with the service key (env NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, else .env.local). Never sends feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

// The game's own Vercel domain. Production is https://games.hailatat.icu/macao (the hub proxies /macao/* here);
// the default stays on the Vercel domain until the hub zone is known to serve it - pass the hub URL as argv[2]
// (the E2E workflow does, via its base_url input).
const VERCEL = "https://015web-macao-game.vercel.app/macao";
const BASE = (process.argv[2] ?? VERCEL).replace(/\/$/, "");
const ORIGIN = new URL(BASE).origin;
const BASE_PATH = new URL(BASE).pathname;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, {
    method: method ?? (body !== undefined ? "POST" : "GET"),
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const LOCAL = /^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE);
const envFile = () => {
  try {
    return Object.fromEntries(
      readFileSync(new URL("../.env.local", import.meta.url), "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    );
  } catch {
    return {};
  }
};
/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return envFile();
}
const HAS_KEY = () => !!(supabaseEnv().NEXT_PUBLIC_SUPABASE_URL && supabaseEnv().SUPABASE_SERVICE_ROLE_KEY);
// A local server reports to a throwaway leaderboard game (LEADERBOARD_GAME in .env.local), never to "macao".
// Against the deployed site the game is "macao"; test rooms (e2e-test-*) must never be reported there.
const LB_GAME = LOCAL ? envFile().LEADERBOARD_GAME : "macao";
async function rest(path, init = {}) {
  const env = supabaseEnv();
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  const res = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/${path}`, { ...init, headers: { apikey: key, authorization: `Bearer ${key}` } });
  return res.status === 204 ? [] : res.json();
}
const lbRows = (roomCode) => rest(`hub_leaderboard_rounds?game=eq.${LB_GAME}&room_code=eq.${roomCode}`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const roomName = (tag) => `e2e-test-${tag}-${Date.now().toString(36)}`.slice(0, 40);
const pick = (items) => items[Math.floor(Math.random() * items.length)];

// Minimal copy of the rules (src/lib/macao.ts), to check the server's card effects.
const SUITS = ["S", "H", "D", "C"];
const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"];
const DECK = [...SUITS.flatMap((s) => RANKS.map((r) => `${r}${s}`)), "XB", "XR"];
const isJoker = (c) => c === "XB" || c === "XR";
const rankOf = (c) => (isJoker(c) ? "X" : c.slice(0, -1));
function kindOf(c, rules) {
  const r = rankOf(c);
  if (r === "X" || r === "2" || r === "3") return "draw";
  if (r === rules.stopRank) return "stop";
  if (r === rules.skipRank) return "skip";
  if (r === rules.changeRank) return "change";
  return "plain";
}
const drawValue = (c, rules) => (c === "XB" ? rules.jokerBlackDraw : c === "XR" ? rules.jokerRedDraw : rankOf(c) === "2" ? 2 : rankOf(c) === "3" ? 3 : 0);
const deckSize = (rules) => (rules.jokers ? 54 : 52);
/** Same rules, whatever the key order (jsonb reorders keys). */
const sameRules = (a, b) => !!a && !!b && Object.keys({ ...a, ...b }).every((k) => a[k] === b[k]);
const sorted = (cards) => JSON.stringify([...cards].sort());
/** Short deals for the test: 4 cards each, first out wins, small penalties. Stop back on 4 swaps skip back to A. */
const QUICK = { handSize: 4, roundEnd: "first", stopRank: "4", jokerBlackDraw: 3, jokerRedDraw: 4, macaoPenalty: 2 };

async function states(code, players) {
  const res = await Promise.all(players.map((p) => call(`/api/rooms/${code}/state`, { token: p.token })));
  const out = {};
  res.forEach((r, i) => {
    if (r.status !== 200) throw new Error(`state ${players[i].name}: ${r.status} ${r.data.error}`);
    out[players[i].playerId] = r.data;
  });
  return out;
}

/**
 * One snapshot of everybody's state: only own hand visible, same public table for everyone, hands never overlap
 * (nor with the visible pile), nobody can act out of turn, and the cards add up (hands + stock + played = deck,
 * the pile shows the last min(5, played) of them). Returns the problems and the counts for the next step.
 */
function table(all, players) {
  const problems = [];
  const ref = all[players[0].playerId];
  const g0 = ref.game;
  const pub = (g) => JSON.stringify([g.turn, g.pile, g.suit, g.pendingDraw, g.pendingSkip, g.handCounts, g.stockCount, g.finished, g.macao, g.moves]);
  const seen = new Set(g0.pile);
  for (const p of players) {
    const s = all[p.playerId];
    const g = s.game;
    if (/"(hands|stock|discard|deal|token_hash|device_hash|password_hash|token)"/.test(JSON.stringify(s))) problems.push(`${p.name}'s state leaks private fields`);
    if (s.room.version !== ref.room.version || pub(g) !== pub(g0)) problems.push(`${p.name} sees a different table`);
    if (g.hand.length !== g.handCounts[p.playerId]) problems.push(`${p.name}: hand ${g.hand.length} != count ${g.handCounts[p.playerId]}`);
    for (const c of g.hand) {
      if (seen.has(c)) problems.push(`card ${c} seen twice`);
      seen.add(c);
    }
    if (g.turn !== p.playerId && (g.legal.length || g.canDraw || g.canPass || g.canTake || g.canSit || g.drawn)) problems.push(`${p.name} can act out of turn`);
  }
  const inHands = Object.values(g0.handCounts).reduce((a, b) => a + b, 0);
  const played = deckSize(g0.rules) - inHands - g0.stockCount;
  if (played < 1) problems.push(`hands ${inHands} + stock ${g0.stockCount} > ${deckSize(g0.rules)}`);
  if (g0.pile.length !== Math.min(5, played)) problems.push(`pile shows ${g0.pile.length} cards, ${played} played`);
  if (ref.room.status === "playing" && g0.finished.includes(g0.turn)) problems.push("a player out of cards is on turn");
  return { problems, handsAndStock: inHands + g0.stockCount, played };
}

/** What the player on turn does: a random legal card (with its twins sometimes), else take / sit / pass / draw. */
function chooseMove(g) {
  const r = g.rules;
  const playOf = (card, withTwins) => {
    let cards = [card];
    if (withTwins && r.multiPlay && !g.drawn) {
      cards.push(...g.hand.filter((c) => c !== card && rankOf(c) === rankOf(card)));
      if (!r.finishOnSpecial && cards.length === g.hand.length && kindOf(card, r) !== "plain") cards = [card];
    }
    // The single-card form { card } is accepted too: use it now and then.
    const body = cards.length === 1 && Math.random() < 0.25 ? { card } : { cards };
    if (kindOf(card, r) === "change") body.suit = pick(SUITS);
    return { route: "play", type: "play", body, cards };
  };
  const twins = () => Math.random() < 0.5;
  if (g.drawn) return g.legal.includes(g.drawn) && Math.random() < 0.7 ? playOf(g.drawn, false) : { route: "pass", type: "pass" };
  if (g.canTake) return g.legal.length && Math.random() < 0.6 ? playOf(pick(g.legal), twins()) : { route: "take", type: "take" };
  if (g.canSit) return g.legal.length && Math.random() < 0.5 ? playOf(pick(g.legal), twins()) : { route: "sit", type: "sit" };
  if (g.legal.length && (Math.random() < 0.9 || !g.canDraw)) return playOf(pick(g.legal), twins());
  if (g.canDraw) return { route: "draw", type: "draw" };
  return null;
}

/**
 * Plays the running deal to its end through the API. Every step reads everybody's /state, checks the table
 * (see table()), the version going up, the cards moved by the step and the effect of the cards played.
 * Now and then says "Macao" (2 cards or less) and catches a player left with one card who did not say it.
 */
async function playDeal(code, players, { maxMoves = 300, noSuitTested = false } = {}) {
  const byId = Object.fromEntries(players.map((p) => [p.playerId, p]));
  const refId = players[0].playerId;
  const problems = [];
  const bad = (msg) => problems.push(msg);
  const stats = { moves: 0, play: 0, cards: 0, draw: 0, pass: 0, take: 0, sit: 0, macao: 0, catch: 0 };
  const tested = { noSuit: noSuitTested, drawInPenalty: false, finishedMacao: false };
  let playedOnAfterOut = false;
  let all = await states(code, players);
  let snap = table(all, players);
  problems.push(...snap.problems);
  const act = (route, p, body = {}) => call(`/api/rooms/${code}/${route}`, { token: p.token, body });

  while (all[refId].room.status === "playing" && stats.moves < maxMoves) {
    const g = all[refId].game;
    const version = all[refId].room.version;
    const p = byId[g.turn];
    const mine = all[p.playerId].game;
    const r = mine.rules;
    const before = mine.handCounts[p.playerId];

    // A player already out of cards (round end "last") cannot say "Macao".
    if (!tested.finishedMacao && g.finished.length > 0) {
      tested.finishedMacao = true;
      const m = await act("macao", byId[g.finished[0]]);
      if (m.status !== 409) bad(`macao by a player out of cards: ${m.status}, expected 409`);
    }

    let action;
    const targets = players.filter((q) => g.handCounts[q.playerId] === 1 && !g.macao[q.playerId] && !g.finished.includes(q.playerId));
    const catchers = players.filter((q) => !targets.includes(q));
    if (r.macao && targets.length && catchers.length && Math.random() < 0.6) {
      action = { who: pick(catchers), route: "catch", type: "catch", targets: targets.map((q) => q.playerId) };
    } else if (r.macao && before <= 2 && !mine.macao[p.playerId] && Math.random() < 0.4) {
      action = { route: "macao", type: "macao" };
    } else {
      action = chooseMove(mine);
      if (!action) {
        bad(`${p.name} on turn has nothing to do (${JSON.stringify({ legal: mine.legal, canDraw: mine.canDraw })})`);
        break;
      }
    }

    // Rejected moves, once each: draw while cards are to be drawn, change-suit card without a suit.
    if (action.type !== "catch" && mine.canTake && !tested.drawInPenalty) {
      tested.drawInPenalty = true;
      const d = await act("draw", p);
      if (d.status !== 409) bad(`draw with ${mine.pendingDraw} cards to take: ${d.status}, expected 409`);
    }
    if (action.type === "play" && action.body.suit && !tested.noSuit) {
      tested.noSuit = true;
      const ns = await act("play", p, { cards: action.cards });
      if (ns.status !== 409) bad(`change-suit card ${action.cards[0]} without a suit: ${ns.status}, expected 409`);
    }

    const who = action.who ?? p;
    const res = await act(action.route, who, action.body ?? {});
    if (res.status !== 200) {
      bad(`${action.type} by ${who.name} ${JSON.stringify(action.body ?? {})} failed: ${res.status} ${res.data.error}`);
      break;
    }
    stats.moves++;
    stats[action.type]++;
    if (action.type === "play") stats.cards += action.cards.length;
    const prevSnap = snap;
    all = await states(code, players);
    snap = table(all, players);
    const tag = `move ${stats.moves} (${who.name} ${action.type}${action.cards ? " " + action.cards.join("+") : ""})`;
    problems.push(...snap.problems.map((m) => `${tag}: ${m}`));
    const ng = all[refId].game;
    const after = ng.handCounts[p.playerId];
    if (all[refId].room.version <= version) bad(`${tag}: version did not go up`);
    if (all[refId].room.status === "playing" && ng.finished.length > 0 && g.finished.length === 0) playedOnAfterOut = true;

    // Cards moved by the step: a play moves k cards to the pile; draws may reshuffle the pile into the stock.
    const delta = snap.handsAndStock - prevSnap.handsAndStock;
    if (action.type === "play") {
      if (delta !== -action.cards.length) bad(`${tag}: hands+stock changed by ${delta}`);
    } else if (["draw", "take", "catch"].includes(action.type)) {
      if (delta !== 0 && snap.played !== 1) bad(`${tag}: hands+stock changed by ${delta} without a reshuffle`);
    } else if (delta !== 0) bad(`${tag}: hands+stock changed by ${delta}`);

    switch (action.type) {
      case "play": {
        const k = action.cards.length;
        const kind = kindOf(action.cards[0], r);
        if (after !== before - k || action.cards.some((c) => all[p.playerId].game.hand.includes(c))) bad(`${tag}: cards not removed from the hand`);
        if (sorted(ng.pile.slice(-k)) !== sorted(action.cards)) bad(`${tag}: pile top ${ng.pile.join(",")}`);
        if (after === 0 && !ng.finished.includes(p.playerId)) bad(`${tag}: out of cards but not finished`);
        if (kind === "draw") {
          const add = action.cards.reduce((s, c) => s + drawValue(c, r), 0);
          if (ng.pendingDraw !== g.pendingDraw + add) bad(`${tag}: pendingDraw ${g.pendingDraw} -> ${ng.pendingDraw}, expected +${add}`);
        } else if (kind === "skip") {
          if (ng.pendingSkip !== g.pendingSkip + k) bad(`${tag}: pendingSkip ${g.pendingSkip} -> ${ng.pendingSkip}, expected +${k}`);
        } else if (kind === "stop") {
          if (ng.pendingDraw !== 0 || ng.pendingSkip !== 0) bad(`${tag}: stop card did not cancel the penalty`);
        } else if (kind === "change") {
          if (ng.suit !== action.body.suit) bad(`${tag}: suit ${ng.suit}, chosen ${action.body.suit}`);
        } else if (ng.pendingDraw !== 0 || ng.pendingSkip !== 0 || ng.suit !== null) bad(`${tag}: plain card left a penalty or a suit`);
        break;
      }
      case "draw": {
        const mineNow = all[p.playerId].game;
        if (after !== before + 1 && !(after === before && ng.stockCount === 0)) bad(`${tag}: ${before} -> ${after} cards`);
        if (mineNow.drawn && (ng.turn !== p.playerId || !mineNow.canPass || JSON.stringify(mineNow.legal) !== JSON.stringify([mineNow.drawn]))) {
          bad(`${tag}: drawn card that fits: should stay on turn with only that card playable`);
        }
        break;
      }
      case "take":
        if (after !== before + g.pendingDraw && ng.stockCount !== 0) bad(`${tag}: took ${after - before}, expected ${g.pendingDraw}`);
        if (ng.pendingDraw !== 0) bad(`${tag}: penalty still pending`);
        break;
      case "sit":
        if (ng.pendingSkip !== 0) bad(`${tag}: skip still pending`);
        break;
      case "pass":
        if (all[p.playerId].game.drawn !== null || after !== before) bad(`${tag}: pass should keep the drawn card and end the turn`);
        break;
      case "macao":
        if (ng.macao[p.playerId] !== true) bad(`${tag}: macao not recorded`);
        break;
      case "catch":
        if (ng.turn !== g.turn) bad(`${tag}: catch changed the turn`);
        for (const t of action.targets) {
          const cnt = ng.handCounts[t];
          if (cnt !== 1 + r.macaoPenalty && ng.stockCount !== 0) bad(`${tag}: ${byId[t].name} has ${cnt} cards, expected ${1 + r.macaoPenalty}`);
        }
        break;
    }
  }
  const s = all[refId];
  check(s.room.status === "finished", `deal ended within ${maxMoves} moves (${stats.moves} moves)`);
  console.log(
    `    ${stats.play} plays (${stats.cards} cards), ${stats.draw} draws, ${stats.pass} passes, ${stats.take} takes, ` +
      `${stats.sit} sit-outs, ${stats.macao} "Macao", ${stats.catch} catches`,
  );
  if (!tested.drawInPenalty) console.log("    (draw while cards are to be taken: no penalty reached in this deal)");
  if (!tested.noSuit) console.log("    (change-suit card without suit: no change-suit card played in this deal)");
  check(problems.length === 0, `every step: own hand only, same table for all, cards conserved, version up, card effects right${problems.length ? ` - ${problems.length} problem(s): ${problems.slice(0, 5).join(" | ")}` : ""}`);
  return { moves: stats.moves, all, playedOnAfterOut };
}

/** End of a deal: winner, standings (places), wins and score. `start` = a state from before the deal. */
function checkResult(all, players, start) {
  const s = all[players[0].playerId];
  const g = s.game;
  const r = s.result;
  check(s.room.status === "finished" && !!r && g.turn === null, "deal finished, nobody on turn");
  if (!r) return null;
  const name = (id) => players.find((p) => p.playerId === id)?.name ?? id;
  check(!r.aborted && !!r.winner && r.winner === g.finished[0], `winner = first player out (${name(r.winner)})`);
  check(
    r.standings.length === players.length && r.standings.every((x) => x.cardsLeft === g.handCounts[x.playerId]),
    "standings list everyone with the cards left in hand",
  );
  const w = r.standings.find((x) => x.playerId === r.winner);
  check(w?.place === 1 && w.cardsLeft === 0, "winner: place 1, 0 cards left");
  const notOut = r.standings.filter((x) => !g.finished.includes(x.playerId));
  const expPlace = (x) =>
    g.finished.includes(x.playerId) ? g.finished.indexOf(x.playerId) + 1 : g.finished.length + 1 + notOut.filter((y) => y.cardsLeft < x.cardsLeft).length;
  check(
    r.standings.every((x) => x.place === expPlace(x)),
    `places: out of cards in order, then fewest cards, ties share (${r.standings.map((x) => `${name(x.playerId)} ${x.place}/${x.cardsLeft}`).join(", ")})`,
  );
  const prev = Object.fromEntries(start.players.map((p) => [p.id, p]));
  const left = (id) => r.standings.find((x) => x.playerId === id)?.cardsLeft ?? 0;
  check(s.players.every((p) => p.wins === prev[p.id].wins + (p.id === r.winner ? 1 : 0)), "winner's wins +1, the others unchanged");
  check(s.players.every((p) => p.score === prev[p.id].score + left(p.id)), `everyone's score grew by their cards left (${s.players.map((p) => p.score).join("-")})`);
  check(players.every((p) => all[p.playerId].game.legal.length === 0 && !all[p.playerId].game.canDraw), "nobody can move after the end");
  return r;
}

async function httpChecks() {
  console.log("HTTP");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200 && html.includes("Macao"), `page 200 (${page.status})`);
  // The settings panel (with the version) is only on the room page: collect the chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/ABCDEF`)).text();
  const assets = [...new Set((html + roomHtml).match(new RegExp(`${BASE_PATH}/_next/static/[^"'\\\\]+\\.(?:js|css)`, "g")) ?? [])];
  const assetStatus = await Promise.all(assets.map(async (a) => (await fetch(ORIGIN + a)).status));
  check(assets.length > 0 && assetStatus.every((x) => x === 200), `${assets.length} ${BASE_PATH}/_next assets, all 200`);
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of assets.filter((x) => x.endsWith(".js"))) if ((await (await fetch(ORIGIN + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version}`);
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === "/macao/", "manifest 200, start_url /macao/");
  let iconsOk = true;
  for (const src of [...(manifest?.icons ?? []).map((i) => i.src), "/macao/icons/180", "/macao/favicon.ico"]) {
    const r = await fetch(ORIGIN + src);
    if (r.status !== 200 || !/image/.test(r.headers.get("content-type") ?? "")) iconsOk = false;
  }
  check(iconsOk, "icons + favicon 200 image/*");
  check((await fetch(`${BASE}/room/ABCDEF`)).status === 200, "GET /macao/room/ABCDEF 200");
  check((await call("/api/rooms/ABCDEF/state", { token: "x" })).status === 404, "unknown room state = 404");
  if (!LOCAL && BASE !== VERCEL) {
    const v = await fetch(VERCEL);
    const vhtml = await v.text();
    const vAssets = vhtml.match(/\/macao\/_next\/static\/[^"']+\.js/g) ?? [];
    check(v.status === 200 && vAssets.length > 0 && vAssets.some((a) => html.includes(a)), `${VERCEL} serves the same build`);
  } else if (!LOCAL) console.log("  (same-build check skipped: the base URL is the Vercel domain itself)");
}

async function main() {
  console.log(`E2E against ${BASE}`);
  if (LOCAL && (!LB_GAME || LB_GAME === "macao")) throw new Error("Set LEADERBOARD_GAME=macao-test in .env.local first: the shared DB holds the real leaderboard.");
  await httpChecks();

  console.log("Create, list, join (3 players, password)");
  const dev = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID() };
  const r = await call("/api/rooms", { body: { name: roomName("main"), nickname: "Ana", password: "pw", deviceId: dev.A } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  const P = (route, p, body = {}) => call(`/api/rooms/${code}/${route}`, { token: p?.token, body });
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname, deviceId) => ({ ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId } })).data, name: nickname });
  let B = await join("Bob", dev.B);
  const C = await join("Cris", dev.C);
  check(!!B.token && !!C.token, "Bob and Cris joined");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: dev.D } })).status === 409, "nickname of a connected seat from another device = 409");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "x".repeat(13), password: "pw" } })).status === 400, "13-char nickname = 400");
  const list = await call("/api/rooms");
  const item = list.data.rooms?.find((x) => x.code === code);
  check(item?.hasPassword && item.players === 3 && item.status === "lobby" && item.spectators === 0, "room in public list: lobby, with password, 3 players, 0 spectators");
  check(!!item && !("teams" in item), "list item has no teams field");
  check(!/scrypt|password_hash/.test(JSON.stringify(list.data)), "list does not leak the password hash");

  console.log("Rejoin with the same device");
  const B2 = await join("Bob", dev.B);
  check(B2.playerId === B.playerId && B2.token !== B.token, "same seat, new token");
  check((await call(`/api/rooms/${code}/state`, { token: B.token })).status === 401, "old token = 401");
  B = { ...B2, name: "Bob" };

  console.log("House rules (host, lobby)");
  for (const p of [A, B, C]) await P("ready", p, { ready: true });
  check((await P("settings", B, { rules: { handSize: 7 } })).status === 403, "non-host settings = 403");
  check((await P("settings", A, {})).status === 400, "settings without rules = 400");
  const set1 = await P("settings", A, { rules: { handSize: 7, roundEnd: "last", stopRank: "A" } });
  const r1 = set1.data.rules;
  check(set1.status === 200 && set1.data.ok === true && r1?.handSize === 7 && r1.roundEnd === "last", "host sets 7 cards, round end 'last'");
  check(r1?.stopRank === "A" && r1.skipRank === "4", "stop card A takes the skip card's rank: skip swapped to 4");
  let s = (await call(`/api/rooms/${code}/state`, { token: B.token })).data;
  check(sameRules(s.room?.rules, r1), "/state room.rules = the saved rules (seen by Bob)");
  check(s.players.length === 3 && s.players.every((p) => !p.ready), "changing the rules reset everyone's ready");
  check(!("teams" in s.room) && s.players.every((p) => !("team" in p) && p.wins === 0 && p.score === 0), "no teams, wins and score 0");
  const set2 = await P("settings", A, { rules: { handSize: 99, roundEnd: "never", macaoPenalty: "x", jokers: "yes", bogus: 1 } });
  const r2 = set2.data.rules;
  check(
    set2.status === 200 &&
      [4, 5, 6, 7].includes(r2?.handSize) &&
      ["first", "last"].includes(r2.roundEnd) &&
      [1, 2, 3, 4, 5].includes(r2.macaoPenalty) &&
      typeof r2.jokers === "boolean" &&
      !("bogus" in r2),
    "bad values normalized to valid ones, unknown key dropped",
  );
  check(r2?.stopRank === "A" && r2.skipRank === "4", "rules left out of the change are kept");
  const set3 = await P("settings", A, { rules: QUICK });
  const RULES = set3.data.rules;
  check(set3.status === 200 && Object.entries(QUICK).every(([k, v]) => RULES?.[k] === v), "quick rules for the test deals (4 cards, first out wins)");
  check(RULES?.skipRank === "A" && RULES.jokers === true && RULES.multiPlay === true && RULES.macao === true, "stop back on 4 swaps skip back to A; jokers, multi-play and Macao on");

  console.log("Ready and start");
  check((await P("start", A)).status === 409, "start with players not ready = 409");
  for (const p of [A, B, C]) await P("ready", p, { ready: true });
  check((await P("start", B)).status === 403, "non-host start = 403");
  check((await P("start", A)).status === 200, "host starts");
  check((await P("settings", A, { rules: { handSize: 5 } })).status === 409, "settings while playing = 409");
  check((await P("ready", A, { ready: false })).status === 409, "ready while playing = 409");
  let all = await states(code, [A, B, C]);
  s = all[A.playerId];
  const start1 = s;
  check(s.room.status === "playing" && s.game.turn === A.playerId && s.game.order[0] === A.playerId, "host starts round 1");
  check(
    [A, B, C].every((p) => all[p.playerId].game.hand.length === 4) && s.game.stockCount === 54 - 12 - 1 && s.game.pile.length === 1,
    "54 cards with jokers: 4 each, 1 turned up, 41 in the stock",
  );
  check(kindOf(s.game.pile[0], RULES) === "plain" && s.game.pendingDraw === 0 && s.game.pendingSkip === 0 && s.game.suit === null, `first card on the table is a plain one (${s.game.pile[0]})`);
  check(sameRules(s.game.rules, RULES) && sameRules(s.room.rules, RULES), "the deal uses the room's rules");
  const t0 = table(all, [A, B, C]);
  check(t0.problems.length === 0, `each player sees only own hand, same table for all, cards add up${t0.problems.length ? ": " + t0.problems.join(" | ") : ""}`);

  console.log("Illegal moves");
  const gA = all[A.playerId].game;
  const gB = all[B.playerId].game;
  const v0 = s.room.version;
  check((await P("play", B, { cards: [gB.hand[0]] })).status === 409, "play out of turn = 409");
  check((await P("draw", B)).status === 409, "draw out of turn = 409");
  check((await P("play", A, { cards: [DECK.find((c) => !gA.hand.includes(c))] })).status === 409, "card not in hand = 409");
  const unfit = gA.hand.find((c) => !gA.legal.includes(c));
  if (unfit) check((await P("play", A, { cards: [unfit] })).status === 409, `card that does not fit (${unfit} on ${gA.pile[0]}) = 409`);
  const mixed = gA.hand.find((c) => rankOf(c) !== rankOf(gA.hand[0]));
  if (mixed) check((await P("play", A, { cards: [gA.hand[0], mixed] })).status === 409, "two ranks at once = 409");
  check((await P("play", A, { cards: [gA.hand[0], gA.hand[0]] })).status === 409, "same card twice = 409");
  check((await P("play", A, { card: "1Z" })).status === 400, "malformed card = 400");
  check((await P("play", A, { cards: [] })).status === 400, "no cards = 400");
  const raw = await fetch(`${BASE}/api/rooms/${code}/play`, { method: "POST", headers: { "x-player-token": A.token, "content-type": "application/json" }, body: "{not json" });
  check(raw.status === 400, "body that is not JSON = 400");
  check((await call(`/api/rooms/${code}/play`, { token: "bogus-token", body: { cards: [gA.hand[0]] } })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/play`, { body: { cards: [gA.hand[0]] } })).status === 401, "no token = 401");
  check((await P("pass", A)).status === 409, "pass without having drawn = 409");
  check((await P("take", A)).status === 409, "take with no cards to take = 409");
  check((await P("sit", A)).status === 409, "sit with no turn to sit out = 409");
  check((await P("macao", A)).status === 409, "macao with 4 cards = 409");
  check((await P("catch", B)).status === 409, "catch when nobody is catchable = 409");
  const change = gA.legal.find((c) => kindOf(c, RULES) === "change");
  if (change) check((await P("play", A, { cards: [change] })).status === 409, `change-suit card ${change} without a suit = 409`);
  else console.log("  (change-suit card without suit: none legal in this hand, tried during the deal)");
  check((await P("skip", B)).status === 403, "non-host skip = 403");
  check(gB.legal.length === 0 && !gB.canDraw && !gB.canTake && !gB.canSit && !gB.canPass, "player not on turn: no legal cards, no actions");
  check(gA.canDraw && !gA.canPass && !gA.canTake && !gA.canSit && gA.drawn === null, "player on turn can draw; nothing to pass, take or sit");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.version === v0 && sorted(s.game.hand) === sorted(gA.hand), "rejected moves changed nothing");

  console.log("Draw (and pass)");
  const d = await P("draw", A);
  const dg = d.data.game;
  check(d.status === 200 && dg?.handCounts[A.playerId] === 5 && dg.hand.length === 5 && dg.stockCount === 40, "draw: one card from the stock into the hand");
  if (dg?.drawn) {
    check(dg.turn === A.playerId && dg.canPass && !dg.canDraw && JSON.stringify(dg.legal) === JSON.stringify([dg.drawn]), `drawn ${dg.drawn} fits: still on turn, only it is playable`);
    check((await P("draw", A)).status === 409, "second draw = 409");
    const ps = await P("pass", A);
    check(ps.status === 200 && ps.data.game?.turn !== A.playerId && ps.data.game.drawn === null && ps.data.game.hand.length === 5, "pass keeps the card, turn moves on");
  } else check(dg?.turn !== A.playerId, "drawn card does not fit: turn moves on");

  console.log("Spectator joins a running deal");
  const specJoin = await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw", deviceId: dev.D } });
  check(specJoin.status === 200 && !!specJoin.data.token, "joining a running deal = spectator (200)");
  const D = { ...specJoin.data, name: "Dan" };
  const sp = (await call(`/api/rooms/${code}/state`, { token: D.token })).data;
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(sp.me?.role === "spectator" && sp.game.hand.length === 0 && sp.game.legal.length === 0 && !sp.game.canDraw, "spectator has no hand and no legal cards");
  check(!/"(hands|stock|discard|deal|token_hash|device_hash)"/.test(JSON.stringify(sp)) && sp.game.stockCount === s.game.stockCount, "spectator state leaks nothing private");
  check(sp.players.length === 3 && sp.spectators.length === 1, "spectator not counted among the players");
  const list2 = await call("/api/rooms");
  check(
    list2.data.rooms?.some((x) => x.code === code && x.status === "playing" && x.players === 3 && x.spectators === 1),
    "running room still listed: status playing, 3 players, 1 spectator",
  );
  const spec403 = [];
  for (const [route, body] of [["play", { cards: [sp.game.pile[0]] }], ["draw", {}], ["macao", {}], ["catch", {}], ["take", {}], ["ready", { ready: true }]]) {
    spec403.push((await P(route, D, body)).status === 403);
  }
  check(spec403.every(Boolean), "spectator cannot play, draw, macao, catch, take or ready (403)");
  check((await P("reorder", A, { order: [A.playerId, B.playerId, C.playerId] })).status === 409, "reorder mid-deal = 409");
  check((await P("queue", A)).status === 409, "player cannot queue (409)");
  check((await P("queue", D)).data.queued === true, "Dan queues for next round");
  check((await P("queue", D)).data.queued === false, "queue toggles off");
  check((await P("queue", D)).data.queued === true, "queue toggles on");
  const specRejoin = await call(`/api/rooms/${code}/join`, { body: { nickname: "Dan", password: "pw", deviceId: dev.D } });
  check(specRejoin.status === 200 && specRejoin.data.playerId === D.playerId, "spectator rejoin keeps the seat");
  D.token = specRejoin.data.token;

  console.log("Kick with Ignoră");
  check((await P("kick", B, { playerId: C.playerId })).status === 403, "non-host kick = 403");
  check((await P("kick", A, { playerId: C.playerId })).data.pending === true, "kick in game is pending");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).data.me?.kickRemainingMs > 0, "kicked player sees the countdown");
  check((await P("kick/ignore", C)).status === 200, "Ignoră");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).data.me?.kickRemainingMs === null, "kick cleared");

  console.log("Host plays for a player");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  const onTurn = s.game.turn;
  const cnt = s.game.handCounts[onTurn];
  const vSkip = s.room.version;
  check((await P("skip", A)).status === 200, "skip (joacă pentru el)");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(
    s.room.version > vSkip && s.game.turn !== onTurn && [cnt - 1, cnt + 1].includes(s.game.handCounts[onTurn]),
    `a full turn was made for ${[A, B, C].find((p) => p.playerId === onTurn)?.name} (played or drew one card), turn moved on`,
  );

  console.log("Full deal, 3 players (round end 'first')");
  const d1 = await playDeal(code, [A, B, C], { maxMoves: 300, noSuitTested: !!change });
  checkResult(d1.all, [A, B, C], start1);
  check((await P("play", A, { cards: ["7S"] })).status === 409, "play after the end = 409");
  check((await P("draw", A)).status === 409, "draw after the end = 409");

  console.log("Leaderboard: test rooms are never reported");
  if (HAS_KEY() && LB_GAME) {
    const rows = await lbRows(code);
    check(Array.isArray(rows) && rows.length === 0, `no hub_leaderboard_rounds row for the e2e-test room (game ${LB_GAME})`);
  } else console.log("  (skipped: needs the DB service key)");

  console.log("Reorder (host, between rounds)");
  const ids3 = [A.playerId, B.playerId, C.playerId];
  const newOrder = [C.playerId, A.playerId, B.playerId];
  check((await P("reorder", B, { order: newOrder })).status === 403, "non-host reorder = 403");
  check((await P("reorder", A, { order: [A.playerId, B.playerId] })).status === 400, "incomplete order = 400");
  check((await P("reorder", A, { order: [A.playerId, A.playerId, B.playerId] })).status === 400, "duplicate in order = 400");
  check((await P("reorder", A, { order: [...ids3, D.playerId] })).status === 400, "spectator in order = 400");
  check((await P("reorder", A, { order: newOrder })).status === 200, "host reorders");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(JSON.stringify(s.players.map((p) => p.id)) === JSON.stringify(newOrder), "players listed in the saved order");

  console.log("New round: Dan is promoted from the queue");
  check((await P("new-round", B)).status === 403, "non-host new round = 403");
  check((await P("new-round", A)).status === 200, "host new round");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "playing" && s.room.round === 2 && s.players.length === 4 && s.spectators.length === 0, "round 2 with 4 players, no spectators");
  check(JSON.stringify(s.game.order) === JSON.stringify([...newOrder, D.playerId]), "saved order kept, Dan appended last");
  check(s.game.turn === s.game.order[1], "round 2: next seat starts");
  check(s.game.stockCount === 54 - 16 - 1, "4 players: 16 cards dealt, 37 in the stock");
  const dState = (await call(`/api/rooms/${code}/state`, { token: D.token })).data;
  check(dState.game.hand.length === 4 && dState.me.role === "player" && dState.me.wins === 0 && dState.me.score === 0, "Dan is a player now: has a hand, wins and score 0");

  console.log("Leave mid-deal");
  const tally = (players) => JSON.stringify(players.map((p) => [p.id, p.wins, p.score]).sort());
  const scoresBefore = tally(s.players.filter((p) => p.id !== C.playerId));
  check((await P("leave", C)).status === 200, "Cris leaves");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "finished" && s.result?.aborted?.nickname === "Cris" && s.result.winner === null, "deal cancelled, no winner");
  check(tally(s.players) === scoresBefore, "a cancelled deal changes no wins or score");
  check((await call(`/api/rooms/${code}/state`, { token: C.token })).status === 401, "Cris's token no longer works");

  console.log("Back to lobby, round end 'last' (3 players)");
  check((await P("lobby", A)).status === 200, "host back to lobby");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.room.status === "lobby" && s.players.length === 3 && s.players.every((p) => !p.ready) && s.game === null && s.result === null, "lobby: 3 players, nobody ready, no deal");
  const setLast = await P("settings", A, { rules: { roundEnd: "last" } });
  check(setLast.status === 200 && setLast.data.rules?.roundEnd === "last" && setLast.data.rules.handSize === 4, "host switches to round end 'last' (other rules kept)");
  const byId = { [A.playerId]: A, [B.playerId]: B, [D.playerId]: D };
  const trio = s.players.map((p) => byId[p.id]);
  for (const p of trio) await P("ready", p, { ready: true });
  check((await P("start", A)).status === 200, "host starts");
  all = await states(code, trio);
  const start3 = all[A.playerId];
  check(start3.game.stockCount === 54 - 12 - 1 && start3.game.rules.roundEnd === "last", "3 players, 4 cards each, round end 'last'");
  const d3 = await playDeal(code, trio, { maxMoves: 400 });
  const r3 = checkResult(d3.all, trio, start3);
  if (r3) {
    check(d3.playedOnAfterOut && d3.all[A.playerId].game.finished.length === 2, "the round went on after the first player was out, until one was left");
    const places = r3.standings.map((x) => x.place).sort();
    const lastOne = r3.standings.find((x) => x.place === 3);
    check(JSON.stringify(places) === "[1,2,3]" && lastOne?.cardsLeft > 0, "standings: 3 distinct places, the last one still holds cards");
  }
  if (HAS_KEY() && LB_GAME) {
    const rows = await lbRows(code);
    check(Array.isArray(rows) && rows.length === 0, "still no hub_leaderboard_rounds row for the e2e-test room");
  }

  console.log("Kicks, 6 players in the lobby, host hand-over");
  check((await P("kick", A, { playerId: A.playerId })).status === 400, "host cannot kick self");
  check((await P("kick", A, { playerId: "not-a-uuid" })).status === 404, "kick unknown player = 404");
  check((await P("lobby", A)).status === 200, "host back to lobby");
  const C2 = await join("Cris", dev.C);
  const E = await join("Eva", randomUUID());
  const F = await join("Filip", randomUUID());
  check(!!C2.token && !!E.token && !!F.token, "Cris, Eva and Filip join");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  check(s.players.length === 6 && s.spectators.length === 0, "6 players seated (the maximum)");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Gia", password: "pw" } })).status === 409, "7th player in the lobby = 409 (full)");
  const kickF = await P("kick", A, { playerId: F.playerId });
  check(kickF.status === 200 && !kickF.data.pending, "host kicks Filip in the lobby (immediate)");
  check((await call(`/api/rooms/${code}/state`, { token: F.token })).status === 401, "Filip is out");
  s = (await call(`/api/rooms/${code}/state`, { token: A.token })).data;
  const nextHost = s.players.find((p) => p.id !== A.playerId)?.id;
  check((await P("leave", A)).status === 200, "host leaves");
  const remaining = [B, D, C2, E];
  const restById = Object.fromEntries(remaining.map((p) => [p.playerId, p]));
  s = (await call(`/api/rooms/${code}/state`, { token: restById[nextHost].token })).data;
  check(s.room?.hostPlayerId === nextHost && s.me?.isHost === true, `host passes to the next seat (${restById[nextHost]?.name})`);
  for (const p of remaining.slice(0, -1)) await P("leave", p);
  const last = await P("leave", remaining[remaining.length - 1]);
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);

  console.log("2 players, no password, pending kick enforced");
  const r4 = await call("/api/rooms", { body: { name: roomName("duo"), nickname: "Ion" } });
  const code4 = r4.data.code;
  created.add(code4);
  const I = { ...r4.data, name: "Ion" };
  const J = { ...(await call(`/api/rooms/${code4}/join`, { body: { nickname: "Jan", deviceId: randomUUID() } })).data, name: "Jan" };
  for (const p of [I, J]) await call(`/api/rooms/${code4}/ready`, { token: p.token, body: { ready: true } });
  check((await call(`/api/rooms/${code4}/start`, { token: I.token, body: {} })).status === 200, "2-player deal starts");
  s = (await call(`/api/rooms/${code4}/state`, { token: I.token })).data;
  check(s.game?.hand.length === 5 && s.game.stockCount === 54 - 10 - 1, "default rules: 5 cards each");
  check((await call(`/api/rooms/${code4}/kick`, { token: I.token, body: { playerId: J.playerId } })).data.pending === true, "kick Jan (pending)");
  // 10 s to press "Ignoră" + 2 s network grace before the kick is enforced.
  await sleep(12_500);
  check((await call(`/api/rooms/${code4}/state`, { token: J.token })).status === 401, "kick enforced after 10 s (+2 s grace)");
  s = (await call(`/api/rooms/${code4}/state`, { token: I.token })).data;
  check(s.room?.status === "finished" && s.result?.aborted?.nickname === "Jan" && s.result.winner === null, "deal cancelled by the kick");
  check((await call(`/api/rooms/${code4}/leave`, { token: I.token, body: {} })).data.roomClosed === true, "room closed");
  created.delete(code4);
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (LOCAL && LB_GAME && LB_GAME !== "macao") {
    await rest(`hub_leaderboard?game=eq.${LB_GAME}`, { method: "DELETE" });
    await rest(`hub_leaderboard_rounds?game=eq.${LB_GAME}`, { method: "DELETE" });
  }
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/macao_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
