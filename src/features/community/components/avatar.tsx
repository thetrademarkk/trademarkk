import { cn } from "@/lib/utils";

/** Custom photo when set; deterministic gradient initials as the fallback. */
export function CommunityAvatar({
  username,
  displayName,
  avatar,
  size = "md",
}: {
  username: string;
  displayName: string;
  avatar?: string | null;
  size?: "sm" | "md" | "lg";
}) {
  const sizeCls =
    size === "sm" ? "h-7 w-7 text-[10px]" : size === "lg" ? "h-14 w-14 text-lg" : "h-9 w-9 text-xs";

  if (avatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={avatar}
        alt={`${displayName}'s avatar`}
        className={cn("shrink-0 select-none rounded-full object-cover", sizeCls)}
      />
    );
  }

  let hash = 0;
  for (let i = 0; i < username.length; i++) hash = (hash * 31 + username.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  const initials = displayName
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold text-white",
        sizeCls
      )}
      style={{
        background: `linear-gradient(135deg, hsl(${hue} 60% 45%), hsl(${(hue + 50) % 360} 65% 35%))`,
      }}
    >
      {initials || "T"}
    </span>
  );
}
