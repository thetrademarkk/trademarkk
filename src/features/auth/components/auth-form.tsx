"use client";

import * as React from "react";
import { toast } from "sonner";
import { signIn, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Email/password + optional Google sign-in. On success, the caller connects hosted storage. */
export function AuthForm({ onAuthed }: { onAuthed: () => void }) {
  const [busy, setBusy] = React.useState(false);
  const [needsVerification, setNeedsVerification] = React.useState(false);
  const googleEnabled = process.env.NEXT_PUBLIC_GOOGLE_AUTH === "1";

  const handle = async (mode: "in" | "up", form: FormData) => {
    setBusy(true);
    try {
      const email = String(form.get("email"));
      const password = String(form.get("password"));
      if (mode === "up") {
        const res = await signUp.email({ email, password, name: String(form.get("name")) });
        if (res.error) throw new Error(res.error.message);
        // If email verification is enforced, there is no session yet.
        if (!res.data?.token) {
          setNeedsVerification(true);
          return;
        }
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) throw new Error(res.error.message);
      }
      onAuthed();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Authentication failed");
    } finally {
      setBusy(false);
    }
  };

  if (needsVerification) {
    return (
      <p className="rounded-lg border bg-surface-2 p-4 text-sm">
        📬 Check your inbox — we sent a verification link. After verifying, come back and sign in.
      </p>
    );
  }

  const fields = (mode: "in" | "up") => (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void handle(mode, new FormData(e.currentTarget));
      }}
    >
      {mode === "up" && (
        <div className="space-y-1">
          <Label>Name</Label>
          <Input name="name" required placeholder="Your name" />
        </div>
      )}
      <div className="space-y-1">
        <Label>Email</Label>
        <Input name="email" type="email" required placeholder="you@example.com" />
      </div>
      <div className="space-y-1">
        <Label>Password</Label>
        <Input name="password" type="password" required minLength={8} placeholder="8+ characters" />
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Please wait…" : mode === "up" ? "Create free account" : "Sign in"}
      </Button>
    </form>
  );

  return (
    <div className="space-y-3">
      <Tabs defaultValue="up">
        <TabsList className="w-full grid grid-cols-2">
          <TabsTrigger value="up">Sign up</TabsTrigger>
          <TabsTrigger value="in">Sign in</TabsTrigger>
        </TabsList>
        <TabsContent value="up">{fields("up")}</TabsContent>
        <TabsContent value="in">{fields("in")}</TabsContent>
      </Tabs>
      {googleEnabled && (
        <Button
          variant="outline"
          className="w-full"
          disabled={busy}
          onClick={() => signIn.social({ provider: "google", callbackURL: "/app/onboarding" })}
        >
          Continue with Google
        </Button>
      )}
    </div>
  );
}
