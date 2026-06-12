export interface RegulatoryAgency {
  name: string;
  url: string;
  feedUrl: string;
  industries: string[];
  jurisdiction: string;
  searchTerms: string[];
}

export const REGULATORY_AGENCIES: Record<string, RegulatoryAgency[]> = {
  food: [
    {
      name: "FDA Human Foods Program",
      url: "https://www.fda.gov/food",
      feedUrl: "https://www.fda.gov/safety/recalls-market-withdrawals-safety-alerts",
      industries: ["food", "beverage", "dietary_supplements"],
      jurisdiction: "US",
      searchTerms: [
        "FDA food recall",
        "FDA food safety guidance",
        "FDA labeling requirement food",
      ],
    },
    {
      name: "USDA FSIS",
      url: "https://www.fsis.usda.gov",
      feedUrl: "https://www.fsis.usda.gov/recalls",
      industries: ["food", "meat", "poultry"],
      jurisdiction: "US",
      searchTerms: ["USDA FSIS recall", "USDA food safety regulation"],
    },
    {
      name: "FTC (Advertising & Claims)",
      url: "https://www.ftc.gov",
      feedUrl: "https://www.ftc.gov/news-events/news",
      industries: ["food", "beverage", "dietary_supplements"],
      jurisdiction: "US",
      searchTerms: ["FTC health claims enforcement food", "FTC deceptive marketing food"],
    },
    {
      name: "EU EFSA",
      url: "https://www.efsa.europa.eu",
      feedUrl: "https://www.efsa.europa.eu/en/news",
      industries: ["food", "beverage"],
      jurisdiction: "EU",
      searchTerms: ["EFSA food safety opinion", "EU food regulation update"],
    },
    {
      name: "UK FSA",
      url: "https://www.food.gov.uk",
      feedUrl: "https://www.food.gov.uk/news-alerts",
      industries: ["food", "beverage"],
      jurisdiction: "UK",
      searchTerms: ["UK FSA food alert", "UK food standards regulation"],
    },
    {
      name: "California OEHHA (Prop 65)",
      url: "https://oehha.ca.gov",
      feedUrl: "https://oehha.ca.gov/proposition-65",
      industries: ["food", "beverage", "consumer_products"],
      jurisdiction: "US-CA",
      searchTerms: ["Proposition 65 listing update", "OEHHA chemical listing food"],
    },
  ],
  fintech: [
    {
      name: "CFPB",
      url: "https://www.consumerfinance.gov",
      feedUrl: "https://www.consumerfinance.gov/rules-policy/final-rules/",
      industries: ["fintech", "lending", "payments", "bnpl"],
      jurisdiction: "US",
      searchTerms: [
        "CFPB rule update",
        "CFPB enforcement action",
        "CFPB BNPL guidance",
      ],
    },
    {
      name: "SEC",
      url: "https://www.sec.gov",
      feedUrl: "https://www.sec.gov/litigation/litreleases",
      industries: ["fintech", "crypto", "investment"],
      jurisdiction: "US",
      searchTerms: ["SEC rule fintech", "SEC crypto enforcement", "SEC guidance"],
    },
    {
      name: "FTC (Consumer Protection)",
      url: "https://www.ftc.gov",
      feedUrl: "https://www.ftc.gov/news-events/news",
      industries: ["fintech", "lending", "payments"],
      jurisdiction: "US",
      searchTerms: ["FTC fintech enforcement", "FTC consumer credit rule"],
    },
    {
      name: "FCA",
      url: "https://www.fca.org.uk",
      feedUrl: "https://www.fca.org.uk/news",
      industries: ["fintech", "lending", "payments"],
      jurisdiction: "UK",
      searchTerms: ["FCA regulation update", "FCA BNPL affordability rules"],
    },
    {
      name: "California DFPI",
      url: "https://dfpi.ca.gov",
      feedUrl: "https://dfpi.ca.gov/news/",
      industries: ["fintech", "lending", "bnpl"],
      jurisdiction: "US-CA",
      searchTerms: ["California DFPI fintech", "California lending regulation"],
    },
    {
      name: "Texas OCCC",
      url: "https://occc.texas.gov",
      feedUrl: "https://occc.texas.gov/news",
      industries: ["fintech", "lending"],
      jurisdiction: "US-TX",
      searchTerms: ["Texas OCCC regulation", "Texas consumer credit rule"],
    },
    {
      name: "NY DFS",
      url: "https://www.dfs.ny.gov",
      feedUrl: "https://www.dfs.ny.gov/reports_and_publications/press_releases",
      industries: ["fintech", "crypto", "lending"],
      jurisdiction: "US-NY",
      searchTerms: ["NYDFS regulation fintech", "NYDFS crypto guidance"],
    },
  ],
  pharma: [
    {
      name: "FDA CDER",
      url: "https://www.fda.gov/drugs",
      feedUrl: "https://www.fda.gov/drugs/drug-safety-and-availability",
      industries: ["pharma", "biotech", "medical_devices"],
      jurisdiction: "US",
      searchTerms: ["FDA drug recall", "FDA CDER guidance", "FDA pharma regulation"],
    },
    {
      name: "FDA CDRH (Devices)",
      url: "https://www.fda.gov/medical-devices",
      feedUrl: "https://www.fda.gov/medical-devices/medical-device-recalls",
      industries: ["medical_devices", "biotech"],
      jurisdiction: "US",
      searchTerms: ["FDA medical device recall", "FDA 510k guidance update"],
    },
    {
      name: "EMA",
      url: "https://www.ema.europa.eu",
      feedUrl: "https://www.ema.europa.eu/en/news-events/news",
      industries: ["pharma", "biotech"],
      jurisdiction: "EU",
      searchTerms: ["EMA drug regulation", "EMA guidance update"],
    },
    {
      name: "DEA",
      url: "https://www.dea.gov",
      feedUrl: "https://www.dea.gov/press-releases",
      industries: ["pharma"],
      jurisdiction: "US",
      searchTerms: ["DEA scheduling change", "DEA controlled substance rule"],
    },
  ],
  construction: [
    {
      name: "OSHA",
      url: "https://www.osha.gov",
      feedUrl: "https://www.osha.gov/news",
      industries: ["construction", "manufacturing", "real_estate"],
      jurisdiction: "US",
      searchTerms: ["OSHA construction regulation", "OSHA safety standard update"],
    },
    {
      name: "EPA",
      url: "https://www.epa.gov",
      feedUrl: "https://www.epa.gov/newsreleases",
      industries: ["construction", "manufacturing", "chemicals"],
      jurisdiction: "US",
      searchTerms: ["EPA construction regulation", "EPA environmental compliance"],
    },
    {
      name: "Cal/OSHA",
      url: "https://www.dir.ca.gov/dosh/",
      feedUrl: "https://www.dir.ca.gov/DIRNews/",
      industries: ["construction", "manufacturing"],
      jurisdiction: "US-CA",
      searchTerms: ["Cal OSHA standard update", "California construction safety rule"],
    },
    {
      name: "HUD",
      url: "https://www.hud.gov",
      feedUrl: "https://www.hud.gov/press",
      industries: ["real_estate", "construction"],
      jurisdiction: "US",
      searchTerms: ["HUD housing regulation", "HUD fair housing rule"],
    },
  ],
  hr: [
    {
      name: "DOL",
      url: "https://www.dol.gov",
      feedUrl: "https://www.dol.gov/newsroom",
      industries: ["hr", "staffing", "all"],
      jurisdiction: "US",
      searchTerms: ["DOL employment regulation", "DOL wage rule", "FLSA update"],
    },
    {
      name: "NLRB",
      url: "https://www.nlrb.gov",
      feedUrl: "https://www.nlrb.gov/news-outreach",
      industries: ["hr", "staffing"],
      jurisdiction: "US",
      searchTerms: ["NLRB ruling", "NLRB labor regulation update"],
    },
    {
      name: "EEOC",
      url: "https://www.eeoc.gov",
      feedUrl: "https://www.eeoc.gov/newsroom",
      industries: ["hr", "staffing", "all"],
      jurisdiction: "US",
      searchTerms: ["EEOC guidance update", "EEOC enforcement employment"],
    },
    {
      name: "California DLSE",
      url: "https://www.dir.ca.gov/dlse/",
      feedUrl: "https://www.dir.ca.gov/DIRNews/",
      industries: ["hr", "staffing"],
      jurisdiction: "US-CA",
      searchTerms: ["California labor law update", "California wage order change"],
    },
  ],
  other: [
    {
      name: "FTC",
      url: "https://www.ftc.gov",
      feedUrl: "https://www.ftc.gov/news-events/news",
      industries: ["all"],
      jurisdiction: "US",
      searchTerms: ["FTC rule update", "FTC enforcement action"],
    },
    {
      name: "CPSC",
      url: "https://www.cpsc.gov",
      feedUrl: "https://www.cpsc.gov/Recalls",
      industries: ["consumer_products", "all"],
      jurisdiction: "US",
      searchTerms: ["CPSC product recall", "CPSC safety standard"],
    },
    {
      name: "DOL",
      url: "https://www.dol.gov",
      feedUrl: "https://www.dol.gov/newsroom",
      industries: ["all"],
      jurisdiction: "US",
      searchTerms: ["DOL employment regulation", "FLSA update"],
    },
  ],
};

export function getAgenciesForProfile(
  industry: string,
  jurisdictions: string[]
): RegulatoryAgency[] {
  const agencies = REGULATORY_AGENCIES[industry] ?? REGULATORY_AGENCIES.other;
  return agencies.filter((a) => {
    if (a.jurisdiction === "US") {
      // Federal US agencies apply if any US jurisdiction selected
      return jurisdictions.some((j) => j === "US" || j.startsWith("US-"));
    }
    return jurisdictions.some((j) => j === a.jurisdiction || j.startsWith(a.jurisdiction));
  });
}
