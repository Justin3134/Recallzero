export interface USState {
  name: string;
  /** USPS 2-letter code. */
  code: string;
  /** What this state is notable for, regulation-wise. */
  focus: string;
}

/**
 * Curated set of high-regulation US states surfaced as a drill-down under the
 * United States. These are the states whose state-level rules most often add
 * obligations beyond federal requirements for consumer products.
 */
export const US_STATES: USState[] = [
  { name: "California", code: "CA", focus: "Prop 65 warnings, strict additive & labeling rules" },
  { name: "New York", code: "NY", focus: "Aggressive consumer-protection & ingredient enforcement" },
  { name: "Texas", code: "TX", focus: "State health & labeling registration requirements" },
  { name: "Florida", code: "FL", focus: "Food permit & labeling enforcement" },
  { name: "Washington", code: "WA", focus: "Toxics & restricted-substance reporting" },
  { name: "Illinois", code: "IL", focus: "Food handling & consumer fraud statutes" },
  { name: "Massachusetts", code: "MA", focus: "Consumer protection (Chapter 93A) & labeling" },
  { name: "New Jersey", code: "NJ", focus: "Consumer Fraud Act & ingredient disclosure" },
  { name: "Pennsylvania", code: "PA", focus: "State food code & registration" },
  { name: "Colorado", code: "CO", focus: "Labeling & emerging additive restrictions" },
];

/** Compact string of states for prompting the model. */
export const STATES_PROMPT = US_STATES.map((s) => `${s.name} (${s.code}) — ${s.focus}`).join("; ");
