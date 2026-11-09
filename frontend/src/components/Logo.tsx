import { useId } from "react";
import { cn } from "../lib/cn";

/**
 * 픽각 로고 마크.
 * '픽'의 받침 ㄱ(오른쪽 위)과 '각'의 받침 ㄱ(왼쪽 아래, 180° 뒤집음)이 마주 보며 만든 조준 프레임 + 가운데 점
 * = "픽을 조준해서 잠근다(각 잡았다)".
 * 원본: public/favicon.svg (같은 도형)
 */
export function LogoMark({ className }: { className?: string }) {
  const id = useId();
  return (
    <svg viewBox="0 0 64 64" className={cn("size-8 shrink-0", className)} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ff8f3f" />
          <stop offset="1" stopColor="#e2500a" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${id})`} />
      <g fill="none" stroke="#fff" strokeWidth="6.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M30 16.5H47.5V34" />
        <path d="M16.5 30V47.5H34" />
      </g>
      <circle cx="32" cy="32" r="5.5" fill="#fff" />
    </svg>
  );
}
