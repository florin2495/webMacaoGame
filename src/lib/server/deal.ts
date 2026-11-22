import "server-only";
import { MAX_PLAYERS, MIN_PLAYERS, newDeal, roundLeader } from "@/lib/macao";
import { normalizeRules } from "@/lib/rules";
import { notifyRoom } from "./broadcast";
import { db, type RoomRow, T } from "./db";
import { fail } from "./http";
import { listPlayers, listSpectators, saveRoom } from "./room";

/** Deals round `round` to everyone in the room (host only, checked by the caller). `by` = the host's player id. */
export async function startDeal(room: RoomRow, round: number, requireReady: boolean, by: string): Promise<void> {
  const players = await listPlayers(room.id);
  if (players.length < MIN_PLAYERS) fail(409, `Ai nevoie de cel puțin ${MIN_PLAYERS} jucători.`);
  if (players.length > MAX_PLAYERS) fail(409, `Maxim ${MAX_PLAYERS} jucători.`);
  if (requireReady) {
    const notReady = players.filter((p) => !p.ready);
    if (notReady.length > 0) fail(409, `Nu sunt toți gata: ${notReady.map((p) => p.nickname).join(", ")}.`);
  }
  const order = players.map((p) => p.id);
  const deal = { ...newDeal(order, roundLeader(order, round), normalizeRules(room.rules)), turnSince: Date.now() };
  await saveRoom(room, { status: "playing", round, deal, result: null });
  const { error } = await db().from(T.players).update({ kick_requested_at: null }).eq("room_id", room.id);
  if (error) throw error;
  await notifyRoom(room.id, "deal_started", room.version + 1, by);
}

/**
 * Spectators who queued ("Intră la runda următoare") become players, in queue order, while seats are free.
 * The rest stay spectators. Called before a new round / when going back to the lobby.
 */
export async function promoteQueued(room: RoomRow): Promise<number> {
  const players = await listPlayers(room.id);
  const queued = (await listSpectators(room.id)).filter((s) => s.queued_at !== null);
  let seat = players.reduce((m, p) => Math.max(m, p.seat), -1) + 1;
  let count = players.length;
  let promoted = 0;
  for (const s of queued) {
    if (count >= MAX_PLAYERS) break;
    const { error } = await db()
      .from(T.players)
      .update({ role: "player", queued_at: null, seat: seat++, ready: false, wins: 0, score: 0 })
      .eq("id", s.id)
      .eq("role", "spectator");
    if (error) throw error;
    count++;
    promoted++;
  }
  return promoted;
}
