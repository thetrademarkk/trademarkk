/**
 * Overfitting coach — Probabilistic & Deflated Sharpe Ratio (BT-11).
 *
 * Pure, deterministic, market-data-free. This is an EDUCATIONAL, DESCRIPTIVE
 * caution (D10) — NEVER a score that implies a recommendation. It answers one
 * honest question: "how confident can we be that this observed Sharpe is real,
 * given a short sample and/or many strategy variations tried?"
 *
 * Concept (cited plainly in the UI copy): the Probabilistic Sharpe Ratio (PSR)
 * and Deflated Sharpe Ratio (DSR) of Bailey & López de Prado (2014),
 * "The Deflated Sharpe Ratio: Correcting for Selection Bias, Backtest
 * Overfitting and Non-Normality", Journal of Portfolio Management. PSR is the
 * probability that the true Sharpe exceeds a benchmark (default 0) once you
 * adjust for sample length, skewness and kurtosis. DSR deflates that benchmark
 * upward to account for the NUMBER OF TRIALS (variations tried) — because the
 * best of many random strategies will look good by luck alone.
 *
 * We surface the numbers AND a plain-language caution. We never translate them
 * into "good"/"bad" or "trade this".
 *
 * Inputs are the per-trade-day net-return series (rupees); the Sharpe is the
 * SAME annualized figure BT-04 metrics.ts computes, so the coach and the stat
 * strip agree. All math is closed-form (no sampling), so it's fully reproducible.
 */

const SQRT_2 = Math.SQRT2;
const TRADING_DAYS_PER_YEAR = 252;

export interface DeflatedSharpeInput {
  /** Per-trade-day net returns (rupees). The order does not matter for moments. */
  dailyNets: number[];
  /** Annualized Sharpe already computed by metrics.ts (so figures agree). */
  annualizedSharpe: number;
  /**
   * Number of independent strategy configurations effectively tried (for DSR).
   * 1 = no search bias known. The no-code builder's "change one thing" loop and
   * template count feed this; when unknown we default to 1 and SAY SO.
   */
  trials?: number;
}

export interface DeflatedSharpeResult {
  /** Echo of the annualized Sharpe assessed. */
  annualizedSharpe: number;
  /** PER-PERIOD (per-trade-day) Sharpe — the basis for PSR/DSR math. */
  perPeriodSharpe: number;
  /** Sample size (number of trade-day returns). */
  sampleSize: number;
  /** Skewness of the return series (3rd standardized moment). */
  skew: number;
  /** Kurtosis (4th standardized moment; 3 = normal). */
  kurtosis: number;
  /** Number of trials assumed for the deflation. */
  trials: number;
  /** Whether the trial count was supplied (true) or defaulted to 1 (false). */
  trialsKnown: boolean;
  /**
   * Probabilistic Sharpe Ratio vs a zero benchmark: P(true Sharpe > 0), 0..1.
   * Null when the sample is too small to estimate (n < MIN_SAMPLE).
   */
  psr: number | null;
  /**
   * Deflated Sharpe Ratio: PSR vs a benchmark inflated for `trials`. 0..1. The
   * honest headline number. Null when sample too small.
   */
  dsr: number | null;
  /** The deflated benchmark Sharpe (per-period) the DSR was measured against. */
  deflatedBenchmark: number;
  /** Descriptive severity bucket for the caution copy (never a recommendation). */
  caution: "low" | "moderate" | "elevated" | "insufficient";
  /** Plain-language educational caution string (D10). */
  message: string;
}

/** Minimum trade-days before PSR/DSR is meaningful (closed-form needs n≥~10). */
export const MIN_SAMPLE = 10;

/** Standard normal CDF via Abramowitz-Stegun 7.1.26 erf approximation. */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / SQRT_2));
}

