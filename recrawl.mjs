/* One fresh crawl with the corrected image classifier, so stored data matches
 * what the current code sees. Run: node --env-file=.env.local recrawl.mjs */
import { compile } from "./scripts/compile.mjs";
import { PrismaClient } from "@prisma/client";

/* The crawl writes 100 pages plus progress updates; the default local pool of
 * 9 is not enough and times out. Production runs this behind Supabase's pooler. */
const url = new URL(process.env.DATABASE_URL);
url.searchParams.set("connection_limit", "25");
url.searchParams.set("pool_timeout", "60");
const prisma = new PrismaClient({ datasources: { db: { url: url.toString() } } });
const project = await prisma.project.findUnique({ where: { id: "cmsj6ec0g0001jw045lu5uqjo" } });
if (!project) { console.log("no project"); process.exit(1); }

const audit = await prisma.audit.create({
  data: { userId: project.userId, projectId: project.id, startUrl: project.url, status: "running", pagesCrawled: 0, pagesFound: 0 },
});
console.log(`audit ${audit.id} for ${project.url}`);

const built = compile(["lib/audit/run.ts"], { prefix: ".recrawl-" });
try {
  const { runAudit } = await built.load("lib/audit/run.ts");
  await runAudit(audit.id, project.id, project.url, 100);
} finally { built.cleanup(); }

const done = await prisma.audit.findUnique({ where: { id: audit.id } });
const rows = await prisma.auditPage.findMany({ where: { auditId: audit.id }, select: { url: true, issueCodes: true, imagesMissingAlt: true, imagesMissingAltSrc: true } });
const alt = rows.filter((r) => r.issueCodes.includes("missing_alt"));
console.log(`status=${done.status} pages=${rows.length} missing_alt pages=${alt.length}`);
for (const r of alt.slice(0, 10)) console.log(`   ${r.url}  count=${r.imagesMissingAlt} srcs=${r.imagesMissingAltSrc.length}`);
await prisma.$disconnect();
