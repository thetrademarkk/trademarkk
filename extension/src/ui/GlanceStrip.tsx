import { Flame } from "lucide-react";
import { formatINR } from "@/lib/utils";
import { useGlance } from "../lib/journal";

/** Read-only glance: today's net P&L + current journaling streak. */
export function GlanceStrip() {
  const { data } = useGlance();
  if (!data) return null;

  const pnlClass = data.todayPnl > 0 ? "profit" : data.todayPnl < 0 ? "loss" : "";
  return (
    <div className="glance">
      <span className={`glance-chip ${pnlClass}`} title="Today's net P&L">
        {formatINR(data.todayPnl, { signed: data.todayPnl !== 0 })}
      </span>
      <span
        className={`glance-chip streak${data.streak === 0 ? " idle" : ""}`}
        title={`Journaling streak: ${data.streak} day${data.streak === 1 ? "" : "s"}`}
      >
        <Flame size={12} />
        {data.streak}
      </span>
    </div>
  );
}
