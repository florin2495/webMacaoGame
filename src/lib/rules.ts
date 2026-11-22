// House rules of a Macao room. The host sets them in the lobby (before dealing); they are stored as JSON
// on macao_rooms.rules and copied into every deal, so a change only applies from the next deal.
// Pure module, shared by server and client.

export type MatchMode = "suit" | "color" | "any";
export type StopRank = "4" | "A" | "none";
export type SkipRank = "A" | "4" | "none";
export type ChangeRank = "7" | "J" | "none";
export type RoundEnd = "first" | "last";

export interface Rules {
  /** Cards dealt to each player. */
  handSize: number;
  /** The two jokers are in the deck (black and colored). */
  jokers: boolean;
  /** Cards a black / colored joker makes the next player draw. */
  jokerBlackDraw: number;
  jokerRedDraw: number;
  /** Where a 2 / 3 may be put (outside a running penalty): same suit or rank, same color or rank, or on anything. */
  twoThreeOn: MatchMode;
  /** While a penalty is running: a 2 on a 3 and a 3 on a 2 (otherwise only 2 on 2, 3 on 3). */
  mixTwoThree: boolean;
  /** Joker on anything, or the colored joker only on red cards (♥♦) and the black joker only on black ones (♠♣). */
  jokerOn: "any" | "color";
  /** While a penalty is running: a joker on a 2 / 3 and a 2 / 3 on a joker (the cards add up). */
  jokerStack: boolean;
  /** After a joker (penalty taken or stopped) the next player may put any card; otherwise the joker's color. */
  anyOnJoker: boolean;
  /** Card that cancels the cards to draw. */
  stopRank: StopRank;
  /** A stop card of any suit cancels a penalty, or only one of the suit (color, on a joker) of the card on top. */
  stopAnySuit: boolean;
  /** Outside a penalty the stop card can be put on anything (otherwise same suit or rank). */
  stopOnAnything: boolean;
  /** Card that makes the next player sit out a turn. */
  skipRank: SkipRank;
  /** Outside a penalty the skip card can be put on anything (otherwise same suit or rank). */
  skipOnAnything: boolean;
  /** A skip card on a skip card passes it on and the turns add up. */
  skipStack: boolean;
  /** The stop card also cancels a "sit out a turn". */
  stopCancelsSkip: boolean;
  /** Card that changes the suit. */
  changeRank: ChangeRank;
  /** The change-suit card can be put on anything (otherwise same suit or rank). Never while cards are to be drawn. */
  changeOnAnything: boolean;
  /** Several cards of the same rank can be put down at once (their effects add up). */
  multiPlay: boolean;
  /** You may finish (put your last card) with a special card. */
  finishOnSpecial: boolean;
  /** After drawing one card you may put it down right away if it fits. */
  playAfterDraw: boolean;
  /** "Macao": say it when you are left with one card; whoever catches you first makes you draw `macaoPenalty`. */
  macao: boolean;
  macaoPenalty: number;
  /** The round ends when the first player runs out of cards, or goes on until only one is left with cards. */
  roundEnd: RoundEnd;
  /** Seconds per turn (0 = no limit). When it runs out the turn is played automatically. */
  turnSeconds: number;
}

export const DEFAULT_RULES: Rules = {
  handSize: 5,
  jokers: true,
  jokerBlackDraw: 5,
  jokerRedDraw: 10,
  twoThreeOn: "suit",
  mixTwoThree: true,
  jokerOn: "any",
  jokerStack: true,
  anyOnJoker: true,
  stopRank: "4",
  stopAnySuit: true,
  stopOnAnything: false,
  skipRank: "A",
  skipOnAnything: false,
  skipStack: true,
  stopCancelsSkip: false,
  changeRank: "7",
  changeOnAnything: true,
  multiPlay: true,
  finishOnSpecial: true,
  playAfterDraw: true,
  macao: true,
  macaoPenalty: 5,
  roundEnd: "first",
  turnSeconds: 60,
};

export const HAND_SIZES = [4, 5, 6, 7] as const;
export const JOKER_DRAWS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
export const MACAO_PENALTIES = [1, 2, 3, 4, 5] as const;
export const TURN_SECONDS = [0, 30, 45, 60, 90, 120] as const;

