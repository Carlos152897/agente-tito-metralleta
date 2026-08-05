import { describe, expect, it } from "vitest";
import { fingerprint, looksLikeSessionCookie, normalizeCookie } from "./marketsnackCookie";

describe("normalizeCookie", () => {
  it("quita saltos de línea y colapsa espacios", () => {
    expect(normalizeCookie("a=1;\n b=2;\n  c=3")).toBe("a=1; b=2; c=3");
  });

  it('quita el prefijo "Cookie:" si se pegó la línea completa de DevTools', () => {
    expect(normalizeCookie("Cookie: a=1; b=2")).toBe("a=1; b=2");
    expect(normalizeCookie("cookie:a=1; b=2")).toBe("a=1; b=2");
  });

  it("quita comillas envolventes", () => {
    expect(normalizeCookie('"a=1; b=2"')).toBe("a=1; b=2");
    expect(normalizeCookie("'a=1; b=2'")).toBe("a=1; b=2");
  });

  it("recorta espacios sobrantes al inicio y al final", () => {
    expect(normalizeCookie("   a=1; b=2   ")).toBe("a=1; b=2");
  });
});

describe("looksLikeSessionCookie", () => {
  it("reconoce _market_snack_session presente", () => {
    expect(looksLikeSessionCookie("_ga=1; _market_snack_session=abc123; _clsk=x")).toBe(true);
    expect(looksLikeSessionCookie("_market_snack_session=abc123")).toBe(true);
  });

  it("rechaza cuando falta la cookie de sesión", () => {
    expect(looksLikeSessionCookie("_ga=1; _clsk=x")).toBe(false);
    expect(looksLikeSessionCookie("")).toBe(false);
  });

  it("no confunde con un nombre parecido", () => {
    expect(looksLikeSessionCookie("not_market_snack_session=abc123")).toBe(false);
  });
});

describe("fingerprint", () => {
  it("nunca incluye el valor completo de la sesión", () => {
    const value = "x".repeat(200);
    const fp = fingerprint(`_ga=1; _market_snack_session=${value}; _clsk=y`);
    expect(fp).not.toContain(value);
    expect(fp.length).toBeLessThan(value.length);
  });

  it("muestra cabeza y cola reconocibles", () => {
    const fp = fingerprint("_market_snack_session=ABCDEF1234567890WXYZ");
    expect(fp.startsWith("ABCDEF")).toBe(true);
    expect(fp).toContain("WXYZ");
  });
});
