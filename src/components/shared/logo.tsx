import Link from "next/link";
import { CandlestickChart } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The TradeMarkk logo. Renders the wordmark as ONE flex child so flex `gap`
 * never splits "Trade" and "Mark". Always a link (dashboard inside the app,
 * home elsewhere).
 */
export function Logo({
  href = "/",
  className,
  iconClassName,
}: {
  href?: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <Link
      href={href}
      aria-label="TradeMarkk"
      className={cn("flex w-fit items-center gap-2 font-semibold", className)}
    >
      <CandlestickChart className={cn("h-5 w-5 shrink-0 text-accent", iconClassName)} aria-hidden />
      <span>
        Trade<span className="text-accent">Mark</span>
      </span>
    </Link>
  );
}
