import {
  UtensilsCrossed,
  Landmark,
  Pill,
  HardHat,
  Users,
  Boxes,
  type LucideIcon,
} from "lucide-react";

export interface Industry {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
}

export const INDUSTRIES: Industry[] = [
  {
    id: "food",
    label: "Food & Beverage",
    description: "CPG, supplements, restaurants",
    icon: UtensilsCrossed,
  },
  {
    id: "fintech",
    label: "Fintech & Lending",
    description: "Payments, BNPL, crypto, lending",
    icon: Landmark,
  },
  {
    id: "pharma",
    label: "Pharma & Biotech",
    description: "Drugs, devices, clinical",
    icon: Pill,
  },
  {
    id: "construction",
    label: "Construction & Real Estate",
    description: "Building, development, property",
    icon: HardHat,
  },
  {
    id: "hr",
    label: "HR & Employment",
    description: "Staffing, payroll, multi-state teams",
    icon: Users,
  },
  {
    id: "other",
    label: "Other",
    description: "General consumer & commercial",
    icon: Boxes,
  },
];
