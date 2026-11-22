import { type Card, cardLabel, isJoker, isRed, rankOf, SUIT_SYMBOL, suitOf } from "@/lib/macao";

const SIZES = {
  xs: "h-12 w-9 text-xs",
  sm: "h-14 w-10 text-sm",
  md: "h-20 w-14 text-lg",
  lg: "h-[5.5rem] w-[3.75rem] text-lg sm:h-24 sm:w-[4.25rem] sm:text-xl",
};

/** A face-up playing card drawn with CSS (no images). Jokers: "XB" black, "XR" colored. */
export function PlayingCard({
  card,
  size = "md",
  className = "",
}: {
  card: Card;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const base = `relative inline-flex shrink-0 select-none flex-col justify-between rounded-lg border border-zinc-300 bg-white p-1 font-bold leading-none shadow-sm ${SIZES[size]} ${className}`;
  if (isJoker(card)) {
    const red = isRed(card);
    return (
      <span className={`${base} ${red ? "text-rose-600" : "text-zinc-900"}`} aria-label={cardLabel(card)}>
        <span className="text-left text-[0.6em] tracking-tight">JOKER</span>
        <span
          className={`absolute inset-0 flex items-center justify-center text-[1.7em] ${
            red ? "bg-gradient-to-br from-rose-500 via-amber-400 to-indigo-500 bg-clip-text text-transparent" : ""
          }`}
        >
          ★
        </span>
        <span className="rotate-180 text-left text-[0.6em] tracking-tight">JOKER</span>
      </span>
    );
  }
  const rank = rankOf(card);
  const suit = SUIT_SYMBOL[suitOf(card)!];
  return (
    <span className={`${base} ${isRed(card) ? "text-rose-600" : "text-zinc-900"}`} aria-label={cardLabel(card)}>
      <span className="text-left">
        {rank}
        <span className="block text-[0.8em]">{suit}</span>
      </span>
      <span className="absolute inset-0 flex items-center justify-center text-[1.6em] opacity-90">{suit}</span>
      <span className="rotate-180 text-left">{rank}</span>
    </span>
  );
}

/** Face-down card (other players' hands, the stock). */
export function CardBack({ size = "sm", className = "" }: { size?: keyof typeof SIZES; className?: string }) {
  return (
    <span
      aria-hidden
      className={`inline-block shrink-0 rounded-lg border-2 border-white bg-indigo-700 bg-[repeating-linear-gradient(45deg,transparent_0_4px,rgba(255,255,255,0.15)_4px_8px)] shadow-sm dark:border-zinc-300 ${SIZES[size]} ${className}`}
    />
  );
}
