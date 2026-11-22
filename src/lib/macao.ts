// Pure Macao rules - shared by server and client, no I/O.
//
// Romanian Macao with house rules (see rules.ts, chosen by the host in the lobby):
//  - 52 cards + 2 jokers (black "XB", colored "XR"). Everyone gets `handSize` cards; one plain card is turned up.
//  - On your turn put a card of the same suit or rank as the card on top (or the suit chosen with the
//    change-suit card), or draw one. Special cards: 2 / 3 / jokers = the next player draws (they can pass it on
//    with another 2 / 3 / joker, or cancel it with the stop card), the skip card = the next one sits out a turn,
//    the change-suit card = you choose the suit.
//  - Several cards of the same rank can go down at once (effects add up). With one card left you say "Macao";
//    the others can catch you before you do and you draw `macaoPenalty` cards.
//  - First out wins the round (or the round goes on until one player is left with cards).

import { type Rules } from "./rules";

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;
export const NICKNAME_MAX = 12;

/**
 * Rooms made by the automated tests (scripts/e2e.mjs, tests/ui) are named like this. They run against the
 * production DB, so their rounds are never reported to the hub leaderboard.
 */
export const TEST_ROOM_PREFIX = "e2e-test-";
export const isTestRoom = (name: string) => name.startsWith(TEST_ROOM_PREFIX);

/**
 * Lobby/finished rooms are closed (deleted) after this long without activity. Every open room page
 * polls /state, which refreshes the timer (see PRESENCE_TOUCH_MS), so a room only closes once nobody
 * has it open.
 */
export const ROOM_IDLE_MINUTES = 10;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;

/** "2 minute" / "10 minute" / "60 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  if (status !== "lobby" && status !== "finished") return false;
  return now - new Date(lastActivityAt).getTime() > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A room in any status (also "playing") is abandoned once its last activity is older than this AND no
 * player or spectator has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;

export function isRoomAbandoned(
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= ROOM_ABANDONED_MS;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

// ---------------------------------------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------------------------------------

export const SUITS = ["S", "H", "D", "C"] as const;
export const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K", "A"] as const;
export type Suit = (typeof SUITS)[number];
export type Rank = (typeof RANKS)[number];
/** "10H", "7S", "AD"; jokers are "XB" (black) and "XR" (colored / red). */
export type Card = string;
export const JOKER_BLACK = "XB";
export const JOKER_RED = "XR";

export const isJoker = (card: Card) => card === JOKER_BLACK || card === JOKER_RED;
/** Rank, "X" for both jokers (so two jokers count as "the same rank"). */
export const rankOf = (card: Card): Rank | "X" => (isJoker(card) ? "X" : (card.slice(0, -1) as Rank));
export const suitOf = (card: Card): Suit | null => (isJoker(card) ? null : (card.slice(-1) as Suit));
export const isRedSuit = (s: Suit) => s === "H" || s === "D";
export const isRed = (card: Card) => (isJoker(card) ? card === JOKER_RED : isRedSuit(suitOf(card)!));

export function isCard(value: unknown): value is Card {
  if (typeof value !== "string") return false;
  if (isJoker(value)) return true;
  return (RANKS as readonly string[]).includes(value.slice(0, -1)) && (SUITS as readonly string[]).includes(value.slice(-1));
}
export const isSuit = (value: unknown): value is Suit => (SUITS as readonly unknown[]).includes(value);

export function buildDeck(jokers: boolean): Card[] {
  const deck: Card[] = [];
  for (const s of SUITS) for (const r of RANKS) deck.push(`${r}${s}`);
  if (jokers) deck.push(JOKER_BLACK, JOKER_RED);
  return deck;
}

/** Fisher-Yates. `random` is injectable for tests. */
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export type Kind = "draw" | "stop" | "skip" | "change" | "plain";

/** What a card does under `rules`. 2, 3 and jokers always make the next player draw. */
export function kindOf(card: Card, rules: Rules): Kind {
  const r = rankOf(card);
  if (r === "X" || r === "2" || r === "3") return "draw";
  if (r === rules.stopRank) return "stop";
  if (r === rules.skipRank) return "skip";
  if (r === rules.changeRank) return "change";
  return "plain";
}

