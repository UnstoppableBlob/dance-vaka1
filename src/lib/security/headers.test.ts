import { describe, expect, it } from "vitest";

import nextConfig from "../../../next.config";
import {
  contentSecurityPolicy,
  createContentSecurityPolicy,
  securityHeaders,
} from "@/lib/security/headers";

describe("application security headers and request limits", () => {
  it("denies framing, MIME sniffing, foreign forms, and unnecessary permissions", () => {
    const headers = new Map(
      securityHeaders.map((header) => [header.key, header.value]),
    );
    expect(headers.get("X-Frame-Options")).toBe("DENY");
    expect(headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(headers.get("Permissions-Policy")).toContain("geolocation=()");
    expect(contentSecurityPolicy).toContain("frame-ancestors 'none'");
    expect(contentSecurityPolicy).toContain("form-action 'self'");
    expect(contentSecurityPolicy).toContain("object-src 'none'");
    expect(contentSecurityPolicy).toContain("https://cdn.jsdelivr.net");
  });

  it("allows Next.js development diagnostics without weakening production", () => {
    expect(createContentSecurityPolicy("development")).toContain(
      "'unsafe-eval'",
    );
    expect(createContentSecurityPolicy("production")).not.toContain(
      "'unsafe-eval'",
    );
  });

  it("caps server-action bodies", () => {
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe("1mb");
  });
});
