/** Public barrel for the backtest engine (BT-04). */
export * from "./types";
export * from "./data-source";
export * from "./fill-model";
export * from "./resolve-strike";
export { runBacktest, minuteOfDayIST } from "./engine";
export type { RunBacktestOptions } from "./engine";
export { FixtureDataSource, makeFixtureSource } from "./adapters/fixture-source";
export type { FixtureSnapshot, FixtureDay, FixtureContract } from "./adapters/fixture-source";