export function drawValue(card: Card, rules: Rules): number {
  if (card === JOKER_BLACK) return rules.jokerBlackDraw;
  if (card === JOKER_RED) return rules.jokerRedDraw;
  const r = rankOf(card);
  return r === "2" ? 2 : r === "3" ? 3 : 0;
}

// ---------------------------------------------------------------------------------------------------------
// Deal
// ---------------------------------------------------------------------------------------------------------

export type LogEntry =
  | { type: "play"; playerId: string; cards: Card[]; suit?: Suit }
  | { type: "draw"; playerId: string; count: number }
  | { type: "take"; playerId: string; count: number }
  | { type: "sit"; playerId: string; turns: number }
  | { type: "sat"; playerId: string }
  | { type: "pass"; playerId: string }
  | { type: "macao"; playerId: string }
  | { type: "caught"; playerId: string; by: string; count: number }
  | { type: "out"; playerId: string; place: number };

/** One deal (round) in progress. Stored as JSON on the room; hands never leave the server. */
export interface Deal {
  /** Seat order = play order (clockwise). */
  order: string[];
  rules: Rules;
  /** Draw pile; cards are drawn from the end. */
  stock: Card[];
  /** Played cards; the last one is on top. */
  discard: Card[];
  hands: Record<string, Card[]>;
  /** Who must act now. */
  turn: string;
  /** Suit chosen with the change-suit card (until the next card goes down). */
  suit: Suit | null;
  /** Cards the player on turn must draw unless they pass it on / stop it. */
  pendingDraw: number;
  /** Turns the player on turn must sit out unless they pass it on / stop it. */
  pendingSkip: number;
  /** Extra turns each player still sits out (accepted skips of 2+). */
  sitOut: Record<string, number>;
  /** The card the player on turn just drew and may still put down (playAfterDraw), else null. */
  drawn: Card | null;
  /** Players who said "Macao" (reset when they hold more than one card again). */
  macao: Record<string, boolean>;
  /** Players out of cards, in finishing order. */
  finished: string[];
  /** Last events, newest last (max LOG_SIZE). */
  log: LogEntry[];
  moves: number;
}

export const LOG_SIZE = 12;

export class RuleError extends Error {}

const clone = (deal: Deal): Deal => structuredClone(deal);

export const topCard = (deal: Pick<Deal, "discard">): Card => deal.discard[deal.discard.length - 1];

/** Suit to follow: the chosen one after a change-suit card, else the top card's (null on a joker). */
export function activeSuit(deal: Pick<Deal, "discard" | "suit">): Suit | null {
  return deal.suit ?? suitOf(topCard(deal));
}

/** Players still holding cards, in seat order. */
export const activePlayers = (deal: Pick<Deal, "order" | "finished">) => deal.order.filter((id) => !deal.finished.includes(id));

export function isDealOver(deal: Deal): boolean {
  if (deal.rules.roundEnd === "first") return deal.finished.length > 0;
  return activePlayers(deal).length <= 1;
}

function pushLog(deal: Deal, entry: LogEntry) {
  deal.log.push(entry);
  if (deal.log.length > LOG_SIZE) deal.log.splice(0, deal.log.length - LOG_SIZE);
}

/** Starts a deal: shuffle, `handSize` cards each (one at a time, `first` first), one plain card turned up. */
export function newDeal(order: string[], first: string, rules: Rules, random: () => number = Math.random): Deal {
  if (order.length < MIN_PLAYERS || order.length > MAX_PLAYERS) {
    throw new RuleError(`Macao se joacă în ${MIN_PLAYERS}-${MAX_PLAYERS} jucători.`);
  }
  if (!order.includes(first)) throw new RuleError("Jucătorul care începe nu e la masă.");
  const stock = shuffle(buildDeck(rules.jokers), random);
  const hands: Record<string, Card[]> = {};
  const sitOut: Record<string, number> = {};
  const macao: Record<string, boolean> = {};
  for (const id of order) {
    hands[id] = [];
    sitOut[id] = 0;
    macao[id] = false;
  }
  const start = order.indexOf(first);
  const seats = [...order.slice(start), ...order.slice(0, start)];
  for (let i = 0; i < rules.handSize; i++) for (const id of seats) hands[id].push(stock.pop()!);
  // The first card on the table is a plain one: special cards go back under the pile.
  let guard = stock.length;
  while (kindOf(stock[stock.length - 1], rules) !== "plain" && guard-- > 0) stock.unshift(stock.pop()!);
  const discard = [stock.pop()!];
  return {
    order: [...order],
    rules: { ...rules },
    stock,
    discard,
    hands,
    turn: first,
    suit: null,
    pendingDraw: 0,
    pendingSkip: 0,
    sitOut,
    drawn: null,
    macao,
    finished: [],
    log: [],
    moves: 0,
  };
}

