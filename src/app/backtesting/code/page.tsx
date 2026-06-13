import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Code2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Bring your own code",
  description: "Write a Python options strategy and run it in your browser against the same data.",
  robots: { index: false, follow: true },
  alternates: { canonical: "/backtesting/code" },
};

/**
 * Bring-your-own-code placeholder. The in-browser Python harness (Pyodide +
 * duckdb-wasm) is a later milestone; this keeps the landing's second CTA honest.
 */
export default function BacktestingCodePage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/15">
        <Code2 className="h-6 w-6 text-accent" aria-hidden />
      </span>
      <h1 className="mt-4 text-2xl font-bold">Bring-your-own-code is on the way</h1>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-muted">
        Soon you&apos;ll write a Python strategy and run it entirely in your browser — zero server
        trust, zero cost. For now, the no-code builder is the fastest way in.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Button asChild>
          <Link href="/backtesting/build">Try the no-code builder</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/backtesting">
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Back
          </Link>
        </Button>
      </div>
    </div>
  );
}
