import "server-only";
import { isDealOver, MIN_PLAYERS, removeFromDeal, standings } from "@/lib/macao";
import type { RoundResult } from "@/lib/types";
import { notifyRoom } from "./broadcast";
import { db, PLAYER_COLUMNS, type PlayerRow, type RoomRow, T } from "./db";
import { dealResult, getRoomByCode, listPlayers, recordRoundEnd } from "./room";
import { isKickExpired, KICK_ENFORCE_MS } from "@/lib/kick";

/**
 * Removes a player from a room (used by both "leave" and the host's "kick").
 *  - last player out: the room is deleted
 *  - host removed: host passes to the next player in join order
 *  - during a deal: the round goes on without them (their cards go under the stock); with fewer than two
 *    players left it is cancelled (status finished, no winner).
 */
export async function removePlayer(room: RoomRow, player: PlayerRow, reason: string): Promise<{ roomClosed: boolean }> {
  if (player.role === "spectator") {
    // A watcher leaving changes nothing about the game.
    const { error } = await db().from(T.players).delete().eq("id", player.id);
    if (error) throw error;
    await notifyRoom(room.id, reason);
    return { roomClosed: false };
  }
  // The room write is conditional on the version read (like saveRoom): a move made meanwhile is never lost.
  // On a clash the room is read again and the removal recomputed.
  let current = room;
  for (let attempt = 0; attempt < 5; attempt++) {
    const outcome = await tryRemove(current, player, reason);
    if (outcome !== "retry") return outcome;
    current = await getRoomByCode(room.code);
  }
  throw new Error("removePlayer: the room kept changing");
}

async function tryRemove(room: RoomRow, player: PlayerRow, reason: string): Promise<{ roomClosed: boolean } | "retry"> {
  const now = new Date().toISOString();
  const remaining = (await listPlayers(room.id)).filter((p) => p.id !== player.id);

  if (remaining.length === 0) {
    const { error } = await db().from(T.rooms).delete().eq("id", room.id);
    if (error) throw error;
    return { roomClosed: true };
  }

  const newHostId = room.host_player_id === player.id ? remaining[0].id : room.host_player_id;
  const update: Record<string, unknown> = {
    host_player_id: newHostId,
    updated_at: now,
    last_activity_at: now,
    version: room.version + 1,
  };

  // During a deal the round goes on without the player; it is cancelled only when fewer than MIN_PLAYERS remain,
  // and finishes normally when their leaving ends it (round end "last": one player left with cards).
  let finishedDeal: { deal: NonNullable<RoomRow["deal"]>; result: RoundResult } | null = null;
  if (room.status === "playing" && room.deal?.order.includes(player.id)) {
    const next = removeFromDeal(room.deal, player.id);
    if (next.order.length < MIN_PLAYERS) {
      const result: RoundResult = { aborted: { nickname: player.nickname }, standings: standings(next), winner: null };
      update.status = "finished";
      update.result = result;
    } else if (isDealOver(next)) {
      const result = dealResult(next);
      update.deal = next;
      update.status = "finished";
      update.result = result;
      finishedDeal = { deal: next, result };
    } else {
      update.deal = next;
    }
  }

  // Update the room first so the host never points at a deleted player.
  const { data: written, error: roomError } = await db()
    .from(T.rooms)
    .update(update)
    .eq("id", room.id)
    .eq("version", room.version)
    .select("id");
  if (roomError) throw roomError;
  if (!written || written.length === 0) return "retry";

  if (newHostId && newHostId !== room.host_player_id) {
    const { error } = await db().from(T.players).update({ is_host: true }).eq("id", newHostId);
    if (error) throw error;
  }

  const { error: deleteError } = await db().from(T.players).delete().eq("id", player.id);
  if (deleteError) throw deleteError;
  if (finishedDeal) await recordRoundEnd(room, finishedDeal.deal, finishedDeal.result);

  await notifyRoom(room.id, reason, room.version + 1);
  return { roomClosed: false };
}

/**
 * Lazy enforcement of pending kicks (serverless: no timers). Runs from requireMember, i.e. at the start of
 * /state and of every room action. Each expired player is claimed atomically (clear kick_requested_at
 * where it still has the value we read) so concurrent requests never remove the same player twice;
 * only the request that got the row runs removePlayer. Returns true when somebody was removed.
 */
export async function enforceExpiredKicks(room: RoomRow): Promise<boolean> {
  const cutoff = new Date(Date.now() - KICK_ENFORCE_MS).toISOString();
  const { data, error } = await db()
    .from(T.players)
    .select(PLAYER_COLUMNS)
    .eq("room_id", room.id)
    .lt("kick_requested_at", cutoff);
  if (error) throw error;
  const expired = ((data ?? []) as PlayerRow[]).filter((p) => isKickExpired(p.kick_requested_at, Date.now()));
  let removed = false;
  let current = room;
  for (const p of expired) {
    const { data: claimed, error: claimError } = await db()
      .from(T.players)
      .update({ kick_requested_at: null })
      .eq("id", p.id)
      .eq("kick_requested_at", p.kick_requested_at)
      .select(PLAYER_COLUMNS);
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) continue; // another request got it
    const { roomClosed } = await removePlayer(current, claimed[0] as PlayerRow, "player_kicked");
    removed = true;
    if (roomClosed) break;
    current = await getRoomByCode(room.code); // re-read: removePlayer bumped the version / host / status
  }
  return removed;
}