/** Same color as the top of the pile (a joker on top has its own color). */
function sameColorAsTop(deal: Deal, card: Card): boolean {
  const top = topCard(deal);
  const suit = activeSuit(deal);
  const topRed = suit ? isRedSuit(suit) : isRed(top);
  return isRed(card) === topRed;
}

/** Plain matching: same suit as the one to follow, or same rank as the top card. */
function baseMatch(deal: Deal, card: Card): boolean {
  const top = topCard(deal);
  const suit = activeSuit(deal);
  if (isJoker(card)) return isJoker(top);
  return suitOf(card) === suit || (!isJoker(top) && rankOf(card) === rankOf(top));
}

/** Whether `card` may be the first card put down now by the player on turn (finish rule not checked). */
export function fits(deal: Deal, card: Card): boolean {
  const r = deal.rules;
  const top = topCard(deal);
  const kind = kindOf(card, r);

  if (deal.pendingDraw > 0) {
    if (kind === "draw") {
      if (isJoker(card)) {
        if (!isJoker(top) && !r.jokerStack) return false;
        return r.jokerOn === "any" || sameColorAsTop(deal, card);
      }
      if (isJoker(top)) return r.jokerStack;
      return rankOf(card) === rankOf(top) || r.mixTwoThree;
    }
    if (kind === "stop") return r.stopAnySuit || (isJoker(top) ? sameColorAsTop(deal, card) : suitOf(card) === activeSuit(deal));
    return false;
  }

  if (deal.pendingSkip > 0) {
    if (kind === "skip") return r.skipStack;
    if (kind === "stop" && r.stopCancelsSkip) return r.stopAnySuit || suitOf(card) === activeSuit(deal);
    return false;
  }

  // A joker on top (its penalty already taken or stopped) and no suit chosen.
  if (isJoker(top) && !deal.suit) {
    if (r.anyOnJoker || isJoker(card)) return true;
    return sameColorAsTop(deal, card);
  }

  switch (kind) {
    case "draw":
      if (isJoker(card)) return r.jokerOn === "any" || sameColorAsTop(deal, card);
      if (r.twoThreeOn === "any") return true;
      if (r.twoThreeOn === "color") return sameColorAsTop(deal, card) || (!isJoker(top) && rankOf(card) === rankOf(top));
      return baseMatch(deal, card);
    case "change":
      return r.changeOnAnything || baseMatch(deal, card);
    case "stop":
      return r.stopOnAnything || baseMatch(deal, card);
    case "skip":
      return r.skipOnAnything || baseMatch(deal, card);
    default:
      return baseMatch(deal, card);
  }
}

/** Why `cards` cannot be put down now by `playerId` (null = they can). Cards in the order they would go down. */
export function playProblem(deal: Deal, playerId: string, cards: Card[]): string | null {
  if (isDealOver(deal)) return "Runda s-a terminat.";
  if (deal.turn !== playerId) return "Nu e rândul tău.";
  if (cards.length === 0) return "Alege o carte.";
  const hand = deal.hands[playerId] ?? [];
  if (new Set(cards).size !== cards.length || !cards.every((c) => hand.includes(c))) return "Nu ai cartea asta.";
  if (cards.length > 1 && !deal.rules.multiPlay) return "Pui câte o singură carte.";
  if (cards.some((c) => rankOf(c) !== rankOf(cards[0]))) return "Deodată poți pune doar cărți de același număr.";
  if (deal.drawn && (cards.length > 1 || cards[0] !== deal.drawn)) return "Poți pune doar cartea trasă, sau treci.";
  if (!fits(deal, cards[0])) return notFitMessage(deal);
  if (!deal.rules.finishOnSpecial && cards.length === hand.length && kindOf(cards[0], deal.rules) !== "plain") {
    return "Nu poți termina cu o carte specială.";
  }
  return null;
}

