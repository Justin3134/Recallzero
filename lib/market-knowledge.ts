/**
 * Curated regulatory knowledge for the 16 supported markets.
 *
 * Used as a fallback when the AI batch assessment is unavailable (e.g. API
 * billing not active). Provides real, category-specific regulatory context
 * rather than a generic "data unavailable" message.
 */

import type { CountryVerdict } from "@/types";
import type { Market } from "@/lib/markets";

type CategoryEntry = {
  status?: "allowed" | "review" | "prohibited";
  score?: number;
  reasons: string[];
  regulations: string[];
};

type MarketEntry = {
  /** Default status when no category matches. */
  status: "allowed" | "review";
  /** Default risk score (0 = safest, 100 = riskiest). */
  score: number;
  /** Category-keyed overrides. Keys matched by substring against the category string. */
  categories: Record<string, CategoryEntry>;
  /** Regulations always shown regardless of category. */
  base_regulations: string[];
  /** Fallback reasons when no category override matches. */
  base_reasons: string[];
};

const KNOWLEDGE: Record<string, MarketEntry> = {
  USA: {
    status: "review",
    score: 45,
    base_regulations: ["FTC Act", "State consumer-protection laws"],
    base_reasons: [
      "Products must meet federal and applicable state regulations before market entry.",
      "FTC oversight applies to all marketing claims.",
    ],
    categories: {
      food: {
        score: 40,
        reasons: [
          "FDA labeling (21 CFR Part 101) requires Nutrition Facts panel, ingredient list, and allergen disclosure.",
          "All ingredients must be GRAS or FDA-approved food additives.",
          "Marketing claims (health claims, structure/function) require substantiation.",
        ],
        regulations: ["FDA 21 CFR Part 101", "FSMA", "California Prop 65", "FDA GRAS"],
      },
      fintech: {
        score: 55,
        reasons: [
          "Money transmission requires state-by-state licenses in most US states.",
          "FinCEN registration and BSA/AML program required for money services businesses.",
          "CFPB oversees consumer financial products; Regulation E, Z, and ECOA apply.",
        ],
        regulations: ["Bank Secrecy Act", "FinCEN MSB Registration", "CFPB Regulation E / Z", "ECOA"],
      },
      pharma: {
        status: "review",
        score: 65,
        reasons: [
          "Prescription drugs require FDA NDA/BLA approval before US market entry.",
          "OTC products must follow FDA monograph system or obtain NDA.",
          "Clinical trials require IND filing and IRB approval.",
        ],
        regulations: ["FDA 21 CFR 312 (IND)", "FDA NDA/BLA", "DEA Scheduling", "cGMP 21 CFR 211"],
      },
      construction: {
        score: 45,
        reasons: [
          "Building materials must meet ASTM/ANSI standards and local building codes.",
          "EPA regulations apply to lead, asbestos, and hazardous materials.",
        ],
        regulations: ["OSHA 29 CFR 1926", "EPA TSCA", "ICC Building Codes"],
      },
      hr: {
        score: 40,
        reasons: [
          "Federal employment law (FLSA, Title VII, ADA) applies; state law may be stricter.",
          "Multi-state payroll requires compliance with each state's wage and hour rules.",
        ],
        regulations: ["FLSA", "Title VII", "ADA", "FMLA", "State wage & hour laws"],
      },
    },
  },

  CAN: {
    status: "review",
    score: 40,
    base_regulations: ["Competition Act", "PIPEDA / Privacy law"],
    base_reasons: [
      "Canada has harmonized many standards with the US but maintains distinct federal and provincial requirements.",
    ],
    categories: {
      food: {
        score: 38,
        reasons: [
          "Safe Food for Canadians Regulations (SFCR) governs labeling, allergens, and import controls.",
          "Health Canada Novel Foods regulations apply to ingredients not previously approved.",
          "Bilingual (English/French) labeling mandatory for retail products.",
        ],
        regulations: ["SFCR", "Food and Drugs Act", "Health Canada Novel Foods", "CFIA"],
      },
      fintech: {
        score: 45,
        reasons: [
          "FINTRAC registration required for money services businesses.",
          "Provincial securities regulators (OSC, AMF) oversee investment products.",
          "PIPEDA governs collection and use of personal financial data.",
        ],
        regulations: ["FINTRAC PCMLTFA", "OSC / AMF Securities Act", "PIPEDA"],
      },
      pharma: {
        score: 60,
        reasons: [
          "Health Canada Drug Product Database authorization required before sale.",
          "Clinical trials require CTA filing with Health Canada.",
        ],
        regulations: ["Food and Drugs Act (Part C)", "Clinical Trials Regulations SOR/2001-203", "Health Canada DPD"],
      },
    },
  },

  MEX: {
    status: "review",
    score: 50,
    base_regulations: ["Ley Federal de Protección al Consumidor (PROFECO)"],
    base_reasons: [
      "COFEPRIS is the primary regulatory authority; registration or notification required for most regulated products.",
    ],
    categories: {
      food: {
        score: 48,
        reasons: [
          "NOM-051-SCFI/SSA1-2010 governs general food and non-alcoholic beverage labeling.",
          "Front-of-pack warning labels (octagonal seals) mandatory for high-calorie, high-sugar, and high-sodium foods.",
          "COFEPRIS authorization required for novel or functional ingredients.",
        ],
        regulations: ["NOM-051-SCFI/SSA1-2010", "COFEPRIS (Ley General de Salud)", "NOM-086-SSA1-1994"],
      },
      fintech: {
        score: 55,
        reasons: [
          "Ley para Regular las Instituciones de Tecnología Financiera (Fintech Law 2018) requires CNBV authorization.",
          "CONDUSEF handles consumer financial protection; disclosure rules apply.",
        ],
        regulations: ["Ley Fintech (2018)", "CNBV", "CONDUSEF", "Ley de Instituciones de Crédito"],
      },
      pharma: {
        score: 65,
        reasons: [
          "COFEPRIS sanitary registration required before commercial sale of drugs.",
          "Clinical trials require COFEPRIS approval and ethics committee sign-off.",
        ],
        regulations: ["Ley General de Salud", "COFEPRIS", "NOM-220-SSA1 (pharmacovigilance)"],
      },
    },
  },

  BRA: {
    status: "review",
    score: 55,
    base_regulations: ["Código de Defesa do Consumidor (CDC)", "LGPD (data privacy)"],
    base_reasons: [
      "ANVISA oversight is required for health-related products; importers must register with ANVISA.",
    ],
    categories: {
      food: {
        score: 50,
        reasons: [
          "ANVISA RDC 259/2002 governs general labeling; RDC 429/2020 covers nutritional information.",
          "Front-of-pack nutritional warning labels (magnifier icon) mandated since Oct 2022.",
          "Certain additives and claims require prior ANVISA approval.",
        ],
        regulations: ["ANVISA RDC 429/2020", "ANVISA RDC 259/2002", "MAPA (Ministry of Agriculture)"],
      },
      fintech: {
        score: 60,
        reasons: [
          "Banco Central do Brasil (BCB) authorization required for payment institutions.",
          "PIX open-banking framework and open finance regulations apply.",
          "COAF (financial intelligence unit) reporting required for AML compliance.",
        ],
        regulations: ["Lei 12.865/2013 (payment institutions)", "BCB Resolution 80/2021", "COAF/AML"],
      },
      pharma: {
        score: 70,
        reasons: [
          "ANVISA registration (AFE) required before any pharmaceutical product can be marketed.",
          "RDC 204/2017 governs good manufacturing practices; Brazilian GMP certification needed.",
        ],
        regulations: ["ANVISA RDC 204/2017", "Lei 6.360/1976", "ANVISA AFE License"],
      },
    },
  },

  GBR: {
    status: "review",
    score: 42,
    base_regulations: ["UK GDPR", "Consumer Rights Act 2015"],
    base_reasons: [
      "Post-Brexit, UK has its own regulatory framework separate from the EU; UKCA marking now required for certain products.",
    ],
    categories: {
      food: {
        score: 40,
        reasons: [
          "UK Food Information Regulations 2014 require allergen, ingredient, and nutrition labeling.",
          "UKCA marking does not apply to food, but FSA/FSS oversight applies to food safety.",
          "Products previously approved under EU Novel Food regulation require re-authorization under UK Novel Food rules.",
        ],
        regulations: ["UK Food Information Regulations 2014", "FSA Food Safety Act 1990", "UK Novel Food Catalogue"],
      },
      fintech: {
        score: 50,
        reasons: [
          "FCA authorization required for regulated financial activities (payment services, e-money, lending).",
          "UK-GDPR and Data Protection Act 2018 govern customer data handling.",
          "AML/CTF regulations under the Proceeds of Crime Act 2002 apply.",
        ],
        regulations: ["FCA FSMA 2000", "Payment Services Regulations 2017", "UK-GDPR", "MLR 2017"],
      },
      pharma: {
        score: 65,
        reasons: [
          "MHRA Marketing Authorisation (MA) required for medicines sold in Great Britain.",
          "Northern Ireland has special arrangements and may also require EMA approval.",
        ],
        regulations: ["Medicines Act 1968", "MHRA MA", "Human Medicines Regulations 2012"],
      },
    },
  },

  DEU: {
    status: "review",
    score: 42,
    base_regulations: ["GDPR", "EU Consumer Rights Directive"],
    base_reasons: [
      "Germany applies EU regulations strictly, with additional national implementations; BfR provides scientific guidance.",
    ],
    categories: {
      food: {
        score: 40,
        reasons: [
          "EU Regulation 1169/2011 (LMIV) mandates ingredient list, allergens, and nutrition declaration.",
          "Health claims must appear on the EU Health Claims Register (EC 1924/2006).",
          "BfR risk assessments are influential for ingredients near the regulatory boundary.",
        ],
        regulations: ["EU Reg 1169/2011 (LMIV)", "EC 1924/2006 (Health Claims)", "LFGB", "BfR"],
      },
      fintech: {
        score: 50,
        reasons: [
          "BaFin authorization required for banking, payment, and e-money services.",
          "EU MiCA applies to crypto-asset issuers and service providers from end of 2024.",
          "GDPR strictly enforced by German DPAs; fines regularly issued.",
        ],
        regulations: ["KWG (Banking Act)", "ZAG (Payment Services)", "EU MiCA", "GDPR / BDSG"],
      },
      pharma: {
        score: 65,
        reasons: [
          "EU-wide Marketing Authorisation (EMA) or national BfArM authorization required.",
          "Arzneimittelgesetz (AMG) governs German pharmaceutical law.",
        ],
        regulations: ["AMG", "BfArM MA", "EMA Centralized Procedure", "EU GMP Directive 2003/94/EC"],
      },
    },
  },

  FRA: {
    status: "review",
    score: 43,
    base_regulations: ["GDPR", "Loi Hamon (consumer protection)"],
    base_reasons: [
      "France applies EU regulations and adds national requirements; DGCCRF enforces consumer protection.",
    ],
    categories: {
      food: {
        score: 40,
        reasons: [
          "EU Reg 1169/2011 labeling rules apply; Nutri-Score display is voluntary but widely expected.",
          "ANSES evaluates novel ingredients and health-claim dossiers.",
          "Specific French rules on flavoring, additives (arrêté du 2 octobre 1997), and organic labeling apply.",
        ],
        regulations: ["EU Reg 1169/2011", "EC 1924/2006", "ANSES", "DGCCRF"],
      },
      fintech: {
        score: 50,
        reasons: [
          "ACPR authorization required for payment institutions and credit providers.",
          "AMF oversees investment services and crypto-asset service providers (PSAN regime under Loi PACTE).",
          "GDPR enforced by CNIL; consent rules are strictly interpreted.",
        ],
        regulations: ["Code Monétaire et Financier", "ACPR", "AMF PSAN (Loi PACTE)", "GDPR / CNIL"],
      },
      pharma: {
        score: 65,
        reasons: [
          "ANSM (Agence nationale de sécurité du médicament) authorization required.",
          "EMA centralized procedure available for innovative medicines.",
        ],
        regulations: ["Code de la Santé Publique", "ANSM MA", "EU Clinical Trials Regulation 536/2014"],
      },
    },
  },

  ITA: {
    status: "review",
    score: 44,
    base_regulations: ["GDPR", "Codice del Consumo (Consumer Code D.Lgs. 206/2005)"],
    base_reasons: [
      "Italy applies EU regulations; Ministero della Salute and ICQRF provide enforcement oversight.",
    ],
    categories: {
      food: {
        score: 42,
        reasons: [
          "EU Reg 1169/2011 labeling mandatory; Italian DOP/IGP designations restrict geographic claims.",
          "Supplements governed by Ministerial Decree 10 August 2018; notification to MdS required.",
          "Italy has a long list of authorized food supplements via official Ministry lists.",
        ],
        regulations: ["EU Reg 1169/2011", "D.M. 10/8/2018 (supplements)", "ICQRF", "D.Lgs. 231/2017"],
      },
      fintech: {
        score: 50,
        reasons: [
          "Banca d'Italia authorization required for payment and e-money institutions.",
          "Consob oversees investment services and crypto under MiCA.",
          "GDPR enforced by Garante Privacy.",
        ],
        regulations: ["Testo Unico Bancario (TUB)", "Banca d'Italia", "Consob", "EU MiCA", "GDPR"],
      },
      pharma: {
        score: 65,
        reasons: [
          "AIFA (Agenzia Italiana del Farmaco) authorization required for marketing drugs in Italy.",
        ],
        regulations: ["D.Lgs. 219/2006", "AIFA MA", "EMA Centralized Procedure"],
      },
    },
  },

  ESP: {
    status: "review",
    score: 43,
    base_regulations: ["GDPR", "Ley General para la Defensa de los Consumidores y Usuarios"],
    base_reasons: [
      "Spain applies EU regulations; AESAN and AEMPS are the primary regulatory bodies.",
    ],
    categories: {
      food: {
        score: 40,
        reasons: [
          "EU Reg 1169/2011 mandatory; AESAN supervises food safety and labeling enforcement.",
          "Health and nutrition claims must be on the EU Register (EC 1924/2006).",
          "Royal Decree 1334/1999 governs general food labeling supplementing EU rules.",
        ],
        regulations: ["EU Reg 1169/2011", "EC 1924/2006", "AESAN", "Real Decreto 1334/1999"],
      },
      fintech: {
        score: 50,
        reasons: [
          "Banco de España authorization required for payment institutions and electronic money.",
          "CNMV oversees investment services and crypto assets under MiCA.",
          "GDPR enforced by AEPD; strong enforcement track record.",
        ],
        regulations: ["Ley 16/2009 (payment services)", "Banco de España", "CNMV", "EU MiCA", "GDPR"],
      },
      pharma: {
        score: 65,
        reasons: [
          "AEMPS authorization required; medicines must be on the Spanish registry.",
        ],
        regulations: ["Ley 29/2006 (Garantías y uso racional de los medicamentos)", "AEMPS MA"],
      },
    },
  },

  ARE: {
    status: "review",
    score: 52,
    base_regulations: ["UAE Consumer Protection Law 2020", "Gulf Cooperation Council (GCC) standards"],
    base_reasons: [
      "ESMA and MOIAT oversee product safety and import standards; GCC/GSO standards apply across the Gulf region.",
      "Halal certification is required for food products targeting Muslim consumers, which is effectively the entire market.",
    ],
    categories: {
      food: {
        score: 50,
        reasons: [
          "ESMA mandatory food standards (GSO standards) apply; Halal certification required for meat and many processed foods.",
          "Arabic labeling mandatory alongside English for all food products.",
          "Import permits from MOIAT required; HACCP certification expected for food facilities.",
        ],
        regulations: ["GSO 9/2013 (General Food Labelling)", "UAE Cabinet Decision 16/2021 (food safety)", "ESMA", "MOIAT Halal Standards"],
      },
      fintech: {
        score: 58,
        reasons: [
          "CBUAE licenses required for payment service providers and exchange houses operating onshore.",
          "DFSA (Dubai) and ADGM FSRA (Abu Dhabi) provide offshore financial free-zone frameworks.",
          "Virtual Asset Service Providers must be licensed by VARA (Dubai) or ADGM.",
        ],
        regulations: ["CBUAE Regulatory Framework", "DFSA Rulebook", "ADGM FSRA", "VARA (Dubai Virtual Assets)"],
      },
      pharma: {
        score: 65,
        reasons: [
          "MOHAP drug registration mandatory before importing or selling medicines in the UAE.",
          "Controlled substances require DHA / MOHAP narcotics permits.",
        ],
        regulations: ["MOHAP Drug Registration", "Federal Law No. 4/1983 (pharmacy)", "DHA Controlled Substances"],
      },
    },
  },

  IND: {
    status: "review",
    score: 55,
    base_regulations: ["Consumer Protection Act 2019", "Bureau of Indian Standards (BIS)"],
    base_reasons: [
      "India has a complex multi-authority regulatory environment; state-level licenses often required in addition to central approvals.",
    ],
    categories: {
      food: {
        score: 52,
        reasons: [
          "FSSAI Central or State License mandatory for manufacturing, processing, or importing food products.",
          "Food Safety and Standards (Labelling and Display) Regulations 2020 require bilingual labeling and nutritional info.",
          "Certain additives and colors require FSSAI pre-approval; not all globally permitted additives are allowed in India.",
        ],
        regulations: ["FSSAI (Food Safety and Standards Act 2006)", "FSS (Labelling) Regulations 2020", "FSSAI Central License", "AGMARK"],
      },
      fintech: {
        score: 60,
        reasons: [
          "RBI authorization required for payment aggregators, wallets, and prepaid payment instruments.",
          "SEBI governs securities and investment products; IRDAI handles insurance.",
          "Data localization requirements under RBI and emerging DPDP Act apply.",
        ],
        regulations: ["RBI Payment Aggregator Guidelines 2020", "SEBI", "IRDAI", "PMLA 2002", "DPDP Act 2023"],
      },
      pharma: {
        score: 70,
        reasons: [
          "CDSCO import license under the Drugs and Cosmetics Act required for drugs.",
          "Schedule M GMP standards apply; WHO-GMP certification expected.",
          "Clinical trials require CDSCO approval and independent ethics committee clearance.",
        ],
        regulations: ["Drugs and Cosmetics Act 1940", "CDSCO Import License", "Schedule M (GMP)", "New Drugs & Clinical Trials Rules 2019"],
      },
    },
  },

  SGP: {
    status: "review",
    score: 38,
    base_regulations: ["Consumer Protection (Fair Trading) Act", "Personal Data Protection Act (PDPA)"],
    base_reasons: [
      "Singapore is generally business-friendly; SFA and HSA are the main regulatory authorities with clear digital-first processes.",
    ],
    categories: {
      food: {
        score: 35,
        reasons: [
          "SFA (Singapore Food Agency) licensing required for importing, manufacturing, or selling food.",
          "Food Regulations under the Sale of Food Act govern labeling, additives, and maximum residue limits.",
          "Novel foods (e.g. cultivated meat) require SFA novel food approval.",
        ],
        regulations: ["Sale of Food Act", "Food Regulations (Cap 283)", "SFA Licence", "AVA Import Conditions"],
      },
      fintech: {
        score: 40,
        reasons: [
          "MAS Payment Services Act 2019 requires licensing for payment service providers and digital token service providers.",
          "Financial Advisers Act governs investment advice.",
          "MAS Fintech Regulatory Sandbox available for innovative business models.",
        ],
        regulations: ["MAS Payment Services Act 2019", "Financial Advisers Act", "Securities and Futures Act", "MAS AML/CFT Notice"],
      },
      pharma: {
        score: 55,
        reasons: [
          "HSA product licence required under Health Products Act before marketing therapeutic products.",
          "Clinical trials require HSA Clinical Trial Authorization (CTA).",
        ],
        regulations: ["Health Products Act (Cap 122D)", "HSA Product Licence", "Medicines Act (Cap 176)"],
      },
    },
  },

  CHN: {
    status: "review",
    score: 65,
    base_regulations: ["Product Quality Law", "Consumer Protection Law", "Cybersecurity Law"],
    base_reasons: [
      "China requires product registration or filing with SAMR/NMPA before import; documentation in Mandarin is mandatory.",
      "Cross-border data transfers and data localization rules under Cybersecurity and Data Security laws apply.",
    ],
    categories: {
      food: {
        score: 62,
        reasons: [
          "GB 7718 (general food labeling standard) and GB 28050 (nutrition labeling) are mandatory; Chinese-language labels required.",
          "GACC registration required for overseas food manufacturers exporting to China.",
          "Novel or functional ingredients require SAMR/CAPI approval before use.",
        ],
        regulations: ["GB 7718", "GB 28050", "GACC Registration", "Food Safety Law 2015", "SAMR"],
      },
      fintech: {
        score: 75,
        reasons: [
          "PBOC payment license required; foreign payment institutions face stringent restrictions.",
          "CBIRC oversees banking and insurance; CSRC covers securities.",
          "ICP license and cybersecurity assessment required for online financial services.",
        ],
        regulations: ["Payment Services Management Measures (PBOC)", "Cybersecurity Law", "Data Security Law", "CBIRC", "CSRC"],
      },
      pharma: {
        status: "review",
        score: 72,
        reasons: [
          "NMPA (formerly CFDA) marketing authorization required; clinical trial registration mandatory.",
          "GMP compliance audit by NMPA required; China-specific clinical data often needed.",
        ],
        regulations: ["NMPA/CFDA MA", "Drug Administration Law 2019", "GMP Annex China", "NMPA IND"],
      },
    },
  },

  JPN: {
    status: "review",
    score: 48,
    base_regulations: ["Consumer Product Safety Act", "Act against Unjustifiable Premiums and Misleading Representations"],
    base_reasons: [
      "Japan's regulatory framework is detailed and documentation-heavy; Japanese-language labeling is required for most products.",
    ],
    categories: {
      food: {
        score: 45,
        reasons: [
          "Food Sanitation Act (Shokuhin Eiseiho) governs additives, contaminants, and standards; CAA oversees labeling.",
          "Consumer Affairs Agency (CAA) requires nutrition labeling under the Food Labelling Standards.",
          "Function claims (Kinno hyoji) and Foods with Function Claims (FFC) have specific submission requirements.",
        ],
        regulations: ["Food Sanitation Act", "Food Labelling Act 2013", "JHFA (Japan Health Food Authorization)", "MHLW Additive Positive List"],
      },
      fintech: {
        score: 52,
        reasons: [
          "Financial Services Agency (FSA) license required for payment services and crypto-asset exchange.",
          "Act on Settlement of Funds governs payment service providers.",
          "Anti-money laundering law (Hanzai Shueki Kisei Ho) requires KYC/AML compliance.",
        ],
        regulations: ["Payment Services Act", "Financial Instruments and Exchange Act (FIEA)", "Act on Prevention of Transfer of Criminal Proceeds", "FSA"],
      },
      pharma: {
        score: 68,
        reasons: [
          "PMDA review and MHLW approval required under the Pharmaceuticals, Medical Devices Act (PMD Act).",
          "Japan-specific clinical data often required; PMDA consultation recommended early in development.",
        ],
        regulations: ["PMD Act (Pharmaceutical and Medical Device Act)", "PMDA Review", "MHLW Approval"],
      },
    },
  },

  KOR: {
    status: "review",
    score: 50,
    base_regulations: ["Consumer Protection Act", "Personal Information Protection Act (PIPA)"],
    base_reasons: [
      "MFDS (Ministry of Food and Drug Safety) is the main regulatory body; Korean-language labeling required.",
    ],
    categories: {
      food: {
        score: 47,
        reasons: [
          "Food Sanitation Act and Korean Food Standards Codex govern safety standards, additives, and labeling.",
          "MFDS requires nutrition labeling; allergen labeling for 22 specified allergens.",
          "HACCP certification expected for certain food categories; import inspection at port of entry.",
        ],
        regulations: ["Food Sanitation Act", "Korean Food Standards Codex (KFSC)", "MFDS HACCP", "Health Functional Food Act"],
      },
      fintech: {
        score: 55,
        reasons: [
          "Financial Services Commission (FSC) license required for electronic financial services.",
          "Special Act on Reporting and Using Specified Financial Transaction Information governs AML.",
          "Korea has a Virtual Asset User Protection Act governing crypto-asset exchanges.",
        ],
        regulations: ["Electronic Financial Transactions Act", "FSC", "PIPA", "Virtual Asset User Protection Act"],
      },
      pharma: {
        score: 68,
        reasons: [
          "MFDS marketing authorization required; product registration in the Korean Drug Register mandatory.",
          "Clinical trials require MFDS IND submission; Korean-specific data may be required.",
        ],
        regulations: ["Pharmaceutical Affairs Act", "MFDS MA", "MFDS IND"],
      },
    },
  },

  AUS: {
    status: "review",
    score: 40,
    base_regulations: ["Australian Consumer Law (ACL)", "Privacy Act 1988"],
    base_reasons: [
      "FSANZ and TGA are the primary regulatory bodies; Australian/New Zealand standards (A/NZS) apply to many product categories.",
    ],
    categories: {
      food: {
        score: 38,
        reasons: [
          "FSANZ Food Standards Code is mandatory; nutrition information panel and allergen declaration required.",
          "Country-of-origin labeling mandated under Australian Consumer Law for most food products.",
          "Novel foods require pre-market FSANZ assessment and approval.",
        ],
        regulations: ["Australia New Zealand Food Standards Code", "FSANZ Standard 1.2.1–1.2.7", "ACL Country-of-Origin", "FSANZ Novel Food Standard 1.5.1"],
      },
      fintech: {
        score: 45,
        reasons: [
          "ASIC Australian Financial Services Licence (AFSL) required for financial products and services.",
          "AUSTRAC registration required for remittance dealers and digital currency exchange providers.",
          "AML/CTF Act administered by AUSTRAC; strong enforcement record.",
        ],
        regulations: ["Corporations Act 2001", "ASIC AFSL", "AML/CTF Act 2006", "AUSTRAC"],
      },
      pharma: {
        score: 60,
        reasons: [
          "TGA product registration required; listed (AUST L) or registered (AUST R) status required.",
          "Complementary medicines follow a separate TGA pathway.",
        ],
        regulations: ["Therapeutic Goods Act 1989", "TGA ARTG Registration", "Therapeutic Goods (Standard for Medicines) Order"],
      },
    },
  },
};

