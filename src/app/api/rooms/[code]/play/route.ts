import { isCard, isSuit, playCards } from "@/lib/macao";
import { fail, handle, readJson } from "@/lib/server/http";
import { applyMove, requireMember } from "@/lib/server/room";

// POST /api/rooms/[code]/play { cards: Card[], suit? } - put one or more cards of the same rank down on your turn
// (`card` alone is accepted too). `suit` is required for the change-suit card.
export async function POST(req: Request, ctx: RouteContext<"/api/rooms/[code]/play">) {
  return handle(async () => {
    const { code } = await ctx.params;
    const { room, player } = await requireMember(req, code);
    const body = await readJson(req);
    const cards: unknown[] = Array.isArray(body.cards) ? body.cards : [body.card];
    if (cards.length === 0 || cards.length > 8 || !cards.every(isCard)) fail(400, "Carte invalidă.");
    const suit = isSuit(body.suit) ? body.suit : null;
    return await applyMove(room, (deal) => playCards(deal, player.id, cards as string[], suit), "card_played", player);
  });
}
