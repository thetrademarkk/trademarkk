import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "TradeMarkk — Trading Journal",
    short_name: "TradeMarkk",
    description:
      "Mark your trade, every day. Free open-source trading journal for Indian FnO traders.",
    start_url: "/app/dashboard",
    display: "standalone",
    background_color: "#0A0A0B",
    theme_color: "#0A0A0B",
    orientation: "portrait-primary",
    categories: ["finance", "productivity"],
    icons: [
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add trade", url: "/app/trades", description: "Log a trade" },
      { name: "Today's journal", url: "/app/journal", description: "Open today's journal" },
    ],
  };
}
