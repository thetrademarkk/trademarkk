"use client";

import { useSession } from "@/lib/auth-client";

/** Time-of-day greeting; uses the account's first name when signed in. */
export function Greeting() {
  const { data: session } = useSession();
  const hour = new Date().getHours();
  const word = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
  const firstName = session?.user.name?.trim().split(/\s+/)[0];

  return (
    <div>
      <h2 className="text-xl font-bold leading-tight">
        {word}
        {firstName ? `, ${firstName}` : ""}
      </h2>
      <p className="text-xs text-muted">
        {new Date().toLocaleDateString("en-IN", {
          weekday: "long",
          day: "numeric",
          month: "long",
        })}
        {" · "}
        {hour < 9
          ? "Plan before the bell."
          : hour < 16
            ? "Stick to the plan."
            : "Review beats regret."}
      </p>
    </div>
  );
}
