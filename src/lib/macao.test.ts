import { describe, expect, it } from "vitest";
import {
  activePlayers,
  autoMove,
  buildDeck,
  type Card,
  catchable,
  catchMacao,
  type Deal,
  drawCard,
  fits,
  isDealOver,
  isPermutation,
  isRoomAbandoned,
  isTestRoom,
  kindOf,
  legalCards,
  movedOrder,
  newDeal,
  passTurn,
  playCards,
  playProblem,
  ROOM_ABANDONED_MS,
  roundLeader,
  RuleError,
  sayMacao,
  sitOutTurn,
  standings,
  takePenalty,
  topCard,
} from "./macao";
import { DEFAULT_RULES, describeRules, normalizeRules, type Rules, updateRules } from "./rules";

/** Seeded PRNG (mulberry32) for reproducible shuffles. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STOCK: Card[] = ["5C", "6C", "8C", "9C", "10C", "QC", "KC", "5D", "6D", "8D", "9D", "10D"];

/** Hand-made deal: players in `hands` key order, the first one on turn, `discard` last = top. */
function make(hands: Record<string, Card[]>, discard: Card[], rules: Partial<Rules> = {}, extra: Partial<Deal> = {}): Deal {
  const order = Object.keys(hands);
  return {
    order,
    rules: { ...DEFAULT_RULES, ...rules },
    stock: [...STOCK],
    discard,
    hands: structuredClone(hands),
    turn: order[0],
    suit: null,
    pendingDraw: 0,
    pendingSkip: 0,
    sitOut: Object.fromEntries(order.map((id) => [id, 0])),
    drawn: null,
    macao: Object.fromEntries(order.map((id) => [id, false])),
    finished: [],
    log: [],
    moves: 0,
    ...extra,
  };
}

const totalCards = (d: Deal) => d.stock.length + d.discard.length + Object.values(d.hands).reduce((s, h) => s + h.length, 0);

describe("deck and deal", () => {
  it("has 54 unique cards with jokers, 52 without", () => {
    expect(new Set(buildDeck(true)).size).toBe(54);
    expect(buildDeck(false)).toHaveLength(52);
    expect(buildDeck(false)).not.toContain("XR");
  });

  it("deals handSize cards each and turns up a plain card", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const ids = ["a", "b", "c", "d", "e", "f"];
      const d = newDeal(ids, "c", { ...DEFAULT_RULES, handSize: 7 }, rng(seed));
      for (const id of ids) expect(d.hands[id]).toHaveLength(7);
      expect(d.turn).toBe("c");
      expect(d.discard).toHaveLength(1);
      expect(kindOf(topCard(d), d.rules)).toBe("plain");
      expect(totalCards(d)).toBe(54);
    }
  });

  it("plays with 2 to 6 players only", () => {
    expect(() => newDeal(["a"], "a", DEFAULT_RULES)).toThrow(RuleError);
    expect(() => newDeal(["a", "b", "c", "d", "e", "f", "g"], "a", DEFAULT_RULES)).toThrow(RuleError);
  });
});

