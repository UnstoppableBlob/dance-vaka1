import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { sessionCookieName } from "@/lib/auth/session-token";
import { proxy } from "@/proxy";

describe("protected-route proxy", () => {
  it("redirects a request without a session cookie", () => {
    const response = proxy(new NextRequest("http://localhost/teacher"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/login");
  });

  it("lets a cookie-bearing request reach the secure database guard", () => {
    const request = new NextRequest("http://localhost/student", {
      headers: { cookie: `${sessionCookieName}=opaque-token` },
    });
    const response = proxy(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
