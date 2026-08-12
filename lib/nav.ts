import {
  Activity,
  FileSearch,
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

/** Top navigation, mirroring KeySearch's structure so the workflow is familiar. */
export const NAV: NavSection[] = [
  {
    label: "Keyword Research",
    icon: Search,
    items: [
      { href: "/keywords", label: "Keyword Research" },
      { href: "/keywords/difficulty", label: "Quick Difficulty" },
      { href: "/keywords/brainstorm", label: "Brainstorm" },
      { href: "/keywords/bulk", label: "Bulk Check" },
      { href: "/keywords/lists", label: "My Lists" },
    ],
  },
  {
    label: "Competitive Analysis",
    icon: Target,
    items: [
      { href: "/competitors", label: "Explorer" },
      { href: "/on-page", label: "On-Page SEO" },
      { href: "/competitors/backlinks", label: "Backlink Checker" },
      { href: "/competitors/organic", label: "Organic Keywords" },
      { href: "/audit", label: "Site Audit" },
      { href: "/competitors/gap", label: "Competitor Gap" },
      { href: "/competitors/url-metrics", label: "URL Metrics" },
    ],
  },
  { label: "Rank Tracker", icon: Activity, href: "/tracking" },
  { label: "Content Assistant", icon: PenLine, href: "/content-assistant" },
  { label: "Content Intelligence", icon: Lightbulb, href: "/content" },
  { label: "GEO Lab", icon: Sparkles, href: "/geo-lab" },
];

/** Secondary destinations, shown in the account menu rather than the main bar. */
export const ACCOUNT_NAV: NavLeaf[] = [
  { href: "/projects", label: "Projects" },
];

export const OWNER_NAV: NavLeaf[] = [
  { href: "/users", label: "Users" },
  { href: "/integrations", label: "Integrations" },
];

/** Flat list for the mobile drawer, which has no room for dropdowns. */
export const FLAT_NAV: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/keywords", label: "Keyword Research", icon: Search },
  { href: "/keywords/difficulty", label: "Quick Difficulty", icon: Gauge },
  { href: "/keywords/brainstorm", label: "Brainstorm", icon: Sparkles },
  { href: "/keywords/bulk", label: "Bulk Check", icon: Layers },
  { href: "/keywords/lists", label: "My Lists", icon: ListChecks },
  { href: "/competitors", label: "Competitor Explorer", icon: Target },
  { href: "/on-page", label: "On-Page SEO", icon: FileSearch },
  { href: "/competitors/backlinks", label: "Backlink Checker", icon: Link2 },
  { href: "/competitors/organic", label: "Organic Keywords", icon: Search },
  { href: "/audit", label: "Site Audit", icon: Gauge },
  { href: "/competitors/gap", label: "Competitor Gap", icon: Target },
  { href: "/competitors/url-metrics", label: "URL Metrics", icon: BarChart3 },
  { href: "/tracking", label: "Rank Tracker", icon: Activity },
  { href: "/content-assistant", label: "Content Assistant", icon: PenLine },
  { href: "/content", label: "Content Intelligence", icon: Lightbulb },
  { href: "/geo-lab", label: "GEO Lab", icon: Sparkles },
  { href: "/projects", label: "Projects", icon: BarChart3 },
  { href: "/users", label: "Users", icon: Users },
  { href: "/integrations", label: "Integrations", icon: KeyRound },
];
