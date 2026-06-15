"use client";

import * as React from "react";
import { useForm, useFieldArray, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import {
  isDerivativeSegment,
  productsForSegment,
  tradeFormSchema,
  type TradeFormValues,
} from "../../schemas";
import { useAccounts, usePlaybooks, useSaveTrade } from "../../queries";
import { deriveTradeNumbers, localInputToIso, nowLocalInput } from "../../utils";
import { formatHoldTime } from "@/lib/utils";
import type { TemplatePatch } from "@/features/workflow";

/**
 * Shared engine for the Add-trade modal LAB variants. This is the real
 * react-hook-form setup lifted out of trade-form.tsx (so every variant truly
 * works — types, validation, segment reactivity, legs, live preview) plus the
 * extras the redesign needs: open-trade `exposure`, an `isClosed` flag and a
 * `completeness` map for the footer chips. Draft/dirty wiring is intentionally
 * omitted — the lab is for comparing layouts, not persisting drafts.
 */
export function useTradeCore(opts?: { defaults?: Partial<TradeFormValues>; onSaved?: () => void }) {
  const { data: accounts = [] } = useAccounts();
  const { data: playbooks = [] } = usePlaybooks();
  const saveTrade = useSaveTrade();

  const form = useForm<TradeFormValues>({
    resolver: zodResolver(tradeFormSchema) as Resolver<TradeFormValues>,
    defaultValues: {
      accountId: accounts[0]?.id ?? "",
      symbol: "",
      segment: "EQ",
      product: "MIS",
      direction: "long",
      openedAt: nowLocalInput(),
      tagIds: [],
      ...opts?.defaults,
    },
  });
  const { watch, control, setValue, formState, handleSubmit } = form;
  const extraLegs = useFieldArray({ control, name: "extraLegs" });
  const [activeLeg, setActiveLeg] = React.useState(0);
  const legCount = 1 + extraLegs.fields.length;

  React.useEffect(() => {
    if (!watch("accountId") && accounts[0]) setValue("accountId", accounts[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accounts]);

  const segment = watch("segment");
  React.useEffect(() => {
    const allowed = productsForSegment(segment);
    const current = form.getValues("product");
    if (!current || !allowed.includes(current)) setValue("product", allowed[0]);
    if (segment !== "OPT") {
      setValue("strike", undefined);
      setValue("optionType", undefined);
    }
    if (!isDerivativeSegment(segment)) setValue("expiry", undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment]);

  const addLeg = () => {
    extraLegs.append({
      direction: "long",
      qty: "" as unknown as number,
      avgEntry: "" as unknown as number,
      avgExit: undefined,
      strike: undefined,
      optionType: undefined,
    });
    setActiveLeg(legCount);
  };
  const removeLeg = (i: number) => {
    extraLegs.remove(i - 1);
    setActiveLeg(Math.max(0, i - 1));
  };
  const legHasError = (i: number): boolean => {
    if (i === 0)
      return Boolean(formState.errors.strike || formState.errors.qty || formState.errors.avgEntry);
    return Boolean(formState.errors.extraLegs?.[i - 1]);
  };

  const values = watch();
  const account = accounts.find((a) => a.id === values.accountId);

  const preview = React.useMemo(() => {
    try {
      const parsed = tradeFormSchema.safeParse(values);
      if (!parsed.success || parsed.data.avgExit == null) return null;
      return deriveTradeNumbers(parsed.data, account?.charge_profile ?? "zerodha");
    } catch {
      return null;
    }
  }, [values, account]);

  // Open-trade notional exposure = Σ(qty × entry) across all legs. Shown when the
  // trade has no exit yet, so the footer is never empty for an open position.
  const exposure = React.useMemo(() => {
    const legs = [
      { qty: values.qty, entry: values.avgEntry },
      ...(values.extraLegs ?? []).map((l) => ({ qty: l.qty, entry: l.avgEntry })),
    ];
    let sum = 0;
    let any = false;
    for (const l of legs) {
      const q = Number(l.qty);
      const e = Number(l.entry);
      if (Number.isFinite(q) && Number.isFinite(e) && q > 0 && e > 0) {
        sum += q * e;
        any = true;
      }
    }
    return any ? sum : null;
  }, [values]);

  const isClosed = values.avgExit != null && String(values.avgExit).trim() !== "";

  const holdLabel = React.useMemo(() => {
    if (!values.openedAt) return null;
    try {
      const openedIso = localInputToIso(values.openedAt);
      const closedIso = values.closedAt ? localInputToIso(values.closedAt) : null;
      return formatHoldTime(openedIso, closedIso);
    } catch {
      return null;
    }
  }, [values.openedAt, values.closedAt]);

  const completeness = {
    plan: Boolean(values.plannedSl || values.plannedTarget),
    setup: Boolean(values.confidence || values.playbookId),
    tags: (values.tagIds?.length ?? 0) > 0,
    notes: Boolean(values.notes?.trim()),
  };

  const onSubmit = handleSubmit(async (data) => {
    try {
      await saveTrade.mutateAsync({ values: data });
      toast.success("Trade saved");
      opts?.onSaved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save trade");
    }
  });

  const applyTemplate = React.useCallback(
    (patch: TemplatePatch) => {
      setValue("notes", patch.notes, { shouldDirty: true });
      if (patch.playbookId !== undefined)
        setValue("playbookId", patch.playbookId, { shouldDirty: true });
      if (patch.confidence !== undefined)
        setValue("confidence", patch.confidence, { shouldDirty: true });
    },
    [setValue]
  );

  return {
    form,
    values,
    segment,
    playbooks,
    saving: saveTrade.isPending,
    activeLeg,
    setActiveLeg,
    legCount,
    addLeg,
    removeLeg,
    legHasError,
    preview,
    exposure,
    isClosed,
    holdLabel,
    completeness,
    onSubmit,
    applyTemplate,
  };
}

export type TradeCore = ReturnType<typeof useTradeCore>;
