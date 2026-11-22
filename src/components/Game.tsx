"use client";

import { useState } from "react";
import { PREF_CONFIRM_PLAY, useBoolPref } from "@/lib/client/prefs";
import {
  type Card as CardT,
  cardLabel,
  isJoker,
  kindOf,
  type LogEntry,
  movedOrder,
  RANKS,
  rankOf,
  SUIT_NAME,
  SUIT_SYMBOL,
  SUITS,
  type Suit,
  suitOf,
} from "@/lib/macao";
import type { GameView, PublicPlayer, RoomState } from "@/lib/types";
import { KickBadge, OfflineBadge } from "./KickBadge";
import { CardBack, PlayingCard } from "./PlayingCard";
import { Button, Card, ErrorText } from "./ui";
import { useAction } from "./useAction";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const cardsWord = (n: number) => plural(n, "carte", "cărți");

/** Hand order on screen: by suit (♠ ♥ ♣ ♦ alternating colors), then rank; jokers last. */
const SUIT_ORDER: Suit[] = ["S", "H", "C", "D"];
function sortHand(hand: CardT[]): CardT[] {
  const key = (c: CardT) => (isJoker(c) ? 100 + (c === "XR" ? 1 : 0) : SUIT_ORDER.indexOf(suitOf(c)!) * 20 + RANKS.indexOf(rankOf(c) as (typeof RANKS)[number]));
  return [...hand].sort((a, b) => key(a) - key(b));
}

