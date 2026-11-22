import { takePenalty } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/take - take the cards to draw (2 / 3 / jokers) and end the turn.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/take">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => takePenalty(deal, player.id), "penalty_taken", player);
  });
}
