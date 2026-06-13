import { describe, expect, it } from "vitest";
import {
  SCREENSHOT_QUALITIES,
  buildScreenshotAttachment,
  dataUrlByteLength,
  dataUrlToBlob,
  encodeUnderCap,
  fitWithin,
} from "./screenshot";

/** A base64 data URL whose decoded payload is exactly `bytes` long. */
function dataUrlOfBytes(bytes: number, mime = "image/jpeg"): string {
  const b64 = Buffer.from(new Uint8Array(bytes)).toString("base64");
  return `data:${mime};base64,${b64}`;
}

describe("dataUrlByteLength", () => {
  it("returns the decoded payload size, not the base64 length", () => {
    for (const n of [0, 1, 2, 3, 100, 199 * 1024, 200 * 1024]) {
      expect(dataUrlByteLength(dataUrlOfBytes(n))).toBe(n);
    }
  });

  it("is 0 for a non-data string or an empty payload", () => {
    expect(dataUrlByteLength("not a data url")).toBe(0);
    expect(dataUrlByteLength("data:image/png;base64,")).toBe(0);
  });
});

describe("fitWithin", () => {
  it("shrinks the longest edge to the cap, preserving aspect ratio", () => {
    expect(fitWithin(3200, 1600, 1600)).toEqual({ width: 1600, height: 800 });
    expect(fitWithin(1600, 3200, 1600)).toEqual({ width: 800, height: 1600 });
  });

  it("never upscales a small capture", () => {
    expect(fitWithin(640, 480, 1600)).toEqual({ width: 640, height: 480 });
  });

  it("clamps to at least 1px", () => {
    const r = fitWithin(1, 1, 1600);
    expect(r.width).toBeGreaterThanOrEqual(1);
    expect(r.height).toBeGreaterThanOrEqual(1);
  });
});

describe("encodeUnderCap (size cap)", () => {
  it("returns the first quality whose encode fits the 200 KB cap", () => {
    const target = 200 * 1024;
    // Simulate sizes that shrink with quality; the third step is the first fit.
    const sizeFor = (q: number): number => {
      if (q >= 0.82) return 500 * 1024;
      if (q >= 0.7) return 300 * 1024;
      if (q >= 0.58) return 180 * 1024;
      if (q >= 0.45) return 120 * 1024;
      return 80 * 1024;
    };
    const calls: number[] = [];
    const out = encodeUnderCap({
      encode: (q) => {
        calls.push(q);
        return dataUrlOfBytes(sizeFor(q));
      },
      qualities: SCREENSHOT_QUALITIES,
      targetBytes: target,
    });
    expect(dataUrlByteLength(out)).toBe(180 * 1024);
    expect(dataUrlByteLength(out)).toBeLessThanOrEqual(target);
    // Stops as soon as it fits — does not keep stepping down.
    expect(calls).toEqual([0.82, 0.7, 0.58]);
  });

  it("falls back to the lowest quality when nothing fits", () => {
    const target = 200 * 1024;
    const calls: number[] = [];
    const out = encodeUnderCap({
      encode: (q) => {
        calls.push(q);
        return dataUrlOfBytes(400 * 1024); // never fits
      },
      qualities: SCREENSHOT_QUALITIES,
      targetBytes: target,
    });
    expect(dataUrlByteLength(out)).toBe(400 * 1024); // best effort
    expect(calls).toEqual([...SCREENSHOT_QUALITIES]); // tried every step
  });

  it("accepts the very first quality when it already fits", () => {
    const calls: number[] = [];
    encodeUnderCap({
      encode: (q) => {
        calls.push(q);
        return dataUrlOfBytes(50 * 1024);
      },
      qualities: SCREENSHOT_QUALITIES,
      targetBytes: 200 * 1024,
    });
    expect(calls).toEqual([0.82]);
  });
});

describe("dataUrlToBlob", () => {
  it("round-trips a base64 payload to a Blob of the right size + type", async () => {
    const blob = dataUrlToBlob(dataUrlOfBytes(1234, "image/jpeg"));
    expect(blob.type).toBe("image/jpeg");
    expect(blob.size).toBe(1234);
  });

  it("decodes known bytes exactly", async () => {
    // "data:text/plain;base64," + base64("Hi") === "SGk="
    const blob = dataUrlToBlob("data:text/plain;base64,SGk=");
    expect(await blob.text()).toBe("Hi");
    expect(blob.type).toBe("text/plain");
  });

  it("throws on a non-data string", () => {
    expect(() => dataUrlToBlob("nope")).toThrow();
  });
});

describe("buildScreenshotAttachment", () => {
  it("links the screenshot to the trade and passes the data through", () => {
    const att = buildScreenshotAttachment({ tradeId: "t1", data: "data:image/jpeg;base64,AAA=" });
    expect(att).toEqual({ tradeId: "t1", data: "data:image/jpeg;base64,AAA=", caption: undefined });
    // Trade screenshots are NEVER keyed to a journal_date — that's the web app's
    // contract for trade-linked attachments.
    expect("journalDate" in att).toBe(false);
  });

  it("trims a caption and drops an empty one", () => {
    expect(
      buildScreenshotAttachment({ tradeId: "t", data: "d", caption: "  Chart  " }).caption
    ).toBe("Chart");
    expect(buildScreenshotAttachment({ tradeId: "t", data: "d", caption: "   " }).caption).toBe(
      undefined
    );
  });
});
