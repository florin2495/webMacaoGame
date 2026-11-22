import { sayMacao } from "@/lib/macao";
import { handle } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/macao - say "Macao" (at most two cards in hand, any time).
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/macao">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    return await applyMove(room, (deal) => sayMacao(deal, player.id), "macao_said", player);
  });
}
