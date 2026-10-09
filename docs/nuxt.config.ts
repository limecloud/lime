const siteUrl = process.env.NUXT_SITE_URL || "https://limecloud.github.io/lime";

export default {
  extends: ["docus"],
  site: {
    url: siteUrl,
  },
  app: {
    baseURL: "/lime/",
  },
  image: {
    provider: "none",
  },
  robots: {
    robotsTxt: false,
  },
  nitro: {
    prerender: {
      failOnError: true,
    },
  },
  llms: {
    domain: siteUrl,
  },
};
