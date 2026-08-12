import { NextRequest, NextResponse } from "next/server";

// Gate de contraseña compartida para el deploy público (Render). Sin
// WEB_PASSWORD configurada (dev local con `npm run dev`) no hace nada — solo
// se activa en producción, cuando la app queda expuesta a internet.
const PUBLIC_PATHS = ["/login", "/api/login"];

export function middleware(req: NextRequest) {
  const password = process.env.WEB_PASSWORD;
  if (!password) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname.startsWith(p))) return NextResponse.next();

  if (req.cookies.get("vt_auth")?.value === password) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
