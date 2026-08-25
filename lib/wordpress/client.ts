import {
  PLUGIN_NAMESPACE,
  TOKEN_HEADER,
  TOKEN_QUERY,
} from "@/lib/wordpress/plugin";

/**
 * HTTP client for the Snaily SEO Connector plugin.
 *
 * Every failure mode here is something the site owner can act on, so errors
 * carry a sentence they can read rather than a status code. The commonest by
 * far is "plugin not activated yet", which returns 404 and would otherwise
 * surface as an unexplained empty site.
 */

export type WpErrorKind =
  | "network"
  | "auth"
  | "plugin_missing"
  | "route_missing"
  | "operation";

export class WordPressError extends Error {
  constructor(
    message: string,
    /** True when re-pasting the token could fix it. */
    readonly tokenProblem = false,
    readonly kind: WpErrorKind = "operation",
  ) {
    super(message);
    this.name = "WordPressError";
  }
}

export function isConnectivityFailure(err: unknown): boolean {
  if (!(err instanceof WordPressError)) return false;
  return (
    err.kind === "network" ||
    err.kind === "plugin_missing" ||
    err.kind === "auth"
  );
}

export type WpSiteInfo = {
  name: string;
  url: string;
  wpVersion: string;
  pluginVersion: string;
  seoPlugin: string;
  posts: number;
  pages: number;
};

export type WpRemotePost = {
  id: number;
  type: string;
  status: string;
  title: string;
  slug: string;
  link: string;
  excerpt: string;
  content: string;
  wordCount: number;
  categories: string[];
  tags: string[];
  author: string;
  seoTitle: string;
  seoDescription: string;
  seoScore: number | null;
  focusKeyword: string;
  publishedAt: Date | null;
  modifiedAt: Date | null;
};

export type WpPostPage = {
  items: WpRemotePost[];
  total: number;
  pages: number;
};

const TIMEOUT_MS = 20_000;

function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function strList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
}

/**
 * WordPress reports GMT timestamps without a zone suffix ("2026-08-13 09:14:22"),
 * which `new Date()` would read as local time. The Z is added explicitly.
 */