export function Game({
  state,
  token,
  refresh,
  applyState,
}: {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  applyState: (state: RoomState) => void;
}) {
  const { room, players, me, game } = state;
  const isHost = room.hostPlayerId === me.id;
  const { busy, error, run } = useAction(room.code, token, refresh, applyState);
  const [confirmPlay] = useBoolPref(PREF_CONFIRM_PLAY, false);
  const [selected, setSelected] = useState<CardT[]>([]);
  const [askSuit, setAskSuit] = useState<CardT[] | null>(null);
  const [moveSeen, setMoveSeen] = useState(-1);

  const byId = new Map([...players, ...state.spectators].map((p) => [p.id, p]));
  const nick = (id: string | null | undefined) => (id ? (byId.get(id)?.nickname ?? "cineva") : "cineva");

  // A new move on the server clears any half-made selection.
  if (game && game.moves !== moveSeen) {
    setMoveSeen(game.moves);
    if (selected.length > 0) setSelected([]);
    if (askSuit) setAskSuit(null);
  }

  if (!game) {
    return (
      <Card>
        <FinishedPanel state={state} isHost={isHost} busy={busy} run={run} nick={nick} />
        <ErrorText>{error}</ErrorText>
      </Card>
    );
  }

  const r = game.rules;
  const finished = room.status === "finished";
  const myTurn = game.turn === me.id && !finished;
  const inDeal = game.order.includes(me.id);
  const stillPlaying = inDeal && !game.finished.includes(me.id) && !finished;
  const hand = sortHand(game.hand);
  const selRank = selected.length > 0 ? rankOf(selected[0]) : null;

  /** A card can be tapped: legal on its own, or (while selecting) the same rank as the selection. */
  const tappable = (c: CardT) => {
    if (!myTurn || busy) return false;
    if (selRank !== null) return rankOf(c) === selRank;
    return game.legal.includes(c);
  };

  function send(cards: CardT[], suit?: Suit) {
    setSelected([]);
    setAskSuit(null);
    void run("play", suit ? { cards, suit } : { cards });
  }

  function playOrAskSuit(cards: CardT[]) {
    if (kindOf(cards[0], r) === "change") setAskSuit(cards);
    else send(cards);
  }

  function tapCard(c: CardT) {
    if (!tappable(c)) return;
    if (selected.includes(c)) {
      setSelected(selected.filter((x) => x !== c));
      return;
    }
    if (selected.length > 0) {
      setSelected([...selected, c]);
      return;
    }
    const twins = r.multiPlay && !game!.drawn && hand.some((x) => x !== c && rankOf(x) === rankOf(c));
    if (confirmPlay || twins) {
      setSelected([c]);
      return;
    }
    playOrAskSuit([c]);
  }

  const status = statusText(game, me.id, nick, finished);
  const isSpectator = me.role === "spectator";
  const anchorIdx = Math.max(game.order.indexOf(isSpectator ? game.order[0] : me.id), 0);
  const n = game.order.length;
  const ring = Array.from({ length: n }, (_, k) => game.order[(anchorIdx + k) % n]);
  const others = isSpectator || !inDeal ? ring : ring.slice(1);
  const top = game.pile[game.pile.length - 1];

  return (
    <>
      {finished && (
        <Card>
          <FinishedPanel state={state} isHost={isHost} busy={busy} run={run} nick={nick} />
          <ErrorText>{error}</ErrorText>
        </Card>
      )}

      <Card className="flex flex-col gap-2">
        <div className={`grid gap-1.5 ${others.length <= 2 ? "grid-cols-2" : "grid-cols-3"}`}>
          {others.map((id) => (
            <Seat
              key={id}
              player={byId.get(id)}
              seatNo={game.order.indexOf(id) + 1}
              count={game.handCounts[id] ?? 0}
              isTurn={game.turn === id && !finished}
              place={game.finished.indexOf(id) + 1}
              saidMacao={game.macao[id] === true}
              sitOut={game.sitOut[id] ?? 0}
              canSkip={isHost && id !== me.id && game.turn === id && !finished}
              canKick={isHost && id !== me.id}
              busy={busy !== null}
              onKick={() => {
                const target = byId.get(id);
                if (!target) return;
                const msg = !finished
                  ? `Scoți jucătorul ${target.nickname} din cameră? Are 10 secunde să refuze; dacă nu, runda continuă fără el.`
                  : `Scoți jucătorul ${target.nickname} din cameră?`;
                if (window.confirm(msg)) void run("kick", { playerId: id });
              }}
              onSkip={() => {
                if (window.confirm(`Joci în locul lui ${nick(id)}? (ia cărțile / stă, altfel pune prima carte bună sau trage)`)) void run("skip");
              }}
            />
          ))}
        </div>

        <Table game={game} top={top} canDraw={game.canDraw && busy === null} onDraw={() => void run("draw")} />

        <p
          className={`text-center text-sm font-semibold ${myTurn ? "text-indigo-600 dark:text-indigo-400" : "text-zinc-600 dark:text-zinc-300"}`}
          role="status"
          data-testid="game-status"
        >
          {status}
        </p>

        {myTurn && (game.canTake || game.canSit || game.canPass || game.canDraw) && (
          <div className="flex flex-wrap justify-center gap-2">
            {game.canTake && (
              <Button variant="danger" disabled={busy !== null} onClick={() => void run("take")} data-testid="take">
                Iau {cardsWord(game.pendingDraw)}
              </Button>
            )}
            {game.canSit && (
              <Button variant="danger" disabled={busy !== null} onClick={() => void run("sit")} data-testid="sit">
                Stau {game.pendingSkip === 1 ? "o tură" : `${game.pendingSkip} ture`}
              </Button>
            )}
            {game.canDraw && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void run("draw")} data-testid="draw">
                Trag o carte
              </Button>
            )}
            {game.canPass && (
              <Button variant="secondary" disabled={busy !== null} onClick={() => void run("pass")} data-testid="pass">
                Păstrez cartea, trec
              </Button>
            )}
          </div>
        )}

        {stillPlaying && (
          <div className={`rounded-xl border p-1.5 ${myTurn ? "border-indigo-400 ring-2 ring-indigo-500" : "border-zinc-200 dark:border-zinc-800"}`}>
            <div className="flex flex-wrap justify-center gap-1" data-testid="my-hand">
              {hand.map((c) => {
                const can = tappable(c);
                const isSel = selected.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => tapCard(c)}
                    disabled={!can && !isSel}
                    className={`rounded-lg transition-transform ${can ? "enabled:hover:-translate-y-1" : myTurn ? "opacity-40" : ""} ${
                      isSel ? "-translate-y-2 ring-4 ring-indigo-500" : ""
                    } ${game.drawn === c ? "ring-2 ring-amber-400" : ""}`}
                    aria-label={`Joacă ${cardLabel(c)}`}
                    data-card={c}
                    data-legal={game.legal.includes(c)}
                  >
                    <PlayingCard card={c} size="lg" />
                  </button>
                );
              })}
            </div>
            {selected.length > 0 && !askSuit && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button disabled={busy !== null || !selected.some((c) => game.legal.includes(c))} onClick={() => playOrAskSuit(selected)} data-testid="play-selected">
                  Pune {selected.length === 1 ? cardLabel(selected[0]) : `${selected.length} cărți`}
                </Button>
                <Button variant="secondary" onClick={() => setSelected([])}>
                  Renunț
                </Button>
              </div>
            )}
            {askSuit && (
              <div className="mt-2 flex flex-col gap-2" data-testid="suit-picker">
                <p className="text-center text-sm font-semibold">Ce culoare ceri?</p>
                <div className="grid grid-cols-4 gap-2">
                  {SUITS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      disabled={busy !== null}
                      onClick={() => send(askSuit, s)}
                      className={`min-h-12 rounded-lg border border-zinc-300 bg-white text-3xl dark:border-zinc-700 ${s === "H" || s === "D" ? "text-rose-600" : "text-zinc-900"}`}
                      aria-label={SUIT_NAME[s]}
                      data-testid={`suit-${s}`}
                    >
                      {SUIT_SYMBOL[s]}
                    </button>
                  ))}
                </div>
                <Button variant="secondary" onClick={() => setAskSuit(null)}>
                  Renunț
                </Button>
              </div>
            )}
          </div>
        )}
        {inDeal && !stillPlaying && !finished && (
          <p className="text-center text-sm text-emerald-600">Ai terminat pe locul {game.finished.indexOf(me.id) + 1}. Privești restul rundei.</p>
        )}

        <ErrorText>{error}</ErrorText>

        {/* Deliberately low-key: nobody should be able to tell from the screen who has something to say. */}
        {r.macao && inDeal && !finished && (
          <div className="flex justify-end gap-2">
            {stillPlaying && (
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void run("macao")}
                className="min-h-8 rounded-md px-2 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
                data-testid="macao"
              >
                Macao
              </button>
            )}
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void run("catch")}
              className="min-h-8 rounded-md px-2 text-xs text-zinc-400 hover:text-zinc-600 dark:text-zinc-500 dark:hover:text-zinc-300"
              data-testid="catch"
            >
              Contra-Macao
            </button>
          </div>
        )}
      </Card>

      <GameLog log={game.log} nick={nick} />
    </>
  );
}

