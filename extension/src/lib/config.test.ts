import { describe, expect, it } from "vitest";
import { normalizeAppUrl } from "./config";

describe("normalizeAppUrl", () => {
  it("normalizes full https URLs to bare origins", () => {
    expect(normalizeAppUrl("https://trademark-smoky.vercel.app/app/dashboard")).toBe(
      "https://trademark-smoky.vercel.app"
    );
    expect(normalizeAppUrl(" https://my-fork.example.com ")).toBe("https://my-fork.example.com");
  });

  it("defaults missing protocol to https (http for localhost)", () => {
    expect(normalizeAppUrl("my-fork.example.com")).toBe("https://my-fork.example.com");
    expect(normalizeAppUrl("localhost:3400")).toBe("http://localhost:3400");
    expect(normalizeAppUrl("127.0.0.1:3000")).toBe("http://127.0.0.1:3000");
  });

  it("allows http only for loopback hosts", () => {
    expect(normalizeAppUrl("http://localhost:3400")).toBe("http://localhost:3400");
    expect(normalizeAppUrl("http://evil.example.com")).toBeNull();
  });

  it("rejects garbage and other protocols", () => {
    expect(normalizeAppUrl("")).toBeNull();
    expect(normalizeAppUrl("   ")).toBeNull();
    expect(normalizeAppUrl("ftp://files.example.com")).toBeNull();
    expect(normalizeAppUrl("chrome-extension://abc")).toBeNull();
    expect(normalizeAppUrl("not a url at all")).toBeNull();
  });
});
