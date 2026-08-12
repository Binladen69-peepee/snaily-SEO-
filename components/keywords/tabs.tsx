import { SubTabs, type Tab } from "@/components/sub-tabs";

const TABS: Tab[] = [
  { href: "/keywords", label: "Research" },
  { href: "/keywords/difficulty", label: "Quick Difficulty" },
  { href: "/keywords/brainstorm", label: "Brainstorm" },
  { href: "/keywords/bulk", label: "Bulk Analysis" },
  { href: "/keywords/lists", label: "Lists" },
];

export function KeywordTabs() {
  return <SubTabs tabs={TABS} label="Keyword tools" />;
}
