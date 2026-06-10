export function TagChip({ name, color }: { name: string; color: string }) {
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium leading-4 whitespace-nowrap"
      style={{ backgroundColor: `${color}1f`, color }}
    >
      {name}
    </span>
  );
}
