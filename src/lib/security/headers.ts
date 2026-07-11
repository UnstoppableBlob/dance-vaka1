export function createContentSecurityPolicy(
  nodeEnvironment = process.env.NODE_ENV,
) {
  const scriptSources = [
    "'self'",
    "'unsafe-inline'",
    "'wasm-unsafe-eval'",
    "https://cdn.jsdelivr.net",
  ];
  if (nodeEnvironment === "development") scriptSources.push("'unsafe-eval'");

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "media-src 'self' blob: data: http://localhost:9000 https:",
    "connect-src 'self' blob: http://localhost:9000 https:",
    "worker-src 'self' blob:",
  ].join("; ");
}

export const contentSecurityPolicy = createContentSecurityPolicy();

export const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(self), microphone=(self), geolocation=()",
  },
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
] as const;
