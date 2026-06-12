export interface Market {
  /** Display name (also used to match topojson properties.name where possible). */
  name: string;
  /** ISO 3166-1 alpha-2. */
  iso2: string;
  /** ISO 3166-1 alpha-3 — what the AI is asked to return. */
  iso3: string;
  /** ISO 3166-1 numeric, as a string — the `id` used by world-atlas topojson. */
  numeric: string;
  /** Approximate centroid for map labels / markers. */
  lat: number;
  lng: number;
  region: "North America" | "South America" | "Europe" | "Middle East" | "Asia" | "Oceania";
}

/**
 * Curated set of major global markets analyzed on every compliance check.
 * Each maps cleanly to a world-atlas country geometry via `numeric`.
 */
export const MARKETS: Market[] = [
  { name: "United States", iso2: "US", iso3: "USA", numeric: "840", lat: 39.8, lng: -98.6, region: "North America" },
  { name: "Canada", iso2: "CA", iso3: "CAN", numeric: "124", lat: 56.1, lng: -106.3, region: "North America" },
  { name: "Mexico", iso2: "MX", iso3: "MEX", numeric: "484", lat: 23.6, lng: -102.6, region: "North America" },
  { name: "Brazil", iso2: "BR", iso3: "BRA", numeric: "76", lat: -14.2, lng: -51.9, region: "South America" },
  { name: "United Kingdom", iso2: "GB", iso3: "GBR", numeric: "826", lat: 55.4, lng: -3.4, region: "Europe" },
  { name: "Germany", iso2: "DE", iso3: "DEU", numeric: "276", lat: 51.2, lng: 10.5, region: "Europe" },
  { name: "France", iso2: "FR", iso3: "FRA", numeric: "250", lat: 46.6, lng: 2.2, region: "Europe" },
  { name: "Italy", iso2: "IT", iso3: "ITA", numeric: "380", lat: 41.9, lng: 12.6, region: "Europe" },
  { name: "Spain", iso2: "ES", iso3: "ESP", numeric: "724", lat: 40.5, lng: -3.7, region: "Europe" },
  { name: "United Arab Emirates", iso2: "AE", iso3: "ARE", numeric: "784", lat: 23.4, lng: 53.8, region: "Middle East" },
  { name: "India", iso2: "IN", iso3: "IND", numeric: "356", lat: 20.6, lng: 79.0, region: "Asia" },
  { name: "Singapore", iso2: "SG", iso3: "SGP", numeric: "702", lat: 1.35, lng: 103.8, region: "Asia" },
  { name: "China", iso2: "CN", iso3: "CHN", numeric: "156", lat: 35.9, lng: 104.2, region: "Asia" },
  { name: "Japan", iso2: "JP", iso3: "JPN", numeric: "392", lat: 36.2, lng: 138.3, region: "Asia" },
  { name: "South Korea", iso2: "KR", iso3: "KOR", numeric: "410", lat: 35.9, lng: 127.8, region: "Asia" },
  { name: "Australia", iso2: "AU", iso3: "AUS", numeric: "36", lat: -25.3, lng: 133.8, region: "Oceania" },
];

/** Lookup by ISO alpha-3 (case-insensitive). */
export const MARKET_BY_ISO3: Record<string, Market> = MARKETS.reduce(
  (acc, m) => {
    acc[m.iso3.toUpperCase()] = m;
    return acc;
  },
  {} as Record<string, Market>
);

/** Lookup by ISO numeric (topojson geography id). */
export const MARKET_BY_NUMERIC: Record<string, Market> = MARKETS.reduce(
  (acc, m) => {
    acc[m.numeric] = m;
    return acc;
  },
  {} as Record<string, Market>
);

/** Compact string of markets for prompting the model. */
export const MARKETS_PROMPT = MARKETS.map((m) => `${m.name} (${m.iso3})`).join(", ");