describe("matching", () => {
  it("same suit or same rank", () => {
    const d = make({ a: ["9H", "5S", "9C", "KD"], b: ["6S"] }, ["5H"]);
    expect(legalCards(d, "a").sort()).toEqual(["5S", "9H"].sort());
    expect(legalCards(d, "b")).toEqual([]); // not their turn
  });

  it("2 / 3: same suit, same color or anything", () => {
    const hand = { a: ["2D", "3S", "6C"], b: ["6S"] };
    expect(legalCards(make(hand, ["9H"], { twoThreeOn: "suit" }), "a")).toEqual([]);
    expect(legalCards(make(hand, ["9H"], { twoThreeOn: "color" }), "a")).toEqual(["2D"]);
    expect(legalCards(make(hand, ["9H"], { twoThreeOn: "any" }), "a").sort()).toEqual(["2D", "3S"]);
  });

  it("jokers on anything or by color; after a joker anything or its color", () => {
    const hand = { a: ["XR", "XB", "6C"], b: ["6S"] };
    expect(legalCards(make(hand, ["9H"], { jokerOn: "any" }), "a").sort()).toEqual(["XB", "XR"]);
    expect(legalCards(make(hand, ["9H"], { jokerOn: "color" }), "a")).toEqual(["XR"]);
    expect(legalCards(make(hand, ["9S"], { jokerOn: "color" }), "a")).toEqual(["XB"]);
    const onRed = { a: ["6C", "6H", "XB"], b: ["6S"] };
    expect(legalCards(make(onRed, ["XR"], { anyOnJoker: true }), "a").sort()).toEqual(["6C", "6H", "XB"]);
    expect(legalCards(make(onRed, ["XR"], { anyOnJoker: false }), "a").sort()).toEqual(["6H", "XB"]);
  });

  it("change-suit card on anything (or not), then the chosen suit", () => {
    const d = make({ a: ["7S", "KD"], b: ["9C", "9H", "7H"] }, ["5H"]);
    expect(legalCards(d, "a")).toEqual(["7S"]);
    expect(legalCards(make({ a: ["7S"], b: ["9C"] }, ["5H"], { changeOnAnything: false }), "a")).toEqual([]);
    expect(() => playCards(d, "a", ["7S"])).toThrow("Alege suita");
    const next = playCards(d, "a", ["7S"], "C");
    expect(next.suit).toBe("C");
    expect(next.turn).toBe("b");
    expect(legalCards(next, "b").sort()).toEqual(["7H", "9C"]);
  });

  it("stop and skip cards on anything only when the rule says so", () => {
    const hand = { a: ["4S", "AS"], b: ["9C"] };
    expect(legalCards(make(hand, ["9H"]), "a")).toEqual([]);
    expect(legalCards(make(hand, ["9H"], { stopOnAnything: true, skipOnAnything: true }), "a").sort()).toEqual(["4S", "AS"]);
  });
});

describe("cards to draw", () => {
  it("a 2 makes the next player draw 2; taking ends their turn", () => {
    let d = make({ a: ["2H", "KS"], b: ["9C", "8S"], c: ["5C"] }, ["5H"]);
    d = playCards(d, "a", ["2H"]);
    expect(d.pendingDraw).toBe(2);
    expect(d.turn).toBe("b");
    expect(legalCards(d, "b")).toEqual([]);
    expect(() => drawCard(d, "b")).toThrow(RuleError);
    d = takePenalty(d, "b");
    expect(d.hands.b).toHaveLength(4);
    expect(d.pendingDraw).toBe(0);
    expect(d.turn).toBe("c");
  });

  it("2 on 3 and 3 on 2 only when mixing is allowed; they add up", () => {
    const base = { a: ["3C"], b: ["2S", "3D"], c: ["9C"] };
    const running = (mix: boolean) => make(base, ["5H", "3H"], { mixTwoThree: mix }, { pendingDraw: 3, turn: "b" });
    expect(legalCards(running(false), "b")).toEqual(["3D"]);
    expect(legalCards(running(true), "b").sort()).toEqual(["2S", "3D"]);
    const d = playCards(running(true), "b", ["2S"]);
    expect(d.pendingDraw).toBe(5);
    expect(d.turn).toBe("c");
  });

  it("jokers stack with 2 / 3 when allowed", () => {
    const d = make({ a: ["XB", "2C"], b: ["9C"] }, ["5H", "2H"], { jokerStack: true }, { pendingDraw: 2 });
    expect(legalCards(d, "a").sort()).toEqual(["2C", "XB"]);
    expect(playCards(d, "a", ["XB"]).pendingDraw).toBe(7);
    const noStack = make({ a: ["XB", "2C"], b: ["9C"] }, ["5H", "2H"], { jokerStack: false }, { pendingDraw: 2 });
    expect(legalCards(noStack, "a")).toEqual(["2C"]);
    const onJoker = make({ a: ["XB", "2C"], b: ["9C"] }, ["5H", "XR"], { jokerStack: false }, { pendingDraw: 10 });
    expect(legalCards(onJoker, "a")).toEqual(["XB"]);
  });

  it("the stop card cancels the cards to draw (any suit, or only the top suit)", () => {
    const hand = { a: ["4S", "4H"], b: ["9C"] };
    const any = make(hand, ["5H", "2H"], { stopAnySuit: true }, { pendingDraw: 2 });
    expect(legalCards(any, "a").sort()).toEqual(["4H", "4S"]);
    const suit = make(hand, ["5H", "2H"], { stopAnySuit: false }, { pendingDraw: 2 });
    expect(legalCards(suit, "a")).toEqual(["4H"]);
    const d = playCards(any, "a", ["4S"]);
    expect(d.pendingDraw).toBe(0);
    expect(d.turn).toBe("b");
  });

  it("the change-suit card cannot dodge cards to draw", () => {
    const d = make({ a: ["7H", "8H"], b: ["9C"] }, ["5H", "2H"], {}, { pendingDraw: 2 });
    expect(legalCards(d, "a")).toEqual([]);
  });
});

