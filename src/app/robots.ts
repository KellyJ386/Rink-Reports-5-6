import type { MetadataRoute } from "next"

// Rink Reports is a staff-only operations console. Even though every
// non-public route is auth-gated, we don't want crawlers indexing the
// login page or attempting to enumerate routes.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      disallow: "/",
    },
  }
}
