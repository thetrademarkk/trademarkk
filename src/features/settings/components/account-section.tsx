"use client";

import { toast } from "sonner";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useDb } from "@/providers/db-session-provider";
import { BROKERS } from "@/config/brokers";
import { useAccounts } from "@/features/trades";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function AccountSection() {
  const { db } = useDb();
  const qc = useQueryClient();
  const { data: accounts = [] } = useAccounts();
  const account = accounts[0];

  const save = useMutation({
    mutationFn: async (input: { name: string; broker: string; capital: number }) => {
      if (!account) throw new Error("No account");
      await db.execute(
        `UPDATE accounts SET name = ?, broker = ?, charge_profile = ?, starting_capital = ?, updated_at = ? WHERE id = ?`,
        [input.name, input.broker, input.broker, input.capital, new Date().toISOString(), account.id]
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries();
      toast.success("Account updated");
    },
  });

  if (!account) return null;

  return (
    <Card>
      <CardHeader><CardTitle>Account & charges</CardTitle></CardHeader>
      <CardContent>
        <form
          className="grid gap-3 md:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate({
              name: String(f.get("name")),
              broker: String(f.get("broker") ?? account.broker),
              capital: Number(f.get("capital")),
            });
          }}
        >
          <div className="space-y-1">
            <Label>Account name</Label>
            <Input name="name" defaultValue={account.name} />
          </div>
          <div className="space-y-1">
            <Label>Broker (charges profile)</Label>
            <Select name="broker" defaultValue={account.broker}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {BROKERS.map((b) => (
                  <SelectItem key={b.id} value={b.id}>{b.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label>Starting capital ₹</Label>
            <Input name="capital" type="number" defaultValue={account.starting_capital} />
          </div>
          <Button type="submit" className="md:col-span-3 md:w-fit" disabled={save.isPending}>
            Save changes
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