describe("sit out a turn", () => {
  it("skip card: next player sits, stacking adds turns, extra turns are skipped later", () => {
    let d = make({ a: ["AH", "5C"], b: ["AS", "9D"], c: ["9H", "8H"], d: ["KS", "QS"] }, ["5H"]);
    d = playCards(d, "a", ["AH"]);
    expect(d.pendingSkip).toBe(1);
    expect(d.turn).toBe("b");
    expect(legalCards(d, "b")).toEqual(["AS"]);
    d = playCards(d, "b", ["AS"]);
    expect(d.pendingSkip).toBe(2);
    expect(d.turn).toBe("c");
    d = sitOutTurn(d, "c");
    expect(d.sitOut.c).toBe(1);
    expect(d.turn).toBe("d");
    d = playCards(d, "d", ["KS"]);
    expect(d.turn).toBe("a");
    d = drawCard(d, "a");
    if (d.turn === "a") d = passTurn(d, "a");
    d = autoMove(d, "b");
    // c still sits out one turn: d plays next
    expect(d.turn).toBe("d");
    expect(d.sitOut.c).toBe(0);
  });

  it("no stacking when skipStack is off; the stop card cancels a skip only when allowed", () => {
    const base = { a: ["5C"], b: ["AS", "4D"], c: ["9C"] };
    const off = make(base, ["5H", "AH"], { skipStack: false, stopCancelsSkip: false }, { pendingSkip: 1, turn: "b" });
    expect(legalCards(off, "b")).toEqual([]);
    const stop = make(base, ["5H", "AH"], { skipStack: false, stopCancelsSkip: true }, { pendingSkip: 1, turn: "b" });
    expect(legalCards(stop, "b")).toEqual(["4D"]);
    expect(playCards(stop, "b", ["4D"]).pendingSkip).toBe(0);
  });
});

describe("several cards at once", () => {
  it("puts cards of the same rank together and adds their effects", () => {
    const d = make({ a: ["2H", "2S", "KC"], b: ["9C"] }, ["5H"]);
    const next = playCards(d, "a", ["2S", "2H"]); // 2S does not fit, the server puts 2H first
    expect(next.pendingDraw).toBe(4);
    expect(topCard(next)).toBe("2S");
    expect(() => playCards(d, "a", ["2H", "KC"])).toThrow("același număr");
    expect(() => playCards(make({ a: ["2H", "2S", "KC"], b: ["9C"] }, ["5H"], { multiPlay: false }), "a", ["2H", "2S"])).toThrow(RuleError);
  });

  it("finishing with the last two equal cards needs no Macao", () => {
    const d = make({ a: ["9H", "9S"], b: ["KC", "QC"] }, ["5H"]);
    const next = playCards(d, "a", ["9H", "9S"]);
    expect(next.finished).toEqual(["a"]);
    expect(isDealOver(next)).toBe(true);
    expect(standings(next)[0]).toEqual({ playerId: "a", place: 1, cardsLeft: 0 });
  });

  it("cannot finish with a special card when the rule forbids it", () => {
    const d = make({ a: ["2H"], b: ["KC"] }, ["5H"], { finishOnSpecial: false });
    expect(playProblem(d, "a", ["2H"])).toMatch("carte specială");
    expect(legalCards(d, "a")).toEqual([]);
  });
});

