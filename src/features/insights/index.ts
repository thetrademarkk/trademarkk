// Public API of the insights feature — other features import only from here.
export { InsightCard } from "./components/insight-card";
export { computeInsights, ruleBreakInsight, splitRevenge, MIN_SAMPLE } from "./compute";
export type { Insight, InsightFigure, InsightId, InsightSeverity } from "./compute";
export { computeTiltInsights } from "./tilt";
export type { TiltTradeLike } from "./tilt";
export { DisciplineSection } from "./components/discipline-section";
export {
  buildDayInfractions,
  confidenceCalibration,
  disciplineScore,
  disciplineTrend,
  planAdherence,
  planAdherenceSummary,
  MIN_TREND_DAYS,
} from "./discipline";
export type {
  CalibrationBin,
  ConfidenceCalibration,
  DayInfractions,
  DisciplineTrend,
  ExitResolution,
  PlanAdherence,
  PlanAdherenceSummary,
  PlannedTradeLike,
  ScoredDay,
  TrendDirection,
} from "./discipline";
