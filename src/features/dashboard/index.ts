export { KpiRow } from "./components/kpi-row";
// EquityChart is intentionally NOT re-exported here: it pulls recharts, and the
// dashboard lazy-loads it via next/dynamic to keep the route bundle lean.
export { RecentTrades } from "./components/recent-trades";
export { Greeting } from "./components/greeting";