function gmtDate(v: unknown): Date | null {
  const raw = str(v).trim();
  if (raw === "" || raw.startsWith("0000")) return null;
  const iso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const date = new Date(iso.endsWith("Z") ? iso : `${iso}Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

type CallInit = {
  method?: string;
  body?: unknown;
  query?: Record<string, string>;
  timeoutMs?: number;
  /** What a 404 means. Handshake uses "plugin"; extra 1.2 routes use "route". */
  missing?: "plugin" | "route";
};

/**
 * Builds the two URL shapes WordPress serves REST on.
 *
 * `/wp-json/...` needs pretty permalinks; `?rest_route=/...` always works and
 * is the documented fallback for sites that have them switched off or have
 * blocked the /wp-json/ path outright.
 */
function candidateUrls(
  siteUrl: string,
  path: string,
  query: Record<string, string>,
): URL[] {
  const origin = siteUrl.replace(/\/$/, "");
  const route = `/${PLUGIN_NAMESPACE}${path}`;

  const pretty = new URL(`${origin}/wp-json${route}`);
  const plain = new URL(origin);
  plain.searchParams.set("rest_route", route);

  for (const url of [pretty, plain]) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== "") url.searchParams.set(k, v);
    }
  }

  return [pretty, plain];
}

/** WordPress error envelope, when the site bothers to send one. */
type WpErrorBody = { code?: unknown; message?: unknown };

function parseWpError(body: string): { code: string; message: string } {
  try {
    const parsed = JSON.parse(body) as WpErrorBody;
    return { code: str(parsed.code), message: str(parsed.message) };
  } catch {
    return { code: "", message: "" };
  }
}

function describe(status: number, body: string): string {
  const wp = parseWpError(body);
  const detail = [wp.message, wp.code === "" ? "" : `(${wp.code})`]
    .filter(Boolean)
    .join(" ");
  return detail === "" ? `HTTP ${String(status)}` : detail;
}

async function attempt(
  url: URL,
  token: string,
  init: CallInit,
  tokenInQuery: boolean,
): Promise<Response> {
  const target = new URL(url);
  if (tokenInQuery) target.searchParams.set(TOKEN_QUERY, token);

  return fetch(target, {
    method: init.method ?? "GET",
    headers: {
      [TOKEN_HEADER]: token,
      Accept: "application/json",
      // Managed hosts routinely 403 requests with a default Node user agent.
      "User-Agent": "SnailySEO/1.0 (+connector)",
      ...(init.body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    signal: AbortSignal.timeout(init.timeoutMs ?? TIMEOUT_MS),
    // The plugin's responses are never cacheable — a stale post list would
    // silently show the wrong content after an edit.
    cache: "no-store",
  });
}

/**
 * One call to the plugin, tried every way that can legitimately differ.
 *
 * Real installs fail here for reasons that have nothing to do with the token:
 * the host strips `X-` headers, pretty permalinks are off, or a security plugin
 * has closed the REST API to logged-out requests. So each URL shape is tried
 * with the token in the header and then in the query string, and the site's own
 * error text is surfaced rather than a guess.
 */
async function call<T>(
  siteUrl: string,
  token: string,
  path: string,
  init: CallInit = {},
): Promise<T> {
  const urls = candidateUrls(siteUrl, path, init.query ?? {});

  let unreachable = 0;
  let lastRejection: string | null = null;
  let sawNotFound = false;
  let sawMissingRoute = false;
  const missing = init.missing ?? "plugin";

  for (const url of urls) {
    for (const tokenInQuery of [false, true]) {
      let res: Response;
      try {
        res = await attempt(url, token, init, tokenInQuery);
      } catch {
        unreachable += 1;
        break; // Network failure is a property of the URL, not the token.
      }

      if (res.ok) {
        try {
          return (await res.json()) as T;
        } catch {
          throw new WordPressError(
            "The site did not return valid data. A security plugin may be rewriting the REST API response.",
            false,
            "network",
          );
        }
      }

      const body = await res.text().catch(() => "");
      const wp = parseWpError(body);

      if (res.status === 404) {
        /*
         * Who decides what a 404 means: the caller, not the body.
         *
         * `rest_no_route` is what WordPress says both when a plugin is too old
         * to have registered a newer route and when no plugin registered the
         * namespace at all. Treating the body as the signal meant `/site`
         * 404ing was reported as "your connector is out of date" — and `/site`
         * has existed since the first version, so if it is missing there is no
         * connector installed. Someone mid-way through replacing the plugin
         * was told to download the update they had just downloaded.
         *
         * So only a route the caller has flagged as newer than some installs
         * counts as out of date. Everything else counts as absent.
         */
        if (missing === "route") {
          sawMissingRoute = true;
        } else {
          sawNotFound = true;
        }
        break; // Wrong URL shape — no point retrying the token here.
      }

      if (res.status === 401 || res.status === 403) {
        if (wp.code.startsWith("snaily_")) {
          throw new WordPressError(wp.message || describe(res.status, body));
        }
        lastRejection = describe(res.status, body);
        continue; // Try the other token transport.
      }

      throw new WordPressError(
        `The site returned ${String(res.status)}. ${describe(res.status, body)}`.trim(),
      );
    }
  }

  if (unreachable === urls.length) {
    throw new WordPressError(
      "Could not reach the site. Check the URL is right and the site is online.",
      false,
      "network",
    );
  }

  if (lastRejection !== null) {
    throw new WordPressError(
      `The site rejected the connection: ${lastRejection}. If the token is definitely right, a security plugin or your host is blocking the REST API — allow the /${PLUGIN_NAMESPACE}/ routes and try again.`,
      true,
      "auth",
    );
  }

  if (sawMissingRoute) {
    throw new WordPressError(
      "This site's connector is out of date. Download the latest plugin from Finish Setup, then try again.",
      false,
      "route_missing",
    );
  }

  if (sawNotFound) {
    throw new WordPressError(
      "The connector plugin was not found on that site. Install and activate it, then try again.",
      false,
      "plugin_missing",
    );
  }

  throw new WordPressError("The site did not accept the connection.", false, "network");
}

/** Handshake. Used by the wizard to check a pasted token before saving it. */
export async function verifyConnection(
  siteUrl: string,
  token: string,
): Promise<WpSiteInfo> {
  const raw = await call<{
    name?: unknown;
    url?: unknown;
    wp_version?: unknown;
    plugin_version?: unknown;
    seo_plugin?: unknown;
    counts?: { posts?: unknown; pages?: unknown };
  }>(siteUrl, token, "/site");

  return {
    name: str(raw.name),
    url: str(raw.url),
    wpVersion: str(raw.wp_version),
    pluginVersion: str(raw.plugin_version),
    seoPlugin: str(raw.seo_plugin) || "none",
    posts: num(raw.counts?.posts),
    pages: num(raw.counts?.pages),
  };
}

type RemoteRow = {
  id?: unknown;
  type?: unknown;
  status?: unknown;
  title?: unknown;
  slug?: unknown;
  link?: unknown;
  excerpt?: unknown;
  content?: unknown;
  word_count?: unknown;
  categories?: unknown;
  tags?: unknown;
  author?: unknown;
  published_at?: unknown;
  modified_at?: unknown;
  seo?: {
    title?: unknown;
    description?: unknown;
    focus_keyword?: unknown;
    score?: unknown;
  };
};

export async function fetchPosts(
  siteUrl: string,
  token: string,
  opts: { page?: number; perPage?: number; modifiedAfter?: Date | null } = {},
): Promise<WpPostPage> {
  const raw = await call<{ items?: unknown; total?: unknown; pages?: unknown }>(
    siteUrl,
    token,
    "/posts",
    {
      query: {
        page: String(opts.page ?? 1),
        per_page: String(opts.perPage ?? 50),
        modified_after: opts.modifiedAfter
          ? opts.modifiedAfter.toISOString().slice(0, 19).replace("T", " ")
          : "",
      },
    },
  );

  const rows = Array.isArray(raw.items) ? (raw.items as RemoteRow[]) : [];

  return {
    total: num(raw.total),
    pages: num(raw.pages),
    items: rows
      .filter((r) => typeof r.id === "number")
      .map((r) => ({
        id: r.id as number,
        type: str(r.type) || "post",
        status: str(r.status) || "publish",
        title: str(r.title),
        slug: str(r.slug),
        link: str(r.link),
        excerpt: str(r.excerpt),
        content: str(r.content),
        wordCount: num(r.word_count),
        categories: strList(r.categories),
        tags: strList(r.tags),
        author: str(r.author),
        seoTitle: str(r.seo?.title),
        seoDescription: str(r.seo?.description),
        seoScore:
          typeof r.seo?.score === "number" && Number.isFinite(r.seo.score)
            ? r.seo.score
            : null,
        focusKeyword: str(r.seo?.focus_keyword),
        publishedAt: gmtDate(r.published_at),
        modifiedAt: gmtDate(r.modified_at),
      })),
  };
}

/**
 * Sends an article to the site as a draft.
 *
 * The plugin hard-codes `post_status = draft` and refuses a post ID, so this
 * cannot publish or overwrite anything even if called wrongly.
 */
export type WpDraftPayload = {
  title: string;
  content: string;
  excerpt?: string;
  slug?: string;
  metaTitle?: string;
  metaDescription?: string;
  /** Yoast's focus keyphrase — the keyword the post is written for. */
  focusKeyword?: string;
  /**
   * The two switches on Yoast's Advanced tab.
   *
   * Omitted means "no opinion" and the connector leaves whatever is there;
   * the author asked for both to be off on every draft they publish by hand.
   */
  robots?: { noindex: boolean; nofollow: boolean };
  featuredMedia?: number;
  /** Category names. The first is written as Yoast's primary category. */
  categories?: string[];
  tags?: string[];
  /** WP Recipe Maker card, built from the author's untouched recipe. */
  recipe?: unknown;
};

function draftBody(draft: WpDraftPayload) {
  return {
    title: draft.title,
    content: draft.content,
    excerpt: draft.excerpt ?? "",
    slug: draft.slug ?? "",
    meta_title: draft.metaTitle ?? "",
    meta_description: draft.metaDescription ?? "",
    focus_keyword: draft.focusKeyword ?? "",
    // Absent rather than null: the connector reads "no key" as no opinion.
    ...(draft.robots === undefined ? {} : { robots: draft.robots }),
    featured_media: draft.featuredMedia ?? 0,
    categories: draft.categories ?? [],
    tags: draft.tags ?? [],
    ...(draft.recipe === undefined ? {} : { recipe: draft.recipe }),
  };
}

/**
 * What the connector says it did with the recipe card.
 *
 * `created: false` is a normal answer, not a failure — the site may have no WP
 * Recipe Maker, the article may have no recipe, or the connector may predate
 * this feature. The reason travels with it so the export can say which.
 */
export type WpRecipeReport = {
  created: boolean;
  recipeId: number;
  ingredientCount: number;
  instructionCount: number;
  nutritionAttached: boolean;
  /** Why nothing was created, or why nutrition did not attach. */
  reason: string;
};

function recipeReport(raw: unknown): WpRecipeReport {
  const r = (raw ?? {}) as Record<string, unknown>;
  const nutrition = (r.nutrition ?? {}) as Record<string, unknown>;

  return {
    created: r.created === true,
    recipeId: num(r.recipe_id),
    ingredientCount: num(r.ingredient_count),
    instructionCount: num(r.instruction_count),
    nutritionAttached: nutrition.attached === true,
    reason:
      str(r.reason) ||
      str(nutrition.reason) ||
      (r.created === true ? "" : "The connector did not report on the recipe card."),
  };
}

/** Yoast fields as the site stored them, not as we sent them. */
export type WpSeoReport = {
  title: string;
  description: string;
  focusKeyword: string;
  noindex: boolean | null;
  nofollow: boolean | null;
  primaryCategory: string;
};

function seoReport(raw: unknown): WpSeoReport | null {
  if (raw === null || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const flag = (v: unknown): boolean | null =>
    v === true ? true : v === false ? false : null;
  return {
    title: str(r.title),
    description: str(r.description),
    focusKeyword: str(r.focus_keyword),
    noindex: flag(r.noindex),
    nofollow: flag(r.nofollow),
    primaryCategory: str(r.primary_category),
  };
}

export async function createDraft(
  siteUrl: string,
  token: string,
  draft: WpDraftPayload,
): Promise<{ id: number; editLink: string; recipe: WpRecipeReport; seo: WpSeoReport | null }> {
  const raw = await call<{
    id?: unknown;
    edit_link?: unknown;
    recipe?: unknown;
    seo?: unknown;
  }>(siteUrl, token, "/draft", {
    method: "POST",
    body: draftBody(draft),
  });

  return {
    id: num(raw.id),
    editLink: str(raw.edit_link),
    recipe: recipeReport(raw.recipe),
    seo: seoReport(raw.seo),
  };
}

/**
 * Updates an existing WordPress *draft*. The plugin refuses published posts.
 */
export async function updateDraft(
  siteUrl: string,
  token: string,
  postId: number,
  draft: WpDraftPayload,
): Promise<{ id: number; editLink: string; recipe: WpRecipeReport; seo: WpSeoReport | null }> {
  const raw = await call<{
    id?: unknown;
    edit_link?: unknown;
    recipe?: unknown;
    seo?: unknown;
  }>(siteUrl, token, `/draft/${String(postId)}`, {
    method: "POST",
    missing: "route",
    body: draftBody(draft),
  });

  return {
    id: num(raw.id) || postId,
    editLink: str(raw.edit_link),
    recipe: recipeReport(raw.recipe),
    seo: seoReport(raw.seo),
  };
}

export type WpMediaItem = {
  id: number;
  title: string;
  alt: string;
  url: string;
  thumb: string;
  width: number;
  height: number;
};

export async function listMedia(
  siteUrl: string,
  token: string,
  page = 1,
): Promise<{ items: WpMediaItem[]; pages: number }> {
  const raw = await call<{ items?: unknown; pages?: unknown }>(
    siteUrl,
    token,
    "/media",
    { query: { page: String(page) }, missing: "route" },
  );
  const rows = Array.isArray(raw.items) ? raw.items : [];
  return {
    pages: num(raw.pages),
    items: rows
      .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
      .map((r) => ({
        id: num(r.id),
        title: str(r.title),
        alt: str(r.alt),
        url: str(r.url),
        thumb: str(r.thumb),
        width: num(r.width),
        height: num(r.height),
      }))
      .filter((r) => r.id > 0 && r.url !== ""),
  };
}

export async function uploadMedia(
  siteUrl: string,
  token: string,
  file: {
    filename: string;
    data: string;
    alt?: string;
    caption?: string;
  },
): Promise<{ id: number; url: string; width: number; height: number; alt: string }> {
  const raw = await call<{
    id?: unknown;
    url?: unknown;
    width?: unknown;
    height?: unknown;
    alt?: unknown;
  }>(siteUrl, token, "/media", {
    method: "POST",
    timeoutMs: 45_000,
    missing: "route",
    body: {
      filename: file.filename,
      data: file.data,
      alt: file.alt ?? "",
      caption: file.caption ?? "",
    },
  });

  return {
    id: num(raw.id),
    url: str(raw.url),
    width: num(raw.width),
    height: num(raw.height),
    alt: str(raw.alt),
  };
}

export type WpTaxonomyTerm = { id: number; name: string; slug: string };

export async function fetchTaxonomies(
  siteUrl: string,
  token: string,
): Promise<{ categories: WpTaxonomyTerm[]; tags: WpTaxonomyTerm[] }> {
  const raw = await call<{ categories?: unknown; tags?: unknown }>(
    siteUrl,
    token,
    "/taxonomies",
    { missing: "route" },
  );
  const shape = (v: unknown): WpTaxonomyTerm[] =>
    Array.isArray(v)
      ? v
          .filter((r): r is Record<string, unknown> => r !== null && typeof r === "object")
          .map((r) => ({
            id: num(r.id),
            name: str(r.name),
            slug: str(r.slug),
          }))
          .filter((r) => r.name !== "")
      : [];
  return { categories: shape(raw.categories), tags: shape(raw.tags) };
}
