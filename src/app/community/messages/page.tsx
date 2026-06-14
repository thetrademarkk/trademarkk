import type { Metadata } from "next";
import { MessagesPageClient } from "./messages-view";

// A sign-in-gated personal DM surface — never index it (and don't let it inherit
// the /community feed canonical). The client view below renders unchanged.
export const metadata: Metadata = {
  title: "Messages",
  robots: { index: false },
};

export default function MessagesPage() {
  return <MessagesPageClient />;
}
