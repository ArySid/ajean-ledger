/**
 * Expense categories -> PCG accounts, and a deterministic keyword classifier.
 *
 * Account choices follow the PCG (ANC 2014-03 as amended by ANC 2022-06,
 * applicable from 2025). Debatable choices are documented in docs/ENGINE.md.
 */
import { tokens } from "../text";

export type VatDeductibility = "full" | "none" | "conditional";

export interface ExpenseCategory {
  id: string;
  /** PCG account number. For "it_equipment" this is the asset account (see FIXED_ASSET_*). */
  account: string;
  /** PCG account label (French). */
  account_label: string;
  description: string;
  kind: "goods" | "services";
  /** Folded keywords (no accents, lower case). Multi-word keywords are matched as phrases. */
  keywords: string[];
  /** VAT rates normally applicable in mainland France (first = default for self-assessment). */
  expected_vat_rates?: number[];
  /** Keywords that justify a different rate (e.g. alcohol at 20% in a restaurant). */
  rate_exceptions?: { keywords: string[]; rates: number[] }[];
  vat_deductibility: VatDeductibility;
  /** Legal basis id when deductibility is restricted. */
  deductibility_basis?: string;
  /** Tax-inspector risk tag used by the audit viewpoint. */
  tax_risk?: "receptions" | "gifts" | "non_deductible_vat" | "passenger_vehicle";
}

/** Low-value fixed-asset tolerance, per unit, excl. VAT (ADR-008, LB-ASSET-LOW-VALUE). */
export const FIXED_ASSET_THRESHOLD = 500;
export const FIXED_ASSET_ACCOUNT = { account: "2183", label: "Matériel de bureau et matériel informatique" };
export const LOW_VALUE_EQUIPMENT_ACCOUNT = { account: "6063", label: "Fournitures d'entretien et de petit équipement" };

