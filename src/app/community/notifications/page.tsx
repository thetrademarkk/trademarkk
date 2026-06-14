import type { Metadata } from "next";
import { NotificationsPageClient } from "./notifications-view";

// A sign-in-gated personal surface — never index it (and don't let it inherit
// the /community feed canonical). The client view below renders unchanged.
export const metadata: Metadata = {
  title: "Notifications",
  robots: { index: false },
};

export default function NotificationsPage() {
  return <NotificationsPageClient />;
}