const pick = <T>(value: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(value as T) ? (value as T) : fallback;
const bool = (value: unknown, fallback: boolean) => (typeof value === "boolean" ? value : fallback);

/**
 * Any JSON -> valid Rules (unknown keys dropped, missing / bad values = `fallback`, the defaults). Never throws.
 * The stop and skip card cannot be the same rank: on a clash the skip card is switched off.
 */
export function normalizeRules(input: unknown, fallback: Rules = DEFAULT_RULES): Rules {
  const o = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const d = fallback;
  const rules: Rules = {
    handSize: pick(o.handSize, HAND_SIZES, d.handSize as (typeof HAND_SIZES)[number]),
    jokers: bool(o.jokers, d.jokers),
    jokerBlackDraw: pick(o.jokerBlackDraw, JOKER_DRAWS, d.jokerBlackDraw as (typeof JOKER_DRAWS)[number]),
    jokerRedDraw: pick(o.jokerRedDraw, JOKER_DRAWS, d.jokerRedDraw as (typeof JOKER_DRAWS)[number]),
    twoThreeOn: pick<MatchMode>(o.twoThreeOn, ["suit", "color", "any"], d.twoThreeOn),
    mixTwoThree: bool(o.mixTwoThree, d.mixTwoThree),
    jokerOn: pick<"any" | "color">(o.jokerOn, ["any", "color"], d.jokerOn),
    jokerStack: bool(o.jokerStack, d.jokerStack),
    anyOnJoker: bool(o.anyOnJoker, d.anyOnJoker),
    stopRank: pick<StopRank>(o.stopRank, ["4", "A", "none"], d.stopRank),
    stopAnySuit: bool(o.stopAnySuit, d.stopAnySuit),
    stopOnAnything: bool(o.stopOnAnything, d.stopOnAnything),
    skipRank: pick<SkipRank>(o.skipRank, ["A", "4", "none"], d.skipRank),
    skipOnAnything: bool(o.skipOnAnything, d.skipOnAnything),
    skipStack: bool(o.skipStack, d.skipStack),
    stopCancelsSkip: bool(o.stopCancelsSkip, d.stopCancelsSkip),
    changeRank: pick<ChangeRank>(o.changeRank, ["7", "J", "none"], d.changeRank),
    changeOnAnything: bool(o.changeOnAnything, d.changeOnAnything),
    multiPlay: bool(o.multiPlay, d.multiPlay),
    finishOnSpecial: bool(o.finishOnSpecial, d.finishOnSpecial),
    playAfterDraw: bool(o.playAfterDraw, d.playAfterDraw),
    macao: bool(o.macao, d.macao),
    macaoPenalty: pick(o.macaoPenalty, MACAO_PENALTIES, d.macaoPenalty as (typeof MACAO_PENALTIES)[number]),
    roundEnd: pick<RoundEnd>(o.roundEnd, ["first", "last"], d.roundEnd),
    turnSeconds: pick(o.turnSeconds, TURN_SECONDS, d.turnSeconds as (typeof TURN_SECONDS)[number]),
  };
  if (rules.skipRank !== "none" && rules.skipRank === rules.stopRank) rules.skipRank = "none";
  // "On anything" includes answering a penalty with a stop card of any color.
  if (rules.stopOnAnything) rules.stopAnySuit = true;
  return rules;
}

/**
 * Where the stop card may go, as the one choice shown in the lobby:
 *  - "any": on any card, always;
 *  - "penalty": on any color when there are cards to draw (or a turn to sit out, if the stop cancels it), otherwise
 *    only on the same color or the same number;
 *  - "match": always only on the same color or the same number (also against cards to draw).
 */
export type StopMode = "any" | "penalty" | "match";
export const stopMode = (r: Pick<Rules, "stopAnySuit" | "stopOnAnything">): StopMode =>
  r.stopOnAnything ? "any" : r.stopAnySuit ? "penalty" : "match";
export const stopModeRules = (m: StopMode): Pick<Rules, "stopAnySuit" | "stopOnAnything"> => ({
  stopAnySuit: m !== "match",
  stopOnAnything: m === "any",
});

/** Applies a partial change from the lobby. When the stop card takes the skip card's rank, the two swap. */
export function updateRules(current: Rules, patch: unknown): Rules {
  const p = (patch && typeof patch === "object" ? patch : {}) as Partial<Rules>;
  const merged = { ...current, ...p };
  if (p.stopRank && p.stopRank !== "none" && p.stopRank === current.skipRank) {
    merged.skipRank = current.stopRank === "none" ? "none" : (current.stopRank as SkipRank);
  } else if (p.skipRank && p.skipRank !== "none" && p.skipRank === current.stopRank) {
    merged.stopRank = current.skipRank === "none" ? "none" : (current.skipRank as StopRank);
  }
  // A bad value in the patch keeps the room's current one (not the default).
  return normalizeRules(merged, current);
}

/** Short Romanian lines describing the rules (lobby summary, the in-game "Reguli" box). */
export function describeRules(r: Rules): string[] {
  const lines: string[] = [];
  lines.push(`${r.handSize} cărți de jucător, pachet de ${r.jokers ? "54 (cu jokeri)" : "52 (fără jokeri)"}.`);
  lines.push(
    `2 = iei 2, 3 = iei 3${r.jokers ? `, joker negru = iei ${r.jokerBlackDraw}, joker colorat = iei ${r.jokerRedDraw}` : ""}.`,
  );
  lines.push(
    `2 și 3 se pun ${
      r.twoThreeOn === "any" ? "peste orice" : r.twoThreeOn === "color" ? "roșu pe roșu, negru pe negru sau același număr" : "pe aceeași culoare sau același număr"
    }. ${r.mixTwoThree ? "Peste 2 poți da 3 și invers." : "Peste 2 doar 2, peste 3 doar 3."}`,
  );
  if (r.jokers) {
    lines.push(
      `Jokerul se pune ${r.jokerOn === "any" ? "peste orice" : "colorat pe roșu (♥♦), negru pe negru (♠♣)"}${
        r.jokerStack ? "; se adună cu 2 și 3" : "; nu se adună cu 2 și 3"
      }. După joker: ${r.anyOnJoker ? "orice carte" : "roșu/negru ca jokerul"}.`,
    );
  }
  if (r.stopRank !== "none") {
    lines.push(
      `Stop: ${rankWord(r.stopRank)} anulează cărțile de luat${r.stopCancelsSkip ? " și statul o tură" : ""}. Se pune ${
        stopMode(r) === "any"
          ? "peste orice carte"
          : stopMode(r) === "penalty"
            ? "peste orice culoare când ai de luat" + (r.stopCancelsSkip ? " sau de stat" : "") + ", altfel doar pe aceeași culoare sau același număr"
            : "doar pe aceeași culoare sau același număr, și când ai de luat"
      }.`,
    );
  }
  if (r.skipRank !== "none") {
    lines.push(
      `Stai o tură: ${rankWord(r.skipRank)}${r.skipStack ? " (peste el poți da tot " + rankWord(r.skipRank) + " și turele se adună)" : ""}.${
        r.skipOnAnything ? " Se poate pune peste orice." : ""
      }`,
    );
  }
  if (r.changeRank !== "none") {
    lines.push(
      `${rankWord(r.changeRank)} schimbă culoarea${r.changeOnAnything ? " și se pune peste orice" : ""} (nu când ai cărți de luat).`,
    );
  }
  if (r.multiPlay) lines.push("Poți pune deodată mai multe cărți de același număr.");
  if (!r.finishOnSpecial) lines.push("Nu poți termina cu o carte specială.");
  lines.push(r.playAfterDraw ? "Tragi o carte; dacă se potrivește, o poți pune imediat." : "Dacă tragi, ai pierdut tura.");
  if (r.macao) lines.push(`Când rămâi cu o carte zici „Macao”. Cine te prinde înainte îți dă ${r.macaoPenalty} cărți.`);
  lines.push(
    r.turnSeconds > 0
      ? `Ai ${r.turnSeconds} de secunde pe tură; dacă trec, se joacă automat pentru tine (iei / stai / prima carte bună / tragi).`
      : "Fără limită de timp pe tură.",
  );
  lines.push(r.roundEnd === "first" ? "Runda se termină când primul jucător rămâne fără cărți." : "Runda continuă până rămâne un singur jucător cu cărți.");
  return lines;
}

export const rankWord = (r: string) => (r === "A" ? "As" : r === "J" ? "Valet (J)" : r);
