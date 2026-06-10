"use client";

import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { usePlaybooks, useTags } from "../queries";
import type { TradeFilters } from "../types";

const ALL = "__all__";

export function TradeFiltersBar({
  filters,
  onChange,
}: {
  filters: TradeFilters;
  onChange: (f: TradeFilters) => void;
}) {
  const { data: playbooks = [] } = usePlaybooks();
  const { data: tags = [] } = useTags();
  const set = (patch: Partial<TradeFilters>) => onChange({ ...filters, ...patch });
  const sel = (v: string) => (v === ALL ? undefined : v);
  const hasFilters = Boolean(
    filters.search || filters.segment || filters.result || filters.direction || filters.playbookId || filters.tagId
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted" />
        <Input
          placeholder="Symbol…"
          className="pl-8 w-[140px] md:w-[180px]"
          value={filters.search ?? ""}
          onChange={(e) => set({ search: e.target.value || undefined })}
        />
      </div>
      <Select value={filters.segment ?? ALL} onValueChange={(v) => set({ segment: sel(v) as TradeFilters["segment"] })}>
        <SelectTrigger className="w-[110px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All segments</SelectItem>
          <SelectItem value="OPT">Options</SelectItem>
          <SelectItem value="FUT">Futures</SelectItem>
          <SelectItem value="EQ">Equity</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.result ?? ALL} onValueChange={(v) => set({ result: sel(v) as TradeFilters["result"] })}>
        <SelectTrigger className="w-[100px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Win & loss</SelectItem>
          <SelectItem value="win">Wins</SelectItem>
          <SelectItem value="loss">Losses</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.direction ?? ALL} onValueChange={(v) => set({ direction: sel(v) as TradeFilters["direction"] })}>
        <SelectTrigger className="w-[100px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>Long & short</SelectItem>
          <SelectItem value="long">Long</SelectItem>
          <SelectItem value="short">Short</SelectItem>
        </SelectContent>
      </Select>
      <Select value={filters.playbookId ?? ALL} onValueChange={(v) => set({ playbookId: sel(v) })}>
        <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All setups</SelectItem>
          {playbooks.map((p) => (
            <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Select value={filters.tagId ?? ALL} onValueChange={(v) => set({ tagId: sel(v) })}>
        <SelectTrigger className="w-[130px] h-9 text-xs"><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={ALL}>All tags</SelectItem>
          {tags.map((t) => (
            <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
          ))}
        </SelectContent>
      </Select>
      {hasFilters && (
        <Button variant="ghost" size="sm" onClick={() => onChange({ from: filters.from, to: filters.to })}>
          <X className="h-3.5 w-3.5" /> Clear
        </Button>
      )}
    </div>
  );
}