/** Inverse standard normal CDF (Acklam's algorithm) — for the DSR benchmark. */
export function normalInv(p: number): number {
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  // Coefficients (Peter Acklam).
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239,
  ];
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ];
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734,
    4.374664141464968, 2.938163982698783,
  ];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const pLow = 0.02425;
  const pHigh = 1 - pLow;
  let q: number;
  let r: number;
  if (p < pLow) {
    q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
      ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
    );
  }
  if (p <= pHigh) {
    q = p - 0.5;
    r = q * q;
    return (
      ((((((a[0]! * r + a[1]!) * r + a[2]!) * r + a[3]!) * r + a[4]!) * r + a[5]!) * q) /
      (((((b[0]! * r + b[1]!) * r + b[2]!) * r + b[3]!) * r + b[4]!) * r + 1)
    );
  }
  q = Math.sqrt(-2 * Math.log(1 - p));
  return (
    -(((((c[0]! * q + c[1]!) * q + c[2]!) * q + c[3]!) * q + c[4]!) * q + c[5]!) /
    ((((d[0]! * q + d[1]!) * q + d[2]!) * q + d[3]!) * q + 1)
  );
}

/** Abramowitz & Stegun 7.1.26 erf approximation (max err ~1.5e-7). */
function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax);
  return sign * y;
}

/** Euler-Mascheroni constant — used in the expected-max-Sharpe approximation. */
const EULER_GAMMA = 0.5772156649015329;

/**
 * Expected maximum of `trials` independent standard normals — the deflation
 * benchmark factor in DSR (Bailey & López de Prado, eq. for E[max]). For
 * trials=1 this is 0 (no deflation). Closed-form, deterministic.
 */
export function expectedMaxStandardNormal(trials: number): number {
  const n = Math.max(1, Math.floor(trials));
  if (n <= 1) return 0;
  // E[max_N] ≈ (1−γ)·Φ⁻¹(1−1/N) + γ·Φ⁻¹(1−1/(N·e))
  const z1 = normalInv(1 - 1 / n);
  const z2 = normalInv(1 - 1 / (n * Math.E));
  return (1 - EULER_GAMMA) * z1 + EULER_GAMMA * z2;
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}

/** Population standard deviation (n denominator — matches the PSR derivation). */
function stdPop(xs: number[], m: number): number {
  const n = xs.length;
  if (n < 1) return 0;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) * (x - m), 0) / n);
}

/** Standardized skewness (population). */
function skewness(xs: number[], m: number, sd: number): number {
  const n = xs.length;
  if (n < 1 || sd === 0) return 0;
  return xs.reduce((s, x) => s + ((x - m) / sd) ** 3, 0) / n;
}

/** Standardized kurtosis (population, 3 = normal). */
function kurtosis(xs: number[], m: number, sd: number): number {
  const n = xs.length;
  if (n < 1 || sd === 0) return 3;
  return xs.reduce((s, x) => s + ((x - m) / sd) ** 4, 0) / n;
}

/**
 * Compute the PSR / DSR overfitting coach for a return series. Pure &
 * deterministic. When the sample is too small to estimate, psr/dsr are null and
 * the caution is "insufficient" with an honest message.
 */
