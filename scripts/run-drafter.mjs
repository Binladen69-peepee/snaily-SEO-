/**
 * Generate one article end to end and time it, against a running server.
 *
 * test-draft-live.mjs asserts behaviour; this measures cost. It creates the
 * article, presses the button once, drives the job the way the browser does,
 * and prints the per-stage breakdown when it finishes.
 *
 *   npm run dev
 *   node --env-file=.env.local scripts/run-drafter.mjs "Vegan Thai Red Curry"
 */
import { SignJWT } from "jose";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:3000";
const TITLE = process.argv[2] ?? "Vegan Thai Red Curry";
const PROJECT = "cmsj6ec0g0001jw045lu5uqjo";

const RECIPE = `Ingredients
2 tablespoons coconut oil
1 medium yellow onion, sliced thin
4 cloves garlic, minced
1 tablespoon fresh ginger, grated
3 tablespoons Thai red curry paste
14 oz. extra firm tofu, cubed
1 red bell pepper, sliced
1 cup green beans, trimmed and halved
1 can (13.5 oz) full fat coconut milk
1 cup vegetable broth
2 tablespoons soy sauce
1 tablespoon maple syrup
1 tablespoon lime juice
1 teaspoon salt, or to taste
Thai basil leaves, to garnish
Steamed jasmine rice, to serve

Instructions
1. Heat the coconut oil in a large pot over medium heat. Add the onion and cook for 5 minutes until softened.
2. Add the garlic and ginger and cook for 1 minute until fragrant.
3. Stir in the red curry paste and cook for 2 minutes so it loses its raw edge.
4. Add the tofu, bell pepper and green beans, stirring to coat everything in the paste.
5. Pour in the coconut milk and vegetable broth. Bring to a simmer.
6. Simmer uncovered for 15 minutes, until the vegetables are tender and the sauce has thickened slightly.
7. Stir in the soy sauce, maple syrup, lime juice and salt.
8. Garnish with Thai basil and serve over steamed jasmine rice.`;

const prisma = new PrismaClient();
const project = await prisma.project.findUnique({
  where: { id: PROJECT },
  select: { userId: true, name: true },
});

const token = await new SignJWT({ userId: project.userId })
  .setProtectedHeader({ alg: "HS256" })
  .setIssuedAt()
  .setExpirationTime("6h")
  .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
const headers = { cookie: `session=${token}`, "content-type": "application/json" };

const article = await prisma.article.create({
  data: {
    userId: project.userId,
    projectId: PROJECT,
    title: TITLE,
    keyword: TITLE.toLowerCase(),
    mode: "drafter",
    recipe: RECIPE,
    content: "",
    country: "us",
  },
  select: { id: true },
});
await prisma.$disconnect();

console.log(`article ${article.id}  "${TITLE}"`);

const startRes = await fetch(`${BASE}/api/articles/${article.id}/draft-job`, {
  method: "POST",
  headers,
  body: JSON.stringify({}),
});
if (!startRes.ok) {
  console.log(`could not start: ${String(startRes.status)} ${(await startRes.text()).slice(0, 300)}`);
  process.exit(1);
}
const jobId = (await startRes.json()).job?.id;
console.log(`job     ${jobId}\n`);

const t0 = Date.now();
let last = "";

for (;;) {
  if (Date.now() - t0 > 45 * 60 * 1000) {
    console.log("gave up after 45 minutes");
    break;
  }

  await fetch(`${BASE}/api/draft-jobs/${jobId}/run`, { method: "POST", headers }).catch(
    () => undefined,
  );

  const res = await fetch(`${BASE}/api/draft-jobs/${jobId}`, { headers });
  if (!res.ok) {
    await new Promise((r) => setTimeout(r, 4000));
    continue;
  }
  const j = (await res.json()).job ?? {};
  const line = `${String(j.done ?? "?")}/${String(j.total ?? "?")} ${String(j.stage ?? "")}`;
  if (line !== last) {
    console.log(`[${String(Math.round((Date.now() - t0) / 1000)).padStart(4)}s] ${line}`);
    last = line;
  }

  if (["done", "complete", "completed"].includes(String(j.status))) {
    console.log(`\nfinished in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    break;
  }
  if (["failed", "error"].includes(String(j.status))) {
    console.log(`\nFAILED after ${((Date.now() - t0) / 1000).toFixed(1)}s: ${String(j.errorCode ?? "")}`);
    break;
  }

  await new Promise((r) => setTimeout(r, 4000));
}

console.log(`\narticleId: ${article.id}`);
console.log(`jobId    : ${jobId}`);