function statusText(game: GameView, meId: string, nick: (id: string | null) => string, finished: boolean): string {
  if (finished) return "Runda s-a terminat.";
  const suit = game.suit ? ` (se cere ${SUIT_SYMBOL[game.suit]})` : "";
  if (game.turn === meId) {
    if (game.pendingDraw > 0) return `Ai de luat ${cardsWord(game.pendingDraw)}: dă mai departe, oprește, sau ia-le.`;
    if (game.pendingSkip > 0) return game.legal.length > 0 ? "Stai o tură: dă mai departe, sau stai." : "Stai o tură.";
    if (game.drawn) return "Ai tras o carte care se potrivește: o pui sau treci.";
    return game.legal.length > 0 ? `E rândul tău${suit}.` : `E rândul tău${suit}: n-ai ce pune, trage o carte.`;
  }
  if (game.pendingDraw > 0) return `${nick(game.turn)} are de luat ${cardsWord(game.pendingDraw)}…`;
  if (game.pendingSkip > 0) return `${nick(game.turn)} stă o tură, dacă nu dă mai departe…`;
  return `Așteaptă pe ${nick(game.turn)}${suit}…`;
}

/** The pile (last cards, top one on the right), the stock and what is running (cards to draw, skip, chosen suit). */
function Table({ game, top, canDraw, onDraw }: { game: GameView; top: CardT; canDraw: boolean; onDraw: () => void }) {
  const under = game.pile.slice(-3, -1);
  return (
    <div className="relative flex h-36 w-full items-center justify-center gap-6 rounded-2xl bg-emerald-800 shadow-inner" data-testid="pile" data-top={top}>
      <button
        type="button"
        onClick={onDraw}
        disabled={!canDraw}
        className="flex flex-col items-center gap-1 text-[10px] font-semibold text-emerald-50 disabled:cursor-default"
        aria-label="Trage o carte"
      >
        {game.stockCount > 0 ? <CardBack size="md" className={canDraw ? "ring-2 ring-amber-300" : ""} /> : <span className="flex h-20 w-14 items-center justify-center rounded-lg border-2 border-dashed border-emerald-500/60">gol</span>}
        {game.stockCount} în pachet
      </button>
      <div className="relative flex items-center">
        {under.map((c, i) => (
          <span key={`${c}-${i}`} className="-mr-9 opacity-80" style={{ transform: `rotate(${(i - under.length) * 8}deg)` }}>
            <PlayingCard card={c} size="md" />
          </span>
        ))}
        <span className="relative">
          <PlayingCard card={top} size="md" className="ring-2 ring-amber-300" />
        </span>
      </div>
      <div className="absolute inset-x-2 bottom-1 flex justify-center gap-2 text-[11px] font-bold">
        {game.suit && (
          <span className={`rounded-full bg-white px-2 ${game.suit === "H" || game.suit === "D" ? "text-rose-600" : "text-zinc-900"}`} data-testid="chosen-suit">
            se cere {SUIT_SYMBOL[game.suit]}
          </span>
        )}
        {game.pendingDraw > 0 && <span className="rounded-full bg-rose-600 px-2 text-white">+{game.pendingDraw} de luat</span>}
        {game.pendingSkip > 0 && <span className="rounded-full bg-amber-500 px-2 text-white">stai {game.pendingSkip === 1 ? "o tură" : `${game.pendingSkip} ture`}</span>}
      </div>
    </div>
  );
}

