import { catchMacao } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/catch - counter-macao: everyone left with one card who did not say "Macao" draws the penalty.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/catch">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => catchMacao(deal, player.id), "macao_caught", player);
  });
}
