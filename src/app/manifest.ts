import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Macao",
    short_name: "Macao",
    description: "Macao multiplayer între prieteni, 2-6 jucători, cu regulile casei alese de host.",
    id: "/macao/",
    start_url: "/macao/",
    // "/" on purpose: leaving the game for the hub (same origin) stays inside the installed app.
    scope: "/",
    display: "standalone",
    lang: "ro",
    background_color: "#09090b",
    theme_color: "#09090b",
    icons: [
      { src: "/macao/icons/192", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/macao/icons/512", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/macao/icons/512", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
