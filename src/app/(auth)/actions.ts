"use server";

import { redirect } from "next/navigation";

import { UserRole } from "@/generated/prisma/enums";
import {
  authenticateAccount,
  DuplicateUsernameError,
  registerAccount,
} from "@/lib/auth/account-service";
import { dashboardPathForRole } from "@/lib/auth/authorization";
import {
  clearSessionCookie,
  getSessionCookieToken,
  setSessionCookie,
} from "@/lib/auth/cookies";
import { invalidateSession } from "@/lib/auth/session-store";
import type { AuthFormState } from "@/lib/auth/types";
import {
  loginSchema,
  normalizeUsername,
  registrationSchema,
} from "@/lib/auth/validation";
import { getClientAddress } from "@/lib/security/request-context";
import { clearRateLimit, consumeRateLimit } from "@/lib/security/rate-limit";

const FIFTEEN_MINUTES = 15 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

function stringValue(formData: FormData, key: string) {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}

export async function registerAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const input = {
    username: stringValue(formData, "username"),
    password: stringValue(formData, "password"),
    passwordConfirmation: stringValue(formData, "passwordConfirmation"),
    role: stringValue(formData, "role"),
  };
  const result = registrationSchema.safeParse(input);
  const selectedRole =
    input.role === UserRole.TEACHER || input.role === UserRole.STUDENT
      ? input.role
      : undefined;

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    return {
      errors,
      values: { username: input.username, role: selectedRole },
    };
  }

  const clientAddress = await getClientAddress();
  const normalizedUsername = normalizeUsername(result.data.username);
  let rateLimits;
  try {
    rateLimits = await Promise.all([
      consumeRateLimit("register-ip", clientAddress, {
        limit: 5,
        windowMs: ONE_HOUR,
      }),
      consumeRateLimit("register-username", normalizedUsername, {
        limit: 3,
        windowMs: ONE_HOUR,
      }),
    ]);
  } catch {
    console.error("Registration rate-limit check failed.");
    return { message: "We could not create your account. Please try again." };
  }
  if (rateLimits.some((limit) => !limit.allowed)) {
    return {
      message: "Too many registration attempts. Try again later.",
      values: { username: input.username, role: selectedRole },
    };
  }

  let account;
  try {
    account = await registerAccount(result.data, await getSessionCookieToken());
  } catch (error) {
    if (error instanceof DuplicateUsernameError) {
      return {
        errors: { username: [error.message] },
        values: { username: input.username, role: selectedRole },
      };
    }

    console.error("Account registration failed.");
    return {
      message: "We could not create your account. Please try again.",
      values: { username: input.username, role: selectedRole },
    };
  }

  await setSessionCookie(account.token, account.expiresAt);
  redirect(dashboardPathForRole(account.user.role));
}

export async function loginAction(
  _previousState: AuthFormState,
  formData: FormData,
): Promise<AuthFormState> {
  const input = {
    username: stringValue(formData, "username"),
    password: stringValue(formData, "password"),
  };
  const result = loginSchema.safeParse(input);

  if (!result.success) {
    return {
      errors: result.error.flatten().fieldErrors,
      values: { username: input.username },
    };
  }

  const clientAddress = await getClientAddress();
  const normalizedUsername = normalizeUsername(result.data.username);
  let rateLimits;
  try {
    rateLimits = await Promise.all([
      consumeRateLimit("login-ip", clientAddress, {
        limit: 50,
        windowMs: FIFTEEN_MINUTES,
      }),
      consumeRateLimit("login-account", normalizedUsername, {
        limit: 15,
        windowMs: FIFTEEN_MINUTES,
      }),
    ]);
  } catch {
    console.error("Sign-in rate-limit check failed.");
    return {
      message: "We could not sign you in. Please try again.",
      values: { username: input.username },
    };
  }
  if (rateLimits.some((limit) => !limit.allowed)) {
    return {
      message: "Too many sign-in attempts. Try again later.",
      values: { username: input.username },
    };
  }

  let account;
  try {
    account = await authenticateAccount(
      result.data,
      await getSessionCookieToken(),
    );
  } catch {
    console.error("Account sign-in failed.");
    return {
      message: "We could not sign you in. Please try again.",
      values: { username: input.username },
    };
  }

  if (!account) {
    return {
      message: "Incorrect username or password.",
      values: { username: input.username },
    };
  }

  await clearRateLimit("login-account", normalizedUsername);

  await setSessionCookie(account.token, account.expiresAt);
  redirect(dashboardPathForRole(account.user.role));
}

export async function signOutAction() {
  const token = await getSessionCookieToken();
  await invalidateSession(token);
  await clearSessionCookie();
  redirect("/login");
}
