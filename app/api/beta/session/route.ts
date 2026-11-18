import { NextResponse } from "next/server";
import {
  aiAccessMode,
  BETA_SESSION_COOKIE,
  BetaConfigurationError,
  betaSessionCookieOptions,
  cookieValue,
  createBetaSession,
  hashInvitationToken,
  sameOrigin,
  testerForInvitationToken,
  verifyBetaSession,
} from "@/lib/beta-access";
import { allowLoginAttempt, DurableStoreUnavailableError, redeemInvitation, TESTER_DAILY_ANALYSIS_LIMIT } from "@/lib/beta-rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function json(body: unknown, status = 200, headers?: HeadersInit) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store", ...headers },
  });
}

function betaEnabled() {
  return aiAccessMode() === "beta";
}

function clientIdentifier(request: Request) {
  return request.headers.get("x-vercel-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    || request.headers.get("x-real-ip")
    || "local";
}

function sessionFromRequest(request: Request) {
  const token = cookieValue(request.headers.get("cookie"), BETA_SESSION_COOKIE);
  return verifyBetaSession(token);
}

export async function GET(request: Request) {
  if (!betaEnabled()) return json({ enabled: false, authenticated: false });

  try {
    const session = sessionFromRequest(request);
    return json({
      enabled: true,
      authenticated: Boolean(session),
      testerId: session?.testerId ?? null,
      analysesPerDay: TESTER_DAILY_ANALYSIS_LIMIT,
      expiresAt: session ? new Date(session.expiresAt).toISOString() : null,
    });
  } catch (error) {
    console.error("[beta-session] configuration error", error instanceof Error ? error.message : "Unknown error");
    return json({ enabled: true, authenticated: false, error: "Beta access is not configured." }, 503);
  }
}

export async function POST(request: Request) {
  if (!betaEnabled()) return json({ error: { code: "BETA_DISABLED", message: "Private beta access is unavailable." } }, 404);
  if (!sameOrigin(request)) return json({ error: { code: "INVALID_ORIGIN", message: "This request is not allowed." } }, 403);

  try {
    const attempt = await allowLoginAttempt(clientIdentifier(request));
    if (!attempt.allowed) {
      return json(
        { error: { code: "LOGIN_RATE_LIMITED", message: "Too many invitation attempts. Try again in 15 minutes." } },
        429,
        { "Retry-After": String(attempt.retryAfter) },
      );
    }

    const body = await request.json() as { token?: unknown };
    const invitationToken = typeof body.token === "string" ? body.token.trim() : "";
    if (invitationToken.length < 32 || invitationToken.length > 256) {
      return json({ error: { code: "INVALID_INVITATION", message: "That invitation link is not valid." } }, 401);
    }

    const testerId = testerForInvitationToken(invitationToken);
    if (!testerId) {
      return json({ error: { code: "INVALID_INVITATION", message: "That invitation link is not valid." } }, 401);
    }

    const sessionToken = createBetaSession(testerId);
    const redeemed = await redeemInvitation(testerId, hashInvitationToken(invitationToken));
    const currentSession = sessionFromRequest(request);
    if (!redeemed && currentSession?.testerId !== testerId) {
      return json({ error: { code: "INVITATION_REDEEMED", message: "That invitation link has already been used. Ask for a new invitation." } }, 410);
    }

    const response = json({
      enabled: true,
      authenticated: true,
      testerId,
      analysesPerDay: TESTER_DAILY_ANALYSIS_LIMIT,
    });
    response.cookies.set({
      name: BETA_SESSION_COOKIE,
      value: sessionToken,
      ...betaSessionCookieOptions(),
    });
    return response;
  } catch (error) {
    if (error instanceof DurableStoreUnavailableError || error instanceof BetaConfigurationError) {
      console.error("[beta-session] unavailable", error.message);
      return json({ error: { code: "BETA_UNAVAILABLE", message: "Private beta access is temporarily unavailable." } }, 503);
    }
    return json({ error: { code: "INVALID_REQUEST", message: "Open a valid beta invitation link." } }, 400);
  }
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return json({ error: { code: "INVALID_ORIGIN", message: "This request is not allowed." } }, 403);
  const response = json({ authenticated: false });
  response.cookies.set({
    name: BETA_SESSION_COOKIE,
    value: "",
    ...betaSessionCookieOptions(),
    maxAge: 0,
  });
  return response;
}
