import { describe, expect, it } from "vitest";
import {
  companyAliases,
  contradictionFlag,
  decodeEntities,
  flowBias,
  mentionsCompany,
  newsBias,
  parseFeedDate,
  parseRss,
  recencyWeight,
  type NewsItem,
} from "./news";

const NOW = new Date("2026-07-24T12:00:00Z");

function item(p: Partial<NewsItem>): NewsItem {
  return {
    id: "x", title: "t", url: "u", publisher: "p",
    publishedUtc: NOW.toISOString(), description: null,
    sentiment: null, reasoning: null, layer: "company",
    ...p,
  };
}

describe("parseRss", () => {
  // CNBC entrega todo el XML en una sola línea y con entidades escapadas.
  const cnbc = `<rss><channel><item>      <link>https://cnbc.com/a.html</link>` +
    `<guid isPermaLink="false">108339599</guid>` +
    `<title>Trump&apos;s tariff draws rebukes</title>` +
    `<description><![CDATA[Partners rejected the rationale.]]></description>` +
    `<pubDate>Fri, 24 Jul 2026 03:15:46 GMT</pubDate>    </item>` +
    `<item><link>https://cnbc.com/b.html</link><title>Intel jumps</title>` +
    `<pubDate>Fri, 24 Jul 2026 01:00:00 GMT</pubDate></item></channel></rss>`;

  it("extrae los items aunque vengan en una sola línea", () => {
    const rows = parseRss(cnbc, "CNBC");
    expect(rows).toHaveLength(2);
    expect(rows[0].title).toBe("Trump's tariff draws rebukes");
    expect(rows[0].description).toBe("Partners rejected the rationale.");
    expect(rows[0].url).toBe("https://cnbc.com/a.html");
    expect(rows[0].publishedUtc).toBe("2026-07-24T03:15:46.000Z");
    expect(rows[0].layer).toBe("macro");
  });

  it("descarta items sin título o sin link", () => {
    expect(parseRss("<item><title>solo título</title></item>", "X")).toHaveLength(0);
  });

  it("no revienta con XML basura", () => {
    expect(parseRss("no soy xml", "X")).toEqual([]);
  });
});

describe("parseFeedDate", () => {
  it("acepta RFC-822 de CNBC", () => {
    expect(parseFeedDate("Fri, 24 Jul 2026 03:15:46 GMT")).toBe("2026-07-24T03:15:46.000Z");
  });
  it("asume UTC en el formato sin zona de Investing.com", () => {
    expect(parseFeedDate("2026-07-24 02:54:27")).toBe("2026-07-24T02:54:27.000Z");
  });
  it("devuelve null si no se puede parsear", () => {
    expect(parseFeedDate("ayer")).toBeNull();
    expect(parseFeedDate(null)).toBeNull();
  });
});

describe("decodeEntities", () => {
  it("decodifica las entidades que usan los feeds", () => {
    expect(decodeEntities("Tesla&apos;s &amp; Intel&#39;s")).toBe("Tesla's & Intel's");
  });
});

describe("companyAliases", () => {
  it("limpia los sufijos societarios", () => {
    expect(companyAliases("TSLA", "Tesla, Inc. Common Stock")).toEqual(["TSLA", "Tesla"]);
  });
  it("conserva el ticker y el nombre de NVIDIA", () => {
    expect(companyAliases("NVDA", "NVIDIA Corporation")).toEqual(["NVDA", "NVIDIA"]);
  });
  it("descarta tickers de 1-2 letras (harían match con cualquier palabra)", () => {
    expect(companyAliases("F", "Ford Motor Company")).not.toContain("F");
  });
});

describe("mentionsCompany", () => {
  const aliases = companyAliases("TSLA", "Tesla, Inc. Common Stock");

  it("encuentra la empresa por nombre sin importar mayúsculas", () => {
    expect(mentionsCompany("Why tesla stock crashed today", aliases)).toBe("Tesla");
  });
  it("encuentra la empresa por ticker", () => {
    expect(mentionsCompany("TSLA earnings miss", aliases)).toBe("TSLA");
  });
  it("exige mayúsculas para el ticker", () => {
    expect(mentionsCompany("the tsla in lowercase", ["TSLA"])).toBeNull();
  });
  it("respeta límites de palabra", () => {
    expect(mentionsCompany("Teslas Roadster", ["Tesla"])).toBeNull();
  });
  it("no marca titulares ajenos", () => {
    expect(mentionsCompany("Fed holds rates steady", aliases)).toBeNull();
  });
});

describe("recencyWeight", () => {
  it("pesa completo lo de hoy y menos lo viejo", () => {
    expect(recencyWeight("2026-07-24T06:00:00Z", NOW)).toBe(1);
    expect(recencyWeight("2026-07-22T12:00:00Z", NOW)).toBe(0.6);
    expect(recencyWeight("2026-07-20T12:00:00Z", NOW)).toBe(0.3);
    expect(recencyWeight("2026-06-01T12:00:00Z", NOW)).toBe(0.1);
  });
});

describe("newsBias", () => {
  it("sin sentimiento → neutral", () => {
    expect(newsBias([item({}), item({})], NOW).bias).toBe("neutral");
  });

  it("varias negativas frescas → bearish", () => {
    const b = newsBias([item({ sentiment: "negative" }), item({ sentiment: "negative" })], NOW);
    expect(b.bias).toBe("bearish");
    expect(b.score).toBe(-1);
    expect(b.negative).toBe(2);
  });

  it("positivas → bullish", () => {
    expect(newsBias([item({ sentiment: "positive" })], NOW).bias).toBe("bullish");
  });

  it("una de cada una y en empate → mixed", () => {
    const b = newsBias([item({ sentiment: "positive" }), item({ sentiment: "negative" })], NOW);
    expect(b.bias).toBe("mixed");
    expect(b.score).toBe(0);
  });

  it("la noticia fresca pesa más que la vieja", () => {
    const b = newsBias(
      [
        item({ sentiment: "negative", publishedUtc: "2026-07-24T10:00:00Z" }),
        item({ sentiment: "positive", publishedUtc: "2026-06-01T10:00:00Z" }),
      ],
      NOW,
    );
    expect(b.bias).toBe("bearish");
  });
});

describe("flowBias", () => {
  it("mapea el % de calls a dirección", () => {
    expect(flowBias(93)).toBe("bullish");
    expect(flowBias(7)).toBe("bearish");
    expect(flowBias(50)).toBe("neutral");
    expect(flowBias(60)).toBe("bullish");
    expect(flowBias(40)).toBe("bearish");
  });
});

describe("contradictionFlag", () => {
  const bearNews = newsBias([item({ sentiment: "negative" })], NOW);
  const bullNews = newsBias([item({ sentiment: "positive" })], NOW);
  const noNews = newsBias([], NOW);

  it("mismo lado → confirmación", () => {
    const f = contradictionFlag("bearish", bearNews);
    expect(f.kind).toBe("confirm");
    expect(f.title).toContain("bajista");
  });

  it("flujo alcista contra noticia negativa → conflicto", () => {
    const f = contradictionFlag("bullish", bearNews);
    expect(f.kind).toBe("conflict");
    expect(f.detail).toContain("contra el pánico");
  });

  it("flujo bajista contra noticia positiva → conflicto", () => {
    expect(contradictionFlag("bearish", bullNews).kind).toBe("conflict");
  });

  it("sin noticias con dirección → sin bandera", () => {
    expect(contradictionFlag("bullish", noNews).kind).toBe("none");
  });

  it("flujo repartido → sin bandera", () => {
    expect(contradictionFlag("neutral", bearNews).kind).toBe("none");
  });
});