/**
 * Return a knowledge-based CountryVerdict for a market+category when the AI
 * batch assessment is unavailable. Falls back to generic market data when the
 * category does not match any curated entry.
 */
export function getMarketFallback(market: Market, category: string): CountryVerdict {
  const entry = KNOWLEDGE[market.iso3];
  if (!entry) {
    return {
      country: market.name,
      iso3: market.iso3,
      status: "review",
      score: 50,
      reasons: [
        "Regulatory requirements could not be assessed — manual review recommended before market entry.",
      ],
      key_regulations: [],
    };
  }

  const catKey = category.toLowerCase();
  const matchedKey = Object.keys(entry.categories).find((k) => catKey.includes(k));
  const cat = matchedKey ? entry.categories[matchedKey] : null;

  const status = cat?.status ?? entry.status;
  const score = cat?.score ?? entry.score;
  const reasons = cat ? cat.reasons : entry.base_reasons;
  const regulations = cat ? cat.regulations : entry.base_regulations;

  return {
    country: market.name,
    iso3: market.iso3,
    status,
    score,
    reasons: [
      ...reasons,
      "AI-assisted analysis unavailable — review based on curated regulatory framework.",
    ],
    key_regulations: regulations,
  };
}

/** Batch helper used by the fallback in compliance.ts */
export function getMarketFallbacks(markets: Market[], category: string): CountryVerdict[] {
  return markets.map((m) => getMarketFallback(m, category));
}