export function deflatedSharpe(input: DeflatedSharpeInput): DeflatedSharpeResult {
  const xs = input.dailyNets.filter((x) => Number.isFinite(x));
  const n = xs.length;
  const trials = Math.max(1, Math.floor(input.trials ?? 1));
  const trialsKnown = input.trials != null && input.trials >= 1;

  const m = mean(xs);
  const sd = stdPop(xs, m);
  const skew = round4(skewness(xs, m, sd));
  const kurt = round4(kurtosis(xs, m, sd));
  // Per-period Sharpe (de-annualized so PSR's √(n−1) scaling is correct).
  const perPeriodSharpe = sd > 0 ? round4(m / sd) : 0;

  if (n < MIN_SAMPLE || sd === 0) {
    return {
      annualizedSharpe: input.annualizedSharpe,
      perPeriodSharpe,
      sampleSize: n,
      skew,
      kurtosis: kurt,
      trials,
      trialsKnown,
      psr: null,
      dsr: null,
      deflatedBenchmark: 0,
      caution: "insufficient",
      message: `Too few trade-days (${n}) to estimate how much of this Sharpe could be noise — read the Sharpe with caution.`,
    };
  }

  // Deflated benchmark Sharpe (per-period): the Sharpe you'd expect the BEST of
  // `trials` random strategies to hit by luck, scaled by the sampling error of
  // the Sharpe estimator (≈ 1/√(n−1) under normality).
  const sharpeStdErrApprox = 1 / Math.sqrt(n - 1);
  const deflatedBenchmark = round4(expectedMaxStandardNormal(trials) * sharpeStdErrApprox);

  const psr = round4(psrAgainst(perPeriodSharpe, 0, n, skew, kurt));
  const dsr = round4(psrAgainst(perPeriodSharpe, deflatedBenchmark, n, skew, kurt));

  const caution = bucket(dsr, n, trials);
  const message = buildMessage(caution, dsr, n, trials, trialsKnown);

  return {
    annualizedSharpe: input.annualizedSharpe,
    perPeriodSharpe,
    sampleSize: n,
    skew,
    kurtosis: kurt,
    trials,
    trialsKnown,
    psr,
    dsr,
    deflatedBenchmark,
    caution,
    message,
  };
}

/**
 * Probabilistic Sharpe Ratio of an observed per-period Sharpe `sr` exceeding a
 * benchmark `srBench`, over `n` observations, adjusting for skew & kurtosis
 * (Bailey & López de Prado 2012/2014). Returns a probability in [0,1].
 */
export function psrAgainst(
  sr: number,
  srBench: number,
  n: number,
  skew: number,
  kurt: number
): number {
  if (n < 2) return 0;
  // Standard error of the Sharpe estimator under non-normality.
  const denom = Math.sqrt(Math.max(1e-12, 1 - skew * sr + ((kurt - 1) / 4) * sr * sr));
  const z = ((sr - srBench) * Math.sqrt(n - 1)) / denom;
  return normalCdf(z);
}

/** A large explicit search space is itself a selection-bias concern worth
 *  flagging, independent of how high the DSR happened to land. */
const HEAVY_SEARCH_TRIALS = 20;

/** Descriptive severity bucket for the DSR + sample + trials (NOT a verdict). */
function bucket(dsr: number, n: number, trials: number): "low" | "moderate" | "elevated" {
  // Higher DSR = more confidence the Sharpe survives selection/sample noise →
  // LOWER overfitting concern. We bucket the CONCERN, descriptively. A heavy
  // search (many variations tried) or a short sample raises the concern even
  // when the DSR is high — because the user explicitly explored a large space.
  if (trials >= HEAVY_SEARCH_TRIALS || n < 30) return "elevated";
  if (dsr >= 0.95 && n >= 60) return "low";
  if (dsr >= 0.75 && trials <= 5) return "moderate";
  return "elevated";
}

/** Plain-language, educational caution. Cites the concept; never recommends. */
function buildMessage(
  caution: "low" | "moderate" | "elevated",
  dsr: number,
  n: number,
  trials: number,
  trialsKnown: boolean
): string {
  const dsrPct = `${Math.round(dsr * 100)}%`;
  const trialsClause = trialsKnown
    ? `accounting for ${trials} variation${trials === 1 ? "" : "s"} tried`
    : `assuming a single variation was tried (the count of tweaks you actually made would lower this)`;
  const base = `Deflated Sharpe ratio ≈ ${dsrPct} over ${n} trade-days, ${trialsClause}.`;
  switch (caution) {
    case "low":
      return `${base} On this sample the observed Sharpe is unlikely to be a pure artefact of a short sample or selection — but past performance still does not predict the future.`;
    case "moderate":
      return `${base} Part of the observed Sharpe may be inflated by the sample length or the number of tweaks tried — treat it as indicative, not confirmed.`;
    case "elevated":
      return `${base} This Sharpe may be substantially inflated by a short sample and/or multiple strategy tweaks — a high backtest Sharpe can arise from luck or overfitting. Educational caution only.`;
  }
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export { TRADING_DAYS_PER_YEAR };
