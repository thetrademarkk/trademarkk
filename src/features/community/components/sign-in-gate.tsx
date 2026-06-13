"use client";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { AuthForm } from "@/features/auth";

/**
 * Sign-in dialog raised when a logged-out reader tries to interact.
 * Community identity is a free TradeMarkk account — the journal stays wherever it is.
 */
export function SignInGate({
  open,
  onOpenChange,
  onAuthed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAuthed?: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Join the conversation</DialogTitle>
          <DialogDescription>
            Community uses a free TradeMarkk account. Your journal data stays wherever you keep it —
            this account is only your public identity here.
          </DialogDescription>
        </DialogHeader>
        <AuthForm
          onAuthed={() => {
            onOpenChange(false);
            onAuthed?.();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}
