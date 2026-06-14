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
      // PNG raster icons drive installability on iOS (which ignores SVG manifest
      // icons) and satisfy the Lighthouse 192/512 requirement.
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
      // SVGs kept as scalable "any" fallbacks for engines that prefer vector.
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-maskable.svg", sizes: "any", type: "image/svg+xml", purpose: "maskable" },
    ],
    shortcuts: [
      { name: "Add trade", url: "/app/trades", description: "Log a trade" },
      { name: "Today's journal", url: "/app/journal", description: "Open today's journal" },
    ],
  };
}