describe("drawing", () => {
  it("a drawn card that fits can be put down or kept", () => {
    const d = make({ a: ["KS"], b: ["9C"] }, ["5H"], {}, { stock: ["9H"] });
    const drew = drawCard(d, "a");
    expect(drew.turn).toBe("a");
    expect(drew.drawn).toBe("9H");
    expect(legalCards(drew, "a")).toEqual(["9H"]);
    expect(passTurn(drew, "a").turn).toBe("b");
    expect(playCards(drew, "a", ["9H"]).turn).toBe("b");
  });

  it("a drawn card that does not fit (or playAfterDraw off) ends the turn", () => {
    expect(drawCard(make({ a: ["KS"], b: ["9C"] }, ["5H"], {}, { stock: ["9C"] }), "a").turn).toBe("b");
    expect(drawCard(make({ a: ["KS"], b: ["9C"] }, ["5H"], { playAfterDraw: false }, { stock: ["9H"] }), "a").turn).toBe("b");
  });

  it("reshuffles the played cards when the stock runs out", () => {
    const d = make({ a: ["KS"], b: ["9C"] }, ["6S", "7S", "8S", "5H"], {}, { stock: [] });
    const next = drawCard(d, "a");
    expect(next.hands.a).toHaveLength(2);
    expect(next.discard).toEqual(["5H"]);
    expect(totalCards(next)).toBe(totalCards(d));
  });
});

describe("Macao", () => {
  it("only with at most two cards; caught players draw the penalty", () => {
    let d = make({ a: ["9H", "KC"], b: ["5S", "5C", "6D"], c: ["9C", "QD"] }, ["5H"]);
    expect(() => sayMacao(d, "b")).toThrow(RuleError);
    d = playCards(d, "a", ["9H"]);
    expect(catchable(d, "b")).toEqual(["a"]);
    const caught = catchMacao(d, "b");
    expect(caught.hands.a).toHaveLength(1 + DEFAULT_RULES.macaoPenalty);
    expect(caught.turn).toBe(d.turn);
    expect(caught.macao.a).toBe(false);
  });

  it("saying it in time (before or after the card) protects you", () => {
    let d = make({ a: ["9H", "KC"], b: ["5S", "5C", "6D"] }, ["5H"]);
    d = sayMacao(d, "a");
    d = playCards(d, "a", ["9H"]);
    expect(catchable(d, "b")).toEqual([]);
    expect(() => catchMacao(d, "b")).toThrow("Nu ai pe cine prinde");
    let late = playCards(make({ a: ["9H", "KC"], b: ["5S"] }, ["5H"]), "a", ["9H"]);
    late = sayMacao(late, "a");
    expect(catchable(late, "b")).toEqual([]);
  });

  it("is switched off by the rule", () => {
    const d = make({ a: ["9H"], b: ["5S"] }, ["5H"], { macao: false });
    expect(() => sayMacao(d, "a")).toThrow(RuleError);
    expect(catchable(d, "b")).toEqual([]);
  });
});

describe("end of the round", () => {
  it("'last': goes on until one player has cards, then ranks everyone", () => {
    let d = make({ a: ["9H"], b: ["5S", "KC"], c: ["9C", "QD", "8D"] }, ["5H"], { roundEnd: "last", macao: false });
    d = playCards(d, "a", ["9H"]);
    expect(isDealOver(d)).toBe(false);
    expect(activePlayers(d)).toEqual(["b", "c"]);
    expect(d.turn).toBe("b");
    d = { ...d, hands: { ...d.hands, b: ["9S"] } };
    d = playCards(d, "b", ["9S"]);
    expect(isDealOver(d)).toBe(true);
    expect(standings(d).map((s) => [s.playerId, s.place, s.cardsLeft])).toEqual([
      ["a", 1, 0],
      ["b", 2, 0],
      ["c", 3, 3],
    ]);
  });

  it("random full games with random rules always end and never lose a card", () => {
    const pickFrom = <T,>(r: () => number, xs: readonly T[]) => xs[Math.floor(r() * xs.length)];
    for (let seed = 1; seed <= 150; seed++) {
      const r = rng(seed);
      const rules = normalizeRules({
        handSize: pickFrom(r, [4, 5, 6, 7]),
        jokers: r() < 0.7,
        twoThreeOn: pickFrom(r, ["suit", "color", "any"]),
        mixTwoThree: r() < 0.5,
        jokerOn: pickFrom(r, ["any", "color"]),
        jokerStack: r() < 0.5,
        anyOnJoker: r() < 0.5,
        stopRank: pickFrom(r, ["4", "A", "none"]),
        skipRank: pickFrom(r, ["A", "4", "none"]),
        changeRank: pickFrom(r, ["7", "J", "none"]),
        finishOnSpecial: r() < 0.5,
        playAfterDraw: r() < 0.5,
        roundEnd: pickFrom(r, ["first", "last"]),
      });
      const ids = ["p1", "p2", "p3", "p4", "p5", "p6"].slice(0, 2 + Math.floor(r() * 5));
      let d = newDeal(ids, ids[0], rules, r);
      const size = totalCards(d);
      let steps = 0;
      while (!isDealOver(d) && steps < 3000) {
        const me = d.turn;
        const legal = legalCards(d, me);
        if (legal.length > 0 && r() < 0.85) {
          const card = legal[Math.floor(r() * legal.length)];
          const twins = rules.multiPlay ? d.hands[me].filter((c) => c !== card && c.slice(0, -1) === card.slice(0, -1) && card[0] !== "X") : [];
          const cards = r() < 0.5 ? [card, ...twins] : [card];
          const ok = playProblem(d, me, cards) === null ? cards : [card];
          d = playCards(d, me, ok, "H");
        } else {
          d = autoMove(d, me);
        }
        if (r() < 0.05) {
          const other = ids[Math.floor(r() * ids.length)];
          if (catchable(d, other).length > 0) d = catchMacao(d, other);
        }
        expect(totalCards(d)).toBe(size);
        expect(d.finished.includes(d.turn) && !isDealOver(d)).toBe(false);
        steps++;
      }
      expect(isDealOver(d)).toBe(true);
    }
  });
});

