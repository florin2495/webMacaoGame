import { sitOutTurn } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/sit - accept the skip card: sit out this turn (and the stacked ones).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/sit">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => sitOutTurn(deal, player.id), "turn_sat_out", player);
  });
}
