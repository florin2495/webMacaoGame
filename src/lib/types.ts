import type { Card, LogEntry, Standing, Suit } from "./macao";
import type { Rules } from "./rules";

export type RoomStatus = "lobby" | "playing" | "finished";

export interface PublicPlayer {
  id: string;
  nickname: string;
  isHost: boolean;
  ready: boolean;
  /** Rounds won in this room. */
  wins: number;
  /** Cards left in hand at the end of every round in this room, added up (lower is better). */
  score: number;
  /** Ms left to press "Ignoră" on a pending kick (0-10000), null when none. */
  kickRemainingMs: number | null;
  /** Seen in the last 301 s (see lib/reconnect.ts). False = phone in the background, closed tab, no network. */
  connected: boolean;
  role: "player" | "spectator";
  /** Spectator who asked to join the next round. */
  queued: boolean;
}

/** Outcome of a deal, stored on the room. */
export interface RoundResult {
  /** Set when the deal was cut short (someone left). */
  aborted?: { nickname: string };
  standings: Standing[];
  /** First player out of cards; null when aborted. */
  winner: string | null;
}

/** What a member sees of the running deal. Other players' hands are only counts. */
export interface GameView {
  order: string[];
  rules: Rules;
  turn: string | null;
  /** Last cards of the pile, the top one last. */
  pile: Card[];
  /** Suit chosen with the change-suit card, null otherwise. */
  suit: Suit | null;
  pendingDraw: number;
  pendingSkip: number;
  sitOut: Record<string, number>;
  handCounts: Record<string, number>;
  stockCount: number;
  finished: string[];
  /** Who said "Macao" (and still holds one or two cards). */
  macao: Record<string, boolean>;
  log: LogEntry[];
  moves: number;
  hand: Card[];
  /** Single cards the caller may put down right now. */
  legal: Card[];
  /** The card the caller just drew and may still put down. */
  drawn: Card | null;
  canDraw: boolean;
  canPass: boolean;
  canTake: boolean;
  canSit: boolean;
}

export interface RoomState {
  room: {
    id: string;
    code: string;
    name: string;
    rules: Rules;
    status: RoomStatus;
    round: number;
    /** Bumped on every deal write: lets the client drop stale / duplicate state. */
    version: number;
    hasPassword: boolean;
    hostPlayerId: string | null;
  };
  /** Seat order while playing, saved seat order otherwise. */
  players: PublicPlayer[];
  /** Watchers (max 16), queued ones first. Never get hands. */
  spectators: PublicPlayer[];
  me: PublicPlayer;
  game: GameView | null;
  result: RoundResult | null;
}

/** Item of the public room list (GET /api/rooms). */
export interface RoomListItem {
  code: string;
  name: string;
  hasPassword: boolean;
  status: RoomStatus;
  /** Seated players. */
  players: number;
  spectators: number;
}

export interface Session {
  playerId: string;
  token: string;
}
