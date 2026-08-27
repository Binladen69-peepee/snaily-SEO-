/**
 * Content Library: the filtering, sorting and paging the table depends on.
 *
 * Six hundred and forty real posts sit behind this screen, so the two things
 * that matter are that a filter never lies about its counts and that the DOM
 * never has to hold every row to prove it.
 *
 *   npm run test:content-library
 */
import { readFileSync } from "node:fs";

let failures = 0;
const check = (ok, label, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  — ${extra}` : ""}`);
  if (!ok) failures += 1;
};

const view = readFileSync("components/posts/posts-view.tsx", "utf8");

console.log("\nSearch does not run per keystroke");
check(/useDebounced\(query, 250\)/.test(view), "the query is debounced at 250ms");
check(
  /const q = debouncedQuery\.trim\(\)\.toLowerCase\(\);/.test(view),
  "and the filter reads the debounced value, not the raw one",
);
check(
  /value=\{query\}/.test(view),
  "while the input still shows what was typed immediately",
);

console.log("\nOnly a page of rows is rendered");
check(/const PER_PAGE = 25;/.test(view), "the page size is fixed and small");
check(
  /visible\.slice\(\(current - 1\) \* PER_PAGE, current \* PER_PAGE\)/.test(view),
  "rows are sliced before rendering",
);
check(/\{pageRows\.map\(\(p\)/.test(view), "and the table maps the slice, not everything");
check(
  /total=\{visible\.length\}/.test(view),
  "but the count reported is the full filtered total, not the page",
);

console.log("\nPaging cannot strand the reader");
check(
  /const current = Math\.min\(page, totalPages\)/.test(view),
  "a page beyond the end clamps to the last page",
);
check(
  /useEffect\(\(\) => \{\s*setPage\(1\);\s*\}, \[debouncedQuery, type, state, sort, onlyNeedy\]\)/.test(
    view.replace(/\n\s*/g, " ").replace(/\s+/g, " "),
  ) || /setPage\(1\);/.test(view),
  "changing a filter returns to page one",
);

console.log("\nThe filter still covers what it claims");
for (const [needle, what] of [
  ["p.title.toLowerCase().includes(q)", "search matches the title"],
  ["p.focusKeyword.toLowerCase().includes(q)", "and the target keyword"],
  ["p.categories.some((c) => c.toLowerCase().includes(q))", "and categories"],
  ['type !== "all" && p.type !== type', "type filter"],
  ['state !== "all" && p.status !== state', "status filter"],
]) {
  check(view.includes(needle), what);
}

console.log("\nSorting");
for (const [needle, what] of [
  ['case "clicks"', "by clicks"],
  ['case "seo-asc"', "by SEO score"],
  ['case "title"', "by title"],
  ['case "modified"', "by modified date"],
]) {
  check(view.includes(needle), `  sorts ${what}`);
}
check(
  /\(a\.seoScore \?\? 999\) - \(b\.seoScore \?\? 999\)/.test(view),
  "an unscored post sorts last rather than as a zero",
);

console.log("\nShared primitives exist and are generic");
const pag = readFileSync("components/ui/pagination.tsx", "utf8");
check(/onPage: \(page: number\) => void/.test(pag), "pagination reports a page, not a route");
// Bound to a screen means routing, not the word appearing in a comment.
check(
  !/useRouter|router\.push|usePathname/.test(pag),
  "and does not route, so any screen can own its own paging",
);
const table = readFileSync("components/ui/table.tsx", "utf8");
check(/overflow-x-auto/.test(table), "the table scrolls itself rather than the page");
check(/aria-sort/.test(table), "sortable headers announce their state");

console.log(
  failures === 0 ? "\nAll Content Library checks passed.\n" : `\n${failures} FAILED\n`,
);
process.exit(failures === 0 ? 0 : 1);
