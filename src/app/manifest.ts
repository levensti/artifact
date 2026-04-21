import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Artifact",
    short_name: "Artifact",
    description: "Your digital workspace for discovering the research frontier.",
    start_url: "/",
    display: "standalone",
    background_color: "#fafafa",
    theme_color: "#1e2b5e",
    icons: [
      {
        src: "/icon.svg",
        type: "image/svg+xml",
        sizes: "any",
        purpose: "any",
      },
      {
        src: "/apple-icon",
        type: "image/png",
        sizes: "180x180",
        purpose: "any",
      },
    ],
  };
}