function Seat({
  player,
  seatNo,
  count,
  isTurn,
  place,
  saidMacao,
  sitOut,
  canSkip,
  canKick,
  busy,
  onKick,
  onSkip,
}: {
  player: PublicPlayer | undefined;
  seatNo: number;
  count: number;
  isTurn: boolean;
  /** 1-based finishing place, 0 = still playing. */
  place: number;
  saidMacao: boolean;
  sitOut: number;
  canSkip: boolean;
  canKick: boolean;
  busy: boolean;
  onKick: () => void;
  onSkip: () => void;
}) {
  const shown = Math.min(count, 7);
  return (
    <div
      data-testid="seat"
      data-player-id={player?.id}
      data-turn={isTurn}
      data-count={count}
      className={`relative flex min-w-0 flex-col items-center gap-1 rounded-xl border border-zinc-200 bg-white p-1.5 text-center dark:border-zinc-800 dark:bg-zinc-950 ${
        isTurn ? "ring-2 ring-indigo-500" : ""
      }`}
    >
      <span className="max-w-full truncate px-1 text-sm font-semibold">
        {isTurn && "▶ "}
        {player?.nickname ?? "?"}
      </span>
      <span className="flex min-h-4 flex-wrap justify-center gap-1">
        <span className="rounded-full bg-zinc-200 px-1.5 text-[9px] font-bold text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" title="Locul în ordinea de joc">
          {seatNo}
        </span>
        {place > 0 && <span className="rounded-full bg-emerald-600 px-1.5 text-[9px] font-bold uppercase text-white">locul {place}</span>}
        {saidMacao && <span className="rounded-full bg-amber-400 px-1.5 text-[9px] font-bold uppercase text-zinc-900">macao</span>}
        {sitOut > 0 && <span className="rounded-full bg-zinc-500 px-1.5 text-[9px] font-bold uppercase text-white">stă {sitOut}</span>}
      </span>
      <OfflineBadge connected={player?.connected} />
      <KickBadge remainingMs={player?.kickRemainingMs ?? null} />
      <span className="flex h-7 items-center">
        {Array.from({ length: shown }, (_, i) => (
          <CardBack key={i} size="sm" className={`!h-7 !w-5 ${i > 0 ? "-ml-3" : ""}`} />
        ))}
        <span className="ml-1 text-xs font-bold text-zinc-500">{count === 0 ? "fără cărți" : count}</span>
      </span>
      {canKick && player && player.kickRemainingMs === null && (
        <button
          type="button"
          disabled={busy}
          onClick={onKick}
          className="min-h-7 max-w-full rounded-md border border-rose-300 px-2 text-[11px] font-semibold leading-tight text-rose-600 disabled:opacity-40 dark:border-rose-800 dark:text-rose-400"
          aria-label={`Scoate pe ${player.nickname}`}
        >
          Scoate
        </button>
      )}
      {canSkip && (
        <button
          type="button"
          disabled={busy}
          onClick={onSkip}
          className="min-h-7 max-w-full rounded-md border border-zinc-300 px-2 text-[11px] font-semibold leading-tight text-zinc-600 disabled:opacity-40 dark:border-zinc-700 dark:text-zinc-300"
        >
          Joacă pentru el
        </button>
      )}
    </div>
  );
}

