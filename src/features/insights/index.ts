// Public API of the insights feature — other features import only from here.
export { InsightCard } from "./components/insight-card";
export { computeInsights, ruleBreakInsight, MIN_SAMPLE } from "./compute";
export type { Insight, InsightFigure, InsightId, InsightSeverity } from "./compute";