function notFitMessage(deal: Deal): string {
  if (deal.pendingDraw > 0) return `Ai de luat ${deal.pendingDraw} ${deal.pendingDraw === 1 ? "carte" : "cărți"}: dă mai departe, oprește, sau ia-le.`;
  if (deal.pendingSkip > 0) return "Stai o tură: dă mai departe, sau stai.";
  return "Cartea nu se potrivește.";
}

/** Single cards `playerId` may put down now (empty when it is not their turn). */
export function legalCards(deal: Deal, playerId: string): Card[] {
  if (deal.turn !== playerId || isDealOver(deal)) return [];
  const hand = deal.hands[playerId] ?? [];
  return hand.filter((c) => playProblem(deal, playerId, [c]) === null);
}

/** Puts a legal card first (the order the client sent is kept otherwise). */
function withStarterFirst(deal: Deal, cards: Card[]): Card[] {
  const i = cards.findIndex((c) => fits(deal, c));
  if (i <= 0) return cards;
  return [cards[i], ...cards.slice(0, i), ...cards.slice(i + 1)];
}

/** Draws up to `n` cards for `id`, reshuffling the played cards (except the top one) when the pile runs out. */
function drawCards(deal: Deal, id: string, n: number, random: () => number = Math.random): Card[] {
  const got: Card[] = [];
  for (let i = 0; i < n; i++) {
    if (deal.stock.length === 0 && deal.discard.length > 1) {
      const top = deal.discard.pop()!;
      deal.stock = shuffle(deal.discard, random);
      deal.discard = [top];
    }
    const c = deal.stock.pop();
    if (!c) break;
    deal.hands[id].push(c);
    got.push(c);
  }
  if (deal.hands[id].length > 1) deal.macao[id] = false;
  return got;
}

/**
 * Next player on turn after `from`: skips players out of cards and players sitting out (consuming one of their
 * turns each; a running penalty then goes to the next player).
 */
function advance(deal: Deal, from: string) {
  deal.drawn = null;
  if (isDealOver(deal)) return;
  const n = deal.order.length;
  let i = deal.order.indexOf(from);
  for (let guard = 0; guard < n * 50; guard++) {
    i = (i + 1) % n;
    const id = deal.order[i];
    if (deal.finished.includes(id)) continue;
    if ((deal.sitOut[id] ?? 0) > 0) {
      deal.sitOut[id] -= 1;
      pushLog(deal, { type: "sat", playerId: id });
      continue;
    }
    deal.turn = id;
    return;
  }
  deal.turn = from;
}

/** Puts `cards` (same rank) down for `playerId`. `suit` = the chosen suit for a change-suit card. Input not mutated. */
export function playCards(input: Deal, playerId: string, cards: Card[], suit?: Suit | null): Deal {
  const ordered = withStarterFirst(input, cards);
  const problem = playProblem(input, playerId, ordered);
  if (problem) throw new RuleError(problem);
  const r = input.rules;
  const kind = kindOf(ordered[0], r);
  if (kind === "change" && !isSuit(suit)) throw new RuleError("Alege suita.");

  const deal = clone(input);
  deal.hands[playerId] = deal.hands[playerId].filter((c) => !ordered.includes(c));
  deal.discard.push(...ordered);
  deal.suit = kind === "change" ? (suit as Suit) : null;
  deal.drawn = null;
  deal.moves += 1;
  if (kind === "draw") deal.pendingDraw += ordered.reduce((s, c) => s + drawValue(c, r), 0);
  else if (kind === "skip") deal.pendingSkip += ordered.length;
  else if (kind === "stop") {
    deal.pendingDraw = 0;
    deal.pendingSkip = 0;
  }
  pushLog(deal, { type: "play", playerId, cards: ordered, ...(kind === "change" ? { suit: suit as Suit } : {}) });

  const left = deal.hands[playerId].length;
  if (left > 1) deal.macao[playerId] = false;
  if (left === 0) {
    deal.finished.push(playerId);
    pushLog(deal, { type: "out", playerId, place: deal.finished.length });
  }
  advance(deal, playerId);
  return deal;
}