function logText(e: LogEntry, nick: (id: string) => string): string {
  switch (e.type) {
    case "play":
      return `${nick(e.playerId)} a pus ${e.cards.map(cardLabel).join(", ")}${e.suit ? ` și cere ${SUIT_SYMBOL[e.suit]}` : ""}`;
    case "draw":
      return e.count > 0 ? `${nick(e.playerId)} a tras o carte` : `${nick(e.playerId)} n-a mai avut ce trage`;
    case "take":
      return `${nick(e.playerId)} a luat ${cardsWord(e.count)}`;
    case "sit":
      return `${nick(e.playerId)} stă ${e.turns === 1 ? "o tură" : `${e.turns} ture`}`;
    case "sat":
      return `${nick(e.playerId)} a stat o tură`;
    case "pass":
      return `${nick(e.playerId)} a trecut`;
    case "macao":
      return `${nick(e.playerId)}: „Macao!”`;
    case "caught":
      return `${nick(e.by)} l-a prins pe ${nick(e.playerId)} fără „Macao”: ia ${cardsWord(e.count)}`;
    case "out":
      return `${nick(e.playerId)} a terminat cărțile (locul ${e.place})`;
    case "left":
      return "Un jucător a ieșit din cameră; runda continuă fără el";
  }
}

function GameLog({ log, nick }: { log: LogEntry[]; nick: (id: string) => string }) {
  if (log.length === 0) return null;
  return (
    <ul className="flex flex-col gap-0.5 px-1 text-xs text-zinc-500" data-testid="game-log">
      {log
        .slice(-5)
        .reverse()
        .map((e, i) => (
          <li key={`${log.length}-${i}`} className={i === 0 ? "font-semibold text-zinc-700 dark:text-zinc-300" : ""}>
            {logText(e, nick)}
          </li>
        ))}
    </ul>
  );
}

