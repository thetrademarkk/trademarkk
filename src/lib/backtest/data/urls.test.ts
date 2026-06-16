/**
 * urls.ts unit tests — both resolved forms are asserted against the literal
 * paths declared in docs/backtesting/07-data-layer.md §1, so a drift in either
 * the HTTPS `resolve/main` form or the `hf://` form fails the build.
 */

import { describe, expect, it } from "vitest";
import {
  DATASET_REPO,
  DATASET_VERSION,
  HF_BASE,
  HTTPS_BASE,
  indexPath,
  indexUrl,
  optionPath,
  optionUrl,
} from "./urls";

describe("urls — constants", () => {
  it("dataset repo + version are the frozen contract values", () => {
    expect(DATASET_REPO).toBe("thetrademarkk/india-index-options-1m");
    expect(DATASET_VERSION).toBe(1);
  });

  it("bases match the two forms in §1", () => {
    expect(HTTPS_BASE).toBe(
      "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main"
    );
    expect(HF_BASE).toBe("hf://datasets/thetrademarkk/india-index-options-1m");
  });
});

describe("urls — repo-relative paths", () => {
  it("index path is index/{SYMBOL}.parquet", () => {
    expect(indexPath("NIFTY")).toBe("index/NIFTY.parquet");
    expect(indexPath("SENSEX")).toBe("index/SENSEX.parquet");
  });

  it("option path is options/{SYMBOL}/{EXPIRY}.parquet", () => {
    expect(optionPath("NIFTY", "2026-06-19")).toBe("options/NIFTY/2026-06-19.parquet");
    expect(optionPath("BANKNIFTY", "2026-01-29")).toBe("options/BANKNIFTY/2026-01-29.parquet");
  });
});

describe("urls — browser DIRECT (HTTPS resolve/main) form", () => {
  it("index URL matches §4a verbatim", () => {
    expect(indexUrl("NIFTY")).toBe(
      "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/index/NIFTY.parquet"
    );
  });

  it("option URL matches the §1 worked example verbatim", () => {
    // §1: …/resolve/main/options/NIFTY/2026-06-19.parquet
    expect(optionUrl("NIFTY", "2026-06-19")).toBe(
      "https://huggingface.co/datasets/thetrademarkk/india-index-options-1m/resolve/main/options/NIFTY/2026-06-19.parquet"
    );
  });

  it("https is the default form when none is passed", () => {
    expect(indexUrl("NIFTY")).toBe(indexUrl("NIFTY", "https"));
    expect(optionUrl("NIFTY", "2026-06-19")).toBe(optionUrl("NIFTY", "2026-06-19", "https"));
  });
});

describe("urls — server NATIVE (hf://) form", () => {
  it("index URL matches the hf:// form", () => {
    expect(indexUrl("NIFTY", "hf")).toBe(
      "hf://datasets/thetrademarkk/india-index-options-1m/index/NIFTY.parquet"
    );
  });

  it("option URL matches the §1 hf:// worked example verbatim", () => {
    // §1: hf://datasets/…/options/NIFTY/2026-06-19.parquet
    expect(optionUrl("NIFTY", "2026-06-19", "hf")).toBe(
      "hf://datasets/thetrademarkk/india-index-options-1m/options/NIFTY/2026-06-19.parquet"
    );
  });
});