/** Draws one card (no penalty running). With playAfterDraw a card that fits stays playable for this turn. */
export function drawCard(input: Deal, playerId: string, random: () => number = Math.random): Deal {
  if (isDealOver(input)) throw new RuleError("Runda s-a terminat.");
  if (input.turn !== playerId) throw new RuleError("Nu e rândul tău.");
  if (input.pendingDraw > 0 || input.pendingSkip > 0) throw new RuleError(notFitMessage(input));
  if (input.drawn) throw new RuleError("Ai tras deja: pune cartea trasă sau treci.");
  const deal = clone(input);
  deal.moves += 1;
  const [card] = drawCards(deal, playerId, 1, random);
  pushLog(deal, { type: "draw", playerId, count: card ? 1 : 0 });
  if (card && deal.rules.playAfterDraw && fits(deal, card)) {
    deal.drawn = card;
    return deal;
  }
  advance(deal, playerId);
  return deal;
}

/** After drawing a card that fits: keep it and end the turn. */
export function passTurn(input: Deal, playerId: string): Deal {
  if (input.turn !== playerId || !input.drawn) throw new RuleError("Nu poți trece acum.");
  const deal = clone(input);
  deal.moves += 1;
  pushLog(deal, { type: "pass", playerId });
  advance(deal, playerId);
  return deal;
}

/** Takes the cards to draw (2 / 3 / jokers) and ends the turn. */
export function takePenalty(input: Deal, playerId: string, random: () => number = Math.random): Deal {
  if (input.turn !== playerId) throw new RuleError("Nu e rândul tău.");
  if (input.pendingDraw <= 0) throw new RuleError("Nu ai cărți de luat.");
  const deal = clone(input);
  deal.moves += 1;
  const got = drawCards(deal, playerId, deal.pendingDraw, random);
  pushLog(deal, { type: "take", playerId, count: got.length });
  deal.pendingDraw = 0;
  advance(deal, playerId);
  return deal;
}

/** Accepts the "sit out" (this turn, plus the extra ones when several skip cards were stacked). */
export function sitOutTurn(input: Deal, playerId: string): Deal {
  if (input.turn !== playerId) throw new RuleError("Nu e rândul tău.");
  if (input.pendingSkip <= 0) throw new RuleError("Nu ai de stat.");
  const deal = clone(input);
  deal.moves += 1;
  pushLog(deal, { type: "sit", playerId, turns: deal.pendingSkip });
  deal.sitOut[playerId] = (deal.sitOut[playerId] ?? 0) + deal.pendingSkip - 1;
  deal.pendingSkip = 0;
  advance(deal, playerId);
  return deal;
}

/** "Macao!" - a player with at most two cards says it (any time, also out of turn). */
export function sayMacao(input: Deal, playerId: string): Deal {
  if (!input.rules.macao) throw new RuleError("Camera se joacă fără „Macao”.");
  if (isDealOver(input) || !activePlayers(input).includes(playerId)) throw new RuleError("Nu mai joci în runda asta.");
  if ((input.hands[playerId]?.length ?? 0) > 2) throw new RuleError("Zici „Macao” când rămâi cu o carte.");
  if (input.macao[playerId]) return input;
  const deal = clone(input);
  deal.macao[playerId] = true;
  pushLog(deal, { type: "macao", playerId });
  return deal;
}

/** Players `by` could catch now: one card left and no "Macao" said. */
export function catchable(deal: Deal, by: string): string[] {
  if (!deal.rules.macao || isDealOver(deal)) return [];
  return activePlayers(deal).filter((id) => id !== by && deal.hands[id].length === 1 && !deal.macao[id]);
}

/** Counter-macao: everyone caught with one card and no "Macao" draws `macaoPenalty`. */
export function catchMacao(input: Deal, by: string, random: () => number = Math.random): Deal {
  if (!input.rules.macao) throw new RuleError("Camera se joacă fără „Macao”.");
  if (!input.order.includes(by)) throw new RuleError("Nu joci în runda asta.");
  const targets = catchable(input, by);
  if (targets.length === 0) throw new RuleError("Nu ai pe cine prinde.");
  const deal = clone(input);
  deal.moves += 1;
  for (const id of targets) {
    const got = drawCards(deal, id, deal.rules.macaoPenalty, random);
    pushLog(deal, { type: "caught", playerId: id, by, count: got.length });
  }
  return deal;
}

