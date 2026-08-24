const { PrismaClient } = require("@prisma/client");
const p = new PrismaClient();

p.wpPost
  .findMany({
    where: { status: "publish", type: "post" },
    orderBy: { publishedAt: "desc" },
    take: 6,
    select: {
      title: true,
      slug: true,
      content: true,
      categories: true,
    },
  })
  .then((rows) => {
    for (const r of rows) {
      const c = r.content;
      const blocks = [...c.matchAll(/<!-- wp:([a-z0-9/-]+)/g)].map((m) => m[1]);
      const counts = {};
      for (const b of blocks) counts[b] = (counts[b] || 0) + 1;
      const headings = [...c.matchAll(/<h([1-3])[^>]*>([\s\S]{0,120}?)<\/h\1>/gi)]
        .slice(0, 14)
        .map((m) =>
          `H${m[1]}: ${m[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()}`,
        );
      console.log("\n===", r.title);
      console.log("slug", r.slug);
      console.log("cats", r.categories.slice(0, 8).join(", "));
      console.log("blocks", JSON.stringify(counts));
      console.log("headings", headings.join(" | "));
      console.log("gutenberg", c.includes("<!-- wp:"));
      console.log("sample", c.slice(0, 450).replace(/\n/g, " "));
    }
    return p.$disconnect();
  })
  .catch((err) => {
    console.error(err);
    return p.$disconnect();
  });
