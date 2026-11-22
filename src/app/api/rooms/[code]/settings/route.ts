import { notifyRoom } from "@/lib/server/broadcast";
import { db, T } from "@/lib/server/db";
import { fail, handle, readJson } from "@/lib/server/http";
import { requireHost, requireMember, requireStatus, saveRoom } from "@/lib/server/room";
import { normalizeRules, updateRules } from "@/lib/rules";

// POST /api/rooms/[code]/settings { rules: Partial<Rules> } - host, lobby only (before dealing).
// Unknown keys / bad values are ignored. Resets everyone's "ready", so nobody starts on rules they did not see.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/settings">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    requireHost(room, player);
    requireStatus(room, "lobby");
    const body = await readJson(req);
    if (!body.rules || typeof body.rules !== "object" || Array.isArray(body.rules)) fail(400, "Setare invalidă.");
    const rules = updateRules(normalizeRules(room.rules), body.rules);
    await saveRoom(room, { rules });
    const { error } = await db().from(T.players).update({ ready: false }).eq("room_id", room.id);
    if (error) throw error;
    await notifyRoom(room.id, "settings_changed");
    return { ok: true, rules };
  });
}
