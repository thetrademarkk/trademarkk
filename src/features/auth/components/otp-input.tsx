"use client";

import * as React from "react";

const LENGTH = 6;

/**
 * Accessible 6-digit one-time-code entry. Six single-char boxes that behave like
 * a native OTP field: typing advances, Backspace retreats, arrows move, and a
 * pasted code fills every box at once (`autocomplete="one-time-code"` lets
 * mobile OS keyboards offer the SMS/email code). `onComplete` fires when all six
 * digits are present so the parent can auto-submit.
 */
export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled,
  autoFocus,
}: {
  value: string;
  onChange: (next: string) => void;
  onComplete?: (code: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const refs = React.useRef<(HTMLInputElement | null)[]>([]);
  const digits = React.useMemo(
    () => Array.from({ length: LENGTH }, (_, i) => value[i] ?? ""),
    [value]
  );

  const set = (next: string) => {
    const clean = next.replace(/\D/g, "").slice(0, LENGTH);
    onChange(clean);
    if (clean.length === LENGTH) onComplete?.(clean);
  };

  const handleChange = (i: number, raw: string) => {
    const d = raw.replace(/\D/g, "");
    if (!d) return;
    // Typing/pasting into one box: splice this digit (or a multi-char paste) in.
    const chars = value.split("");
    if (d.length > 1) {
      set((value.slice(0, i) + d).slice(0, LENGTH));
      refs.current[Math.min(i + d.length, LENGTH - 1)]?.focus();
      return;
    }
    chars[i] = d;
    set(chars.join(""));
    refs.current[Math.min(i + 1, LENGTH - 1)]?.focus();
  };

  const handleKeyDown = (i: number, e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Backspace") {
      e.preventDefault();
      const chars = value.split("");
      if (chars[i]) {
        chars[i] = "";
        set(chars.join(""));
      } else if (i > 0) {
        refs.current[i - 1]?.focus();
        const prev = value.split("");
        prev[i - 1] = "";
        set(prev.join(""));
      }
    } else if (e.key === "ArrowLeft" && i > 0) {
      refs.current[i - 1]?.focus();
    } else if (e.key === "ArrowRight" && i < LENGTH - 1) {
      refs.current[i + 1]?.focus();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    set(e.clipboardData.getData("text"));
    refs.current[LENGTH - 1]?.focus();
  };

  return (
    <div
      className="flex justify-between gap-2"
      role="group"
      aria-label="Enter the 6-digit verification code"
    >
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => {
            refs.current[i] = el;
          }}
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={d}
          disabled={disabled}
          autoFocus={autoFocus && i === 0}
          aria-label={`Digit ${i + 1}`}
          onChange={(e) => handleChange(i, e.target.value)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onPaste={handlePaste}
          onFocus={(e) => e.target.select()}
          className="h-12 w-full rounded-lg border bg-surface text-center text-lg font-semibold tabular-nums outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/30 disabled:opacity-60"
        />
      ))}
    </div>
  );
}
