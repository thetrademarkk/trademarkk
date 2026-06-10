import { cn, formatINR } from "@/lib/utils";

export function PnlText({
  value,
  className,
  decimals = false,
  signed = true,
}: {
  value: number;
  className?: string;
  decimals?: boolean;
  signed?: boolean;
}) {
  return (
    <span
      className={cn(
        "font-money",
        value > 0 ? "text-profit" : value < 0 ? "text-loss" : "text-muted",
        className
      )}
    >
      {formatINR(value, { decimals, signed })}
    </span>
  );
}
