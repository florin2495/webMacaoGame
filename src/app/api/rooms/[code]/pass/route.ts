import { passTurn } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/pass - after drawing a card that fits, keep it and end the turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/pass">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => passTurn(deal, player.id), "turn_passed", player);
  });
}
