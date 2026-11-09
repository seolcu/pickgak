import type { Hero } from "../lib/api";
import { cn } from "../lib/cn";

const SIZES = { xs: "size-6", sm: "size-8", tile: "size-10", md: "size-11", lg: "size-14" } as const;

export function HeroAvatar({
  hero,
  size = "md",
  className,
}: {
  hero: Hero | undefined;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  return (
    <span
      className={cn("inline-block shrink-0 overflow-hidden rounded-lg bg-surface-2", SIZES[size], className)}
      style={hero?.color ? { backgroundColor: hero.color } : undefined}
    >
      {hero?.thumbnail && (
        <img src={hero.thumbnail} alt="" loading="lazy" className="size-full object-cover" draggable={false} />
      )}
    </span>
  );
}
