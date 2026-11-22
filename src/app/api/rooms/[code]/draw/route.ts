import { drawCard } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/draw - draw one card on your turn (no penalty running).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/draw">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => drawCard(deal, player.id), "card_drawn", player);
  });
}