/** Host-only up/down arrows to set the play order (first = starts the next round). */
export function OrderControls({
  state,
  busy,
  run,
  nextRound,
}: {
  state: RoomState;
  busy: string | null;
  run: (action: string, body?: unknown) => Promise<void>;
  /** Round number the order applies to (round 1 starts with the first player, then it moves one seat each round). */
  nextRound: number;
}) {
  const { players } = state;
  const ids = players.map((p) => p.id);
  const startIdx = players.length > 0 ? (((nextRound - 1) % players.length) + players.length) % players.length : 0;
  return (
    <ol className="mx-auto flex w-full max-w-xs flex-col gap-1 text-left text-sm">
      {players.map((p, i) => {
        const up = movedOrder(ids, p.id, -1);
        const down = movedOrder(ids, p.id, 1);
        const btn = "min-h-8 min-w-8 rounded-md border border-zinc-300 text-sm font-bold disabled:opacity-30 dark:border-zinc-700";
        return (
          <li key={p.id} className="flex items-center justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-900">
            <span className="min-w-0 truncate">
              <span className="mr-2 text-xs font-bold text-zinc-500">{i + 1}</span>
              {p.nickname}
              {i === startIdx && <span className="ml-2 text-[10px] font-bold uppercase text-amber-600">începe</span>}
            </span>
            <span className="flex shrink-0 gap-1">
              <button type="button" className={btn} disabled={busy !== null || !up} onClick={() => up && void run("reorder", { order: up })} aria-label={`Mută ${p.nickname} mai sus`}>
                ↑
              </button>
              <button type="button" className={btn} disabled={busy !== null || !down} onClick={() => down && void run("reorder", { order: down })} aria-label={`Mută ${p.nickname} mai jos`}>
                ↓
              </button>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function FinishedPanel({
  state,
  isHost,
  busy,
  run,
  nick,
}: {
  state: RoomState;
  isHost: boolean;
  busy: string | null;
  run: (action: string, body?: unknown) => Promise<void>;
  nick: (id: string | null) => string;
}) {
  const { result, players, room, me } = state;
  if (!result) return null;
  const iWon = result.winner === me.id;

  return (
    <div className="flex flex-col gap-3 text-center" data-testid="finished-panel">
      {result.aborted ? (
        <p className="text-lg font-bold">Runda s-a anulat: {result.aborted.nickname} a plecat.</p>
      ) : (
        <p className="text-2xl font-black">
          🏆 {nick(result.winner)} câștigă!
          {iWon && <span className="block text-sm font-semibold text-emerald-600">Felicitări!</span>}
        </p>
      )}
      <ol className="mx-auto flex w-full max-w-xs flex-col gap-1 text-sm">
        {result.standings.map((s) => (
          <li key={s.playerId} className="flex justify-between gap-2 rounded-lg bg-zinc-100 px-3 py-1 dark:bg-zinc-900">
            <span className="truncate">
              <b>{s.place}.</b> {nick(s.playerId)}
            </span>
            <span className="shrink-0 font-bold">{s.cardsLeft === 0 ? "fără cărți" : cardsWord(s.cardsLeft)}</span>
          </li>
        ))}
      </ol>
      <p className="text-xs text-zinc-500">
        Runde câștigate / scor (cărți rămase, adunate): {players.map((p) => `${p.nickname} ${p.wins} / ${p.score}`).join(" · ")}
      </p>
      {isHost ? (
        <>
          <div className="flex flex-col gap-1">
            <h3 className="text-sm font-bold">Ordinea la runda următoare</h3>
            <OrderControls state={state} busy={busy} run={run} nextRound={room.round + 1} />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={busy !== null} onClick={() => void run("new-round")} data-testid="new-round">
              {busy === "new-round" ? "Se împarte…" : "Rundă nouă"}
            </Button>
            <Button variant="secondary" disabled={busy !== null} onClick={() => void run("lobby")} data-testid="back-to-lobby">
              Înapoi în lobby
            </Button>
          </div>
          <p className="text-xs text-zinc-500">Regulile se schimbă din lobby.</p>
        </>
      ) : (
        <p className="text-sm text-zinc-500">Host-ul pornește runda următoare.</p>
      )}
    </div>
  );
}
