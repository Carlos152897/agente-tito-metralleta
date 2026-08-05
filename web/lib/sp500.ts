// Lista curada A MANO de los tickers del S&P 500. Mismo patrón y misma
// limitación que lib/wheelUniverse.ts: NO se valida contra el mercado, y la
// composición real del índice cambia con cada rebalanceo trimestral (altas y
// bajas) — si un ticker deja de pertenecer o se agrega uno nuevo, hay que
// actualizar esta lista a mano. Se usa como allowlist post-filtrado sobre el
// escaneo de TODO el mercado en app/api/contract-search/route.ts, porque
// MarketSnack (paginate() en lib/marketsnack.ts) no ofrece un filtro de
// índice/allowlist server-side — solo un ticker a la vez o nada.

export const SP500_TICKERS: Set<string> = new Set([
  // ── Tecnología / semiconductores / software ──
  "AAPL", "MSFT", "NVDA", "GOOGL", "GOOG", "AMZN", "META", "AVGO", "ORCL", "CRM",
  "ADBE", "CSCO", "ACN", "AMD", "QCOM", "TXN", "IBM", "INTU", "NOW", "AMAT",
  "MU", "ADI", "LRCX", "KLAC", "SNPS", "CDNS", "PANW", "ANET", "APH", "CRWD",
  "MSI", "ROP", "FTNT", "ADSK", "NXPI", "MCHP", "TEL", "GLW", "HPQ", "KEYS",
  "TDY", "ON", "CTSH", "IT", "GDDY", "MPWR", "FSLR", "TER", "ENPH", "SWKS",
  "GEN", "AKAM", "JBL", "JNPR", "NTAP", "TRMB", "WDC", "STX", "ZBRA", "PTC",
  "FFIV", "EPAM", "HPE", "DELL", "SMCI", "VRSN", "CDW", "DAY",

  // ── Comunicación / medios / internet ──
  "NFLX", "TMUS", "DIS", "CMCSA", "VZ", "T", "CHTR", "EA", "TTWO", "WBD",
  "OMC", "IPG", "LYV", "NWSA", "NWS", "FOXA", "FOX", "PARA",

  // ── Consumo discrecional / retail ──
  "TSLA", "HD", "MCD", "NKE", "LOW", "SBUX", "TJX", "BKNG", "ORLY", "MAR",
  "CMG", "ROST", "YUM", "AZO", "GM", "F", "HLT", "DHI", "LEN", "NVR",
  "EBAY", "ULTA", "BBY", "DPZ", "POOL", "GPC", "APTV", "TSCO", "LVS", "MGM",
  "WYNN", "RCL", "CCL", "NCLH", "EXPE", "RL", "DECK", "KMX", "GRMN", "LKQ",
  "PHM", "BBWI", "CZR", "HAS",

  // ── Consumo básico ──
  "WMT", "PG", "KO", "PEP", "COST", "PM", "MDLZ", "MO", "CL", "TGT",
  "KMB", "GIS", "STZ", "SYY", "KDP", "KHC", "HSY", "MKC", "ADM", "TAP",
  "CAG", "CHD", "CLX", "K", "SJM", "BG", "DG", "DLTR", "KR", "TSN",
  "EL", "MNST", "WBA", "KVUE",

  // ── Salud ──
  "UNH", "JNJ", "LLY", "ABBV", "MRK", "TMO", "ABT", "PFE", "DHR", "AMGN",
  "ISRG", "SYK", "BSX", "ELV", "MDT", "GILD", "VRTX", "CVS", "CI", "REGN",
  "ZTS", "HCA", "BDX", "IDXX", "EW", "A", "IQV", "MRNA", "BIIB", "CNC",
  "HUM", "GEHC", "DXCM", "RMD", "MTD", "WAT", "STE", "COO", "ZBH", "BAX",
  "VTRS", "CAH", "MCK", "COR", "HOLX", "TECH", "PODD", "ALGN", "INCY", "UHS",
  "DVA", "CRL", "MOH", "RVTY",

  // ── Financiero ──
  "BRK.B", "BRK-B", "BRKB", "JPM", "V", "MA", "BAC", "WFC", "GS", "MS", "SPGI", "AXP",
  "BLK", "C", "SCHW", "CB", "PGR", "MMC", "ICE", "PNC", "USB", "AON",
  "CME", "TFC", "AJG", "MCO", "COF", "TRV", "AIG", "MET", "BK", "AFL",
  "PRU", "ALL", "FIS", "FITB", "STT", "DFS", "AMP", "HIG", "SYF", "GPN",
  "NDAQ", "MTB", "WTW", "RJF", "CBOE", "KEY", "CFG", "HBAN", "NTRS", "RF",
  "BRO", "PFG", "L", "GL", "CINF", "WRB", "MKTX", "IVZ", "FDS", "EG",
  "JKHY", "ACGL", "PYPL",

  // ── Industriales ──
  "GE", "CAT", "RTX", "HON", "UNP", "BA", "DE", "LMT", "UPS", "ADP",
  "ETN", "GD", "NOC", "ITW", "CSX", "EMR", "MMM", "WM", "PH", "TT",
  "NSC", "FDX", "PCAR", "CARR", "JCI", "CMI", "GWW", "OTIS", "RSG", "AME",
  "PAYX", "URI", "IR", "XYL", "ROK", "DOV", "FAST", "HWM", "VRSK", "EFX",
  "BR", "CTAS", "LHX", "TDG", "SNA", "PWR", "IEX", "J", "SWK", "ODFL",
  "CHRW", "PNR", "AOS", "GNRC", "LDOS", "NDSN", "MAS", "ALLE", "WAB", "HII",
  "EXPD", "AXON",

  // ── Energía ──
  "XOM", "CVX", "COP", "SLB", "EOG", "MPC", "PSX", "VLO", "WMB", "OKE",
  "KMI", "OXY", "HES", "BKR", "FANG", "TRGP", "HAL", "DVN", "CTRA", "EQT",
  "APA",

  // ── Materiales ──
  "LIN", "SHW", "APD", "ECL", "FCX", "NEM", "NUE", "DOW", "CTVA", "PPG",
  "VMC", "MLM", "DD", "LYB", "IFF", "ALB", "STLD", "AVY", "CE", "PKG",
  "AMCR", "MOS", "IP", "EMN", "FMC",

  // ── Utilities ──
  "NEE", "SO", "DUK", "CEG", "AEP", "SRE", "D", "EXC", "XEL", "PEG",
  "ED", "WEC", "AWK", "EIX", "PCG", "DTE", "PPL", "AEE", "ETR", "FE",
  "CMS", "ATO", "CNP", "NI", "LNT", "EVRG", "NRG", "PNW",

  // ── Real estate (REITs) ──
  "PLD", "AMT", "EQIX", "PSA", "WELL", "DLR", "O", "SPG", "CCI", "VICI",
  "SBAC", "AVB", "EQR", "EXR", "IRM", "CBRE", "INVH", "MAA", "ESS", "UDR",
  "ARE", "VTR", "KIM", "CPT", "REG", "BXP", "HST", "FRT",

  // ── Otros / conglomerados ──
  "COIN", "PLTR", "UBER", "ABNB", "DASH", "SQ", "SHOP", "ROKU", "DDOG", "SNOW",
  "NET", "TTD", "ZS", "OKTA", "TWLO", "DOCU", "PINS", "SNAP", "LYFT",
]);