export const EXPENSE_CATEGORIES: readonly ExpenseCategory[] = [
  {
    id: "office_supplies", account: "6064", account_label: "Fournitures administratives",
    description: "Office supplies (paper, pens, toner, binders)", kind: "goods",
    keywords: ["fournitures", "fourniture de bureau", "papier", "ramette", "ramettes", "stylo", "stylos", "crayon", "cartouche", "cartouches", "toner", "enveloppe", "enveloppes", "classeur", "classeurs", "agrafes", "agrafeuse", "post it", "cahier", "bloc notes", "chemises", "office supplies", "paper", "pen", "pens", "binder", "binders", "envelope", "envelopes", "stapler", "notebook", "ink"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "small_equipment", account: "6063", account_label: "Fournitures d'entretien et de petit équipement",
    description: "Small equipment and consumables below the fixed-asset threshold", kind: "goods",
    keywords: ["souris", "clavier", "cable", "cables", "adaptateur", "chargeur", "casque", "webcam", "hub", "multiprise", "lampe", "produits d entretien", "mouse", "keyboard", "adapter", "charger", "headset", "petit equipement", "outillage"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "it_equipment", account: FIXED_ASSET_ACCOUNT.account, account_label: FIXED_ASSET_ACCOUNT.label,
    description: "IT and office equipment (capitalised at or above EUR 500 excl. VAT per unit, else 6063)", kind: "goods",
    keywords: ["ordinateur", "ordinateurs", "portable", "laptop", "macbook", "pc", "serveur", "server", "imprimante", "printer", "ecran", "moniteur", "monitor", "tablette", "tablet", "smartphone", "photocopieur", "nas", "station de travail", "workstation"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "professional_fees", account: "6226", account_label: "Honoraires",
    description: "Professional fees (consulting, lawyers, accountants, auditors)", kind: "services",
    keywords: ["honoraires", "honoraire", "conseil", "consulting", "consultant", "advisory", "expertise comptable", "commissaire aux comptes", "audit", "avocat", "postulation", "retrocession", "legal fees", "mission de conseil", "accompagnement"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "legal_costs", account: "6227", account_label: "Frais d'actes et de contentieux",
    description: "Deeds, registry and litigation costs", kind: "services",
    keywords: ["frais d acte", "greffe", "huissier", "commissaire de justice", "contentieux", "kbis", "formalites", "formalite"],
    expected_vat_rates: [0.2, 0], vat_deductibility: "full",
  },
  {
    id: "training", account: "6228", account_label: "Divers — frais de formation externe",
    description: "External vocational training purchased from a training body", kind: "services",
    keywords: ["formation", "formations", "training", "cours", "certification", "e learning", "elearning", "stage de formation"],
    expected_vat_rates: [0.2, 0], vat_deductibility: "full",
  },
  {
    id: "seminars", account: "6185", account_label: "Frais de colloques, séminaires, conférences",
    description: "Conferences, seminars, trade events (attendance fees)", kind: "services",
    keywords: ["seminaire", "colloque", "conference", "congres", "summit", "salon professionnel"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "travel", account: "6251", account_label: "Voyages et déplacements",
    description: "Passenger transport (train, plane, taxi) and travel costs", kind: "services",
    keywords: ["train", "sncf", "tgv", "billet", "avion", "vol", "flight", "taxi", "vtc", "uber", "peage", "parking", "deplacement", "travel"],
    expected_vat_rates: [0.1, 0.2, 0], vat_deductibility: "none", deductibility_basis: "LB-VAT-DEDUCTION-EXCLUSIONS", tax_risk: "non_deductible_vat",
  },
  {
    id: "missions", account: "6256", account_label: "Missions",
    description: "Business trips: accommodation of staff and managers", kind: "services",
    keywords: ["hotel", "hebergement", "nuitee", "nuitees", "accommodation", "chambre", "frais de mission"],
    expected_vat_rates: [0.1], vat_deductibility: "none", deductibility_basis: "LB-VAT-DEDUCTION-EXCLUSIONS", tax_risk: "non_deductible_vat",
  },
  {
    id: "receptions", account: "6257", account_label: "Réceptions",
    description: "Business meals and receptions", kind: "services",
    keywords: ["restaurant", "repas", "dejeuner", "diner", "menu", "lunch", "dinner", "traiteur", "catering", "reception", "cafe", "cafes", "boissons", "plat du jour", "brasserie"],
    expected_vat_rates: [0.1],
    rate_exceptions: [{ keywords: ["vin", "vins", "wine", "biere", "beer", "champagne", "alcool", "aperitif", "cocktail", "spiritueux"], rates: [0.2] }],
    vat_deductibility: "full", tax_risk: "receptions",
  },
  {
    id: "gifts", account: "6234", account_label: "Cadeaux à la clientèle",
    description: "Business gifts to customers", kind: "goods",
    keywords: ["cadeau", "cadeaux", "gift", "gifts", "coffret", "corbeille"],
    expected_vat_rates: [0.2, 0.055], vat_deductibility: "conditional", deductibility_basis: "LB-VAT-GIFTS-THRESHOLD", tax_risk: "gifts",
  },
  {
    id: "rent_premises", account: "6132", account_label: "Locations immobilières",
    description: "Rent of premises, coworking, meeting rooms", kind: "services",
    keywords: ["loyer", "bail", "rent", "coworking", "location de bureau", "location de salle", "salle de reunion", "domiciliation"],
    expected_vat_rates: [0.2, 0], vat_deductibility: "full",
  },
  {
    id: "rent_equipment", account: "6135", account_label: "Locations mobilières",
    description: "Rental of equipment (excluding passenger vehicles)", kind: "services",
    keywords: ["location materiel", "location de materiel", "rental", "hire", "location mobiliere"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "vehicle_rental", account: "6135", account_label: "Locations mobilières — véhicule de tourisme",
    description: "Rental of passenger vehicles (VAT not deductible)", kind: "services",
    keywords: ["location vehicule", "location voiture", "location de vehicule", "location de voiture", "car rental", "vehicule de tourisme", "voiture de tourisme", "lld", "loa"],
    expected_vat_rates: [0.2], vat_deductibility: "none", deductibility_basis: "LB-VAT-DEDUCTION-EXCLUSIONS", tax_risk: "passenger_vehicle",
  },
  {
    id: "software_subscription", account: "651", account_label: "Redevances pour concessions, brevets, licences, marques, procédés, solutions informatiques",
    description: "Software licences and SaaS subscriptions", kind: "services",
    keywords: ["logiciel", "licence", "licences", "saas", "abonnement logiciel", "software", "subscription", "cloud", "hebergement web", "hosting"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "maintenance", account: "6156", account_label: "Maintenance",
    description: "Maintenance contracts", kind: "services",
    keywords: ["maintenance", "contrat de maintenance", "support technique", "infogerance"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "repairs", account: "615", account_label: "Entretien et réparation",
    description: "Repairs and upkeep", kind: "services",
    keywords: ["reparation", "repair", "entretien", "depannage", "nettoyage", "cleaning"],
    expected_vat_rates: [0.2, 0.1], vat_deductibility: "full",
  },
  {
    id: "documentation", account: "6181", account_label: "Documentation générale",
    description: "Documentation, books, press, legal databases", kind: "services",
    keywords: ["documentation", "base de donnees juridique", "revue", "magazine", "journal", "presse", "ouvrage", "ouvrages", "livre", "livres", "book", "books", "abonnement presse"],
    expected_vat_rates: [0.2, 0.055, 0.021], vat_deductibility: "full",
  },
  {
    id: "telecom", account: "626", account_label: "Frais postaux et de télécommunications",
    description: "Telephone, internet, postage", kind: "services",
    keywords: ["telephone", "mobile", "internet", "fibre", "forfait", "telecom", "affranchissement", "timbres", "la poste", "colissimo", "postage"],
    expected_vat_rates: [0.2, 0], vat_deductibility: "full",
  },
  {
    id: "advertising", account: "6231", account_label: "Annonces et insertions",
    description: "Advertising and ads", kind: "services",
    keywords: ["publicite", "annonce", "insertion", "advertising", "ads", "campagne", "sponsorise"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "printing", account: "6236", account_label: "Catalogues et imprimés",
    description: "Printed material (flyers, business cards, brochures)", kind: "goods",
    keywords: ["impression", "imprimes", "flyers", "flyer", "cartes de visite", "brochure", "brochures", "plaquette", "printing"],
    expected_vat_rates: [0.2], vat_deductibility: "full",
  },
  {
    id: "utilities", account: "6061", account_label: "Fournitures non stockables (eau, énergie, etc.)",
    description: "Energy and water", kind: "goods",
    keywords: ["electricite", "gaz", "eau", "energie", "electricity", "energy", "water"],
    expected_vat_rates: [0.2, 0.055], vat_deductibility: "full",
  },
  {
    id: "insurance", account: "616", account_label: "Primes d'assurances",
    description: "Insurance premiums (outside the scope of VAT)", kind: "services",
    keywords: ["assurance", "insurance", "prime d assurance", "multirisque", "responsabilite civile"],
    expected_vat_rates: [0], vat_deductibility: "full",
  },
  {
    id: "bank_fees", account: "627", account_label: "Services bancaires et assimilés",
    description: "Bank fees and commissions", kind: "services",
    keywords: ["frais bancaires", "commission bancaire", "bank fee", "bank fees", "tenue de compte", "agios"],
    expected_vat_rates: [0.2, 0], vat_deductibility: "full",
  },
];

export const CATEGORY_IDS: readonly string[] = EXPENSE_CATEGORIES.map((c) => c.id);
const BY_ID = new Map(EXPENSE_CATEGORIES.map((c) => [c.id, c]));

export function getCategory(id: string): ExpenseCategory | undefined {
  return BY_ID.get(id);
}

/** Below this confidence a classification is "uncertain" (LLM fallback or human review). */
export const CLASSIFICATION_THRESHOLD = 0.75;

export interface Classification {
  category: ExpenseCategory;
  confidence: number;
  method: "hint" | "keywords" | "llm" | "default";
  matched_keywords: string[];
}

function matchKeyword(toks: string[], joined: string, kw: string): boolean {
  if (kw.includes(" ")) return joined.includes(` ${kw} `);
  return toks.includes(kw);
}

/**
 * Deterministic classification of a line description.
 * - category_hint equal to a known category id -> confidence 0.95
 * - a single category matched -> 0.9 (more keywords -> stays 0.9)
 * - several categories matched: the best one wins if it has strictly more keyword hits (0.8), else 0.55 (uncertain)
 * - nothing matched -> FALLBACK_CATEGORY (628) with confidence 0.3, so the caller flags it
 */
export function classifyLine(description: string, hint?: string): Classification {
  if (hint) {
    const h = BY_ID.get(hint.trim().toLowerCase());
    if (h) return { category: h, confidence: 0.95, method: "hint", matched_keywords: [] };
  }
  const toks = tokens(description);
  const joined = ` ${toks.join(" ")} `;
  const scores: { cat: ExpenseCategory; hits: string[] }[] = [];
  for (const cat of EXPENSE_CATEGORIES) {
    const hits = cat.keywords.filter((kw) => matchKeyword(toks, joined, kw));
    if (hits.length > 0) scores.push({ cat, hits });
  }
  if (scores.length === 0) {
    return { category: FALLBACK_CATEGORY, confidence: 0.3, method: "default", matched_keywords: [] };
  }
  // Phrase keywords weigh 2, single words 1.
  const weight = (hits: string[]) => hits.reduce((a, k) => a + (k.includes(" ") ? 2 : 1), 0);
  scores.sort((a, b) => weight(b.hits) - weight(a.hits) || EXPENSE_CATEGORIES.indexOf(a.cat) - EXPENSE_CATEGORIES.indexOf(b.cat));
  const best = scores[0];
  if (scores.length === 1) return { category: best.cat, confidence: 0.9, method: "keywords", matched_keywords: best.hits };
  const second = scores[1];
  const confidence = weight(best.hits) > weight(second.hits) ? 0.8 : 0.55;
  return { category: best.cat, confidence, method: "keywords", matched_keywords: best.hits };
}

/** Category used when nothing matched: a neutral "other external services" bucket that always triggers review. */
export const FALLBACK_CATEGORY: ExpenseCategory = {
  id: "other_external_services", account: "628", account_label: "Divers",
  description: "Unclassified external service — to be reviewed", kind: "services",
  keywords: [], vat_deductibility: "full",
};