/** Suit `playerId` holds most of (for automatic moves). */
function favouriteSuit(hand: Card[]): Suit {
  const count = (s: Suit) => hand.filter((c) => suitOf(c) === s).length;
  return [...SUITS].sort((a, b) => count(b) - count(a))[0];
}

/**
 * A full turn made for a player who does not respond (host's "joacă pentru el"): takes a penalty / sits out,
 * otherwise puts the first fitting card (plain ones first), otherwise draws (and keeps the drawn card).
 */
export function autoMove(input: Deal, playerId: string): Deal {
  if (input.turn !== playerId || isDealOver(input)) throw new RuleError("Nu e rândul lui.");
  if (input.drawn) return passTurn(input, playerId);
  if (input.pendingDraw > 0) return takePenalty(input, playerId);
  if (input.pendingSkip > 0) return sitOutTurn(input, playerId);
  const legal = legalCards(input, playerId);
  if (legal.length > 0) {
    const card = [...legal].sort((a, b) => Number(kindOf(a, input.rules) !== "plain") - Number(kindOf(b, input.rules) !== "plain"))[0];
    const hand = input.hands[playerId].filter((c) => c !== card);
    return playCards(input, playerId, [card], kindOf(card, input.rules) === "change" ? favouriteSuit(hand.length ? hand : [card]) : null);
  }
  const drew = drawCard(input, playerId);
  return drew.turn === playerId && drew.drawn ? passTurn(drew, playerId) : drew;
}

// ---------------------------------------------------------------------------------------------------------
// Results, seats
// ---------------------------------------------------------------------------------------------------------

export interface Standing {
  playerId: string;
  place: number;
  cardsLeft: number;
}

/** Final places: players out of cards in finishing order, then the others by fewest cards left (ties share a place). */
export function standings(deal: Pick<Deal, "order" | "finished" | "hands">): Standing[] {
  const out: Standing[] = deal.finished.map((id, i) => ({ playerId: id, place: i + 1, cardsLeft: 0 }));
  const rest = deal.order
    .filter((id) => !deal.finished.includes(id))
    .map((id) => ({ playerId: id, cardsLeft: deal.hands[id]?.length ?? 0 }))
    .sort((a, b) => a.cardsLeft - b.cardsLeft);
  let place = out.length;
  let prev = -1;
  rest.forEach((s, i) => {
    if (s.cardsLeft !== prev) place = out.length + i + 1;
    prev = s.cardsLeft;
    out.push({ ...s, place });
  });
  return out;
}

/** True when `order` lists every id of `ids` exactly once. */
export function isPermutation(order: unknown, ids: string[]): order is string[] {
  if (!Array.isArray(order) || order.length !== ids.length) return false;
  const seen = new Set<unknown>(order);
  return seen.size === ids.length && ids.every((id) => seen.has(id));
}

/** New order after moving `id` one step up (-1) or down (+1). `ids` is in seat order. Null when it cannot move. */
export function movedOrder(ids: string[], id: string, dir: -1 | 1): string[] | null {
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return null;
  const out = [...ids];
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}

/** Round 1 is started by seat 0, then the first player moves one seat each round. */
export function roundLeader(order: string[], round: number): string {
  const n = order.length;
  return order[(((round - 1) % n) + n) % n];
}

export const SUIT_SYMBOL: Record<Suit, string> = { S: "♠", H: "♥", D: "♦", C: "♣" };
export const SUIT_NAME: Record<Suit, string> = { S: "pică", H: "inimă roșie", D: "romb", C: "treflă" };

/** "7♥", "joker colorat". */
export function cardLabel(card: Card): string {
  if (card === JOKER_BLACK) return "joker negru";
  if (card === JOKER_RED) return "joker colorat";
  return `${rankOf(card)}${SUIT_SYMBOL[suitOf(card)!]}`;
}
