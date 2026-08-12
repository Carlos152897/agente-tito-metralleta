import { NextRequest, NextResponse } from "next/server";

/** Valida la contraseña compartida (WEB_PASSWORD) y, si coincide, deja la
 *  cookie de sesión que `middleware.ts` revisa en cada request. */
export async function POST(req: NextRequest) {
  const expected = process.env.WEB_PASSWORD;
  if (!expected) {
    return NextResponse.json({ ok: false, error: "WEB_PASSWORD no está configurada en el servidor." }, { status: 500 });
  }

  const body = await req.json().catch(() => null);
  const password = typeof body?.password === "string" ? body.password : "";
  if (password !== expected) {
    return NextResponse.json({ ok: false, error: "Contraseña incorrecta." }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set("vt_auth", expected, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 60 * 60 * 24 * 30,
    path: "/",
  });
  return res;
}
