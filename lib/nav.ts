import {
  Activity,
  FileSearch,
  FileText,
  Home,
  KeyRound,
  BarChart3,
  Gauge,
  Layers,
  Lightbulb,
  Link2,
  ListChecks,
  PenLine,
  Search,
  Sparkles,
  Target,
  TrendingUp,
  Users,
  type LucideIcon,
} from "lucide-react";

export type NavLeaf = {
  href: string;
  label: string;
  /** Optional chip in the dropdown, e.g. "new". */
  badge?: string;
  /** Tooltip explaining what the tool does. */
  note?: string;
};

export type NavSection = {
  label: string;
  icon: LucideIcon;
  /** A section with no `items` is a direct link. */
  href?: string;
  items?: NavLeaf[];
};

/**
 * Top navigation, mirroring KeySearch's structure so the workflow is familiar.
 *
 * Every tool is its own top-level route. The dropdowns group them for the eye
 * only — nothing nests underneath another tool, so opening Quick Difficulty is
 * a page in its own right rather than a tab inside Keyword Research.
 */
export const NAV: NavSection[] = [
  { label: "Dashboard", icon: Home, href: "/dashboard" },
  {
    label: "Keyword Research",
    icon: Search,
    items: [
      { href: "/keywords", label: "Keyword Research" },
      {
        href: "/deep-dive",
        label: "Deep Dive",
        badge: "new",
        note: "Hundreds of real autocomplete phrases from eight search boxes, sliced by intent.",
      },
      { href: "/difficulty", label: "Quick Difficulty" },
      { href: "/brainstorm", label: "Brainstorm" },
      { href: "/bulk-check", label: "Bulk Check" },
      { href: "/keyword-lists", label: "My Lists" },
    ],
  },
  {
    label: "Competitive Analysis",
    icon: Target,
    items: [
      { href: "/competitors", label: "Explorer" },
      { href: "/on-page", label: "On-Page SEO" },
      { href: "/backlinks", label: "Backlink Checker" },
      { href: "/organic-keywords", label: "Organic Keywords" },
      { href: "/audit", label: "Site Audit" },
      { href: "/competitor-gap", label: "Competitor Gap" },
      { href: "/url-metrics", label: "URL Metrics" },
    ],
  },
  { label: "Rank Tracker", icon: Activity, href: "/tracking" },
  { label: "Foresight", icon: TrendingUp, href: "/foresight" },
  { label: "Drafter", icon: PenLine, href: "/content-assistant" },
  { label: "Content Intelligence", icon: Lightbulb, href: "/content" },
  { label: "Content Library", icon: FileText, href: "/posts" },
  { label: "GEO Lab", icon: Sparkles, href: "/geo-lab" },
];

/** Secondary destinations, shown in the account menu rather than the main bar. */
export const ACCOUNT_NAV: NavLeaf[] = [
  { href: "/projects", label: "Projects" },
  { href: "/ingredient-links", label: "Ingredient Links" },
];

export const OWNER_NAV: NavLeaf[] = [
  { href: "/users", label: "Users" },
  { href: "/integrations", label: "Integrations" },
];

/** Flat list for the mobile drawer, which has no room for dropdowns. */
export const FLAT_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/dashboard", label: "Dashboard", icon: Home },
  { href: "/keywords", label: "Keyword Research", icon: Search },
  { href: "/difficulty", label: "Quick Difficulty", icon: Gauge },
  { href: "/brainstorm", label: "Brainstorm", icon: Sparkles },
  { href: "/bulk-check", label: "Bulk Check", icon: Layers },
  { href: "/keyword-lists", label: "My Lists", icon: ListChecks },
  { href: "/competitors", label: "Competitor Explorer", icon: Target },
  { href: "/on-page", label: "On-Page SEO", icon: FileSearch },
  { href: "/backlinks", label: "Backlink Checker", icon: Link2 },
  { href: "/organic-keywords", label: "Organic Keywords", icon: Search },
  { href: "/audit", label: "Site Audit", icon: Gauge },
  { href: "/competitor-gap", label: "Competitor Gap", icon: Target },
  { href: "/url-metrics", label: "URL Metrics", icon: BarChart3 },
  { href: "/tracking", label: "Rank Tracker", icon: Activity },
  { href: "/content-assistant", label: "Drafter", icon: PenLine },
  { href: "/content", label: "Content Intelligence", icon: Lightbulb },
  { href: "/posts", label: "Content Library", icon: FileText },
  { href: "/ingredient-links", label: "Ingredient Links", icon: Link2 },
  { href: "/geo-lab", label: "GEO Lab", icon: Sparkles },
  { href: "/projects", label: "Projects", icon: BarChart3 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/integrations", label: "Integrations", icon: KeyRound },
];