describe("rules", () => {
  it("normalizes garbage to the defaults", () => {
    expect(normalizeRules(null)).toEqual(DEFAULT_RULES);
    expect(normalizeRules({ handSize: 99, twoThreeOn: "x", macao: "yes" })).toEqual(DEFAULT_RULES);
  });

  it("a bad value in a change keeps the room's current value", () => {
    const seven = updateRules(DEFAULT_RULES, { handSize: 7 });
    expect(updateRules(seven, { handSize: 99, roundEnd: "last" })).toEqual({ ...seven, roundEnd: "last" });
  });

  it("stop and skip cannot share a rank: a clash switches the skip off, an update swaps them", () => {
    expect(normalizeRules({ stopRank: "A", skipRank: "A" }).skipRank).toBe("none");
    const swapped = updateRules(DEFAULT_RULES, { stopRank: "A" });
    expect(swapped.stopRank).toBe("A");
    expect(swapped.skipRank).toBe("4");
    const back = updateRules(swapped, { skipRank: "A" });
    expect(back.skipRank).toBe("A");
    expect(back.stopRank).toBe("4");
  });

  it("describes every rule set in a few lines", () => {
    expect(describeRules(DEFAULT_RULES).length).toBeGreaterThan(5);
    expect(describeRules({ ...DEFAULT_RULES, jokers: false, stopRank: "none", skipRank: "none", changeRank: "none" }).join(" ")).not.toMatch("Joker");
  });

  it("4 is the stop card by default and A the skip card", () => {
    const d = make({ a: ["4H"], b: ["9C"] }, ["5H", "2H"], {}, { pendingDraw: 2 });
    expect(fits(d, "4H")).toBe(true);
  });
});

describe("seats and rooms", () => {
  it("moves a player up / down", () => {
    expect(movedOrder(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
    expect(movedOrder(["a", "b", "c"], "a", -1)).toBeNull();
    expect(isPermutation(["c", "a", "b"], ["a", "b", "c"])).toBe(true);
    expect(isPermutation(["a", "a", "b"], ["a", "b", "c"])).toBe(false);
  });

  it("the first player moves one seat each round", () => {
    expect(roundLeader(["a", "b", "c"], 1)).toBe("a");
    expect(roundLeader(["a", "b", "c"], 5)).toBe("b");
  });

  it("abandoned rooms and test rooms", () => {
    const now = Date.parse("2026-11-22T12:00:00Z");
    const old = new Date(now - ROOM_ABANDONED_MS - 1000).toISOString();
    expect(isRoomAbandoned(old, [old, null], now)).toBe(true);
    expect(isRoomAbandoned(old, [new Date(now - 1000).toISOString()], now)).toBe(false);
    expect(isTestRoom("e2e-test-123")).toBe(true);
    expect(isTestRoom("Masa mare")).toBe(false);
  });
});
