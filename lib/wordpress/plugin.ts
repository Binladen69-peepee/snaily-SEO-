import { buildZip } from "@/lib/wordpress/zip";

/**
 * The WordPress connector plugin, served as a downloadable .zip.
 *
 * The site owner installs this, copies the token it generates out of their own
 * admin, and pastes it into the setup wizard. No WordPress password is ever
 * shared, and revoking us is a plugin deactivation.
 *
 * The plugin is read-only with two writes: it can create *drafts*, and it can
 * update a post that is still a draft (including uploading media for that
 * draft). It cannot publish, and it cannot modify a published post.
 *
 * NOTE: this is a template literal, so every backslash the PHP needs must be
 * written doubled. `npm run typecheck` will not catch a mangled regex — the
 * plugin route has a self-check that the emitted source still parses.
 */

export const PLUGIN_VERSION = "1.6.0";
export const PLUGIN_SLUG = "snaily-seo-connector";

/** REST namespace the app talks to. Must match `SNAILY_SEO_NS` below. */
export const PLUGIN_NAMESPACE = "snailyseo/v1";

/** Header carrying the connector token on every request. */
export const TOKEN_HEADER = "x-snaily-token";

/**
 * Query-string fallback for the token.
 *
 * Managed WordPress hosts and security plugins routinely strip unrecognised
 * `X-` headers, which would make every request look unauthenticated. The app
 * retries with the token here when the header route comes back rejected.
 */
export const TOKEN_QUERY = "snaily_token";

const PHP = `<?php
/**
 * Plugin Name: Snaily SEO Connector
 * Description: Connects this site to Snaily SEO so it can read your content and deliver drafts. Read-only apart from creating and updating drafts (including images) — it can never publish or edit a live post.
 * Version: ${PLUGIN_VERSION}
 * Author: Snaily SEO
 * License: GPLv2 or later
 */

if (!defined('ABSPATH')) {
    exit;
}

define('SNAILY_SEO_VERSION', '${PLUGIN_VERSION}');
define('SNAILY_SEO_OPTION', 'snaily_seo_token');
define('SNAILY_SEO_AUTHOR_OPTION', 'snaily_seo_author');
define('SNAILY_SEO_NS', '${PLUGIN_NAMESPACE}');

/**
 * Post meta binding a WordPress draft to the Drafter article it came from.
 *
 * This is what makes an export idempotent from the site's side. The app tries
 * hard not to ask for a second draft of the same article, but it cannot see
 * everything: a request that timed out after WordPress had already inserted
 * the post looks identical, from the app, to one that never arrived. So the
 * site remembers which article each draft belongs to, and a create for an
 * article it already holds a draft for updates that draft instead of stacking
 * another one beside it.
 */
define('SNAILY_SEO_ARTICLE_META', '_snaily_article');

/* ---------------------------------------------------------------------------
 * Token
 * ------------------------------------------------------------------------ */

/**
 * The stored token, or '' when one has not been generated yet.
 *
 * Reading must never mint a token as a side effect. An earlier version did,
 * and if the write failed to persist — a read-only DB, a misbehaving object
 * cache — every request minted a *different* token, so the settings screen and
 * the API disagreed on every single call and no amount of re-copying could fix
 * it. Generation now happens only on activation or on explicit request.
 */
function snaily_seo_token() {
    $token = get_option(SNAILY_SEO_OPTION);
    return is_string($token) ? $token : '';
}

/**
 * Who a draft is attributed to.
 *
 * Drafts arrive over a token, not a WordPress login, so wp_insert_post had no
 * author to use and fell back to whatever user context the request ran in —
 * which is how posts sent from the app ended up bylined to whoever happened to
 * be uploading rather than to the site's own author.
 *
 * The site decides this, not the app: whoever is configured here gets the
 * byline no matter which app account sent the draft. Default is the first
 * administrator, which on a single-author site is the right answer already.
 */
function snaily_seo_author_id() {
    $stored = (int) get_option(SNAILY_SEO_AUTHOR_OPTION, 0);
    if ($stored > 0 && get_userdata($stored)) {
        return $stored;
    }

    $admins = get_users(array(
        'role'    => 'administrator',
        'orderby' => 'ID',
        'order'   => 'ASC',
        'number'  => 1,
        'fields'  => 'ID',
    ));

    return empty($admins) ? 0 : (int) $admins[0];
}

function snaily_seo_generate_token() {
    $token = wp_generate_password(48, false, false);
    update_option(SNAILY_SEO_OPTION, $token, false);
    return $token;
}

function snaily_seo_activate() {
    if (snaily_seo_token() === '') {
        snaily_seo_generate_token();
    }
}

register_activation_hook(__FILE__, 'snaily_seo_activate');

/* ---------------------------------------------------------------------------
 * Auth
 * ------------------------------------------------------------------------ */

/**
 * The token as sent, from either transport.
 *
 * Read straight from the superglobals rather than via WP_REST_Request, because
 * this also runs on the rest_authentication_errors filter — which fires before
 * a request object exists.
 */
function snaily_seo_sent_token() {
    if (isset($_SERVER['HTTP_X_SNAILY_TOKEN'])) {
        $header = trim((string) $_SERVER['HTTP_X_SNAILY_TOKEN']);
        if ($header !== '') {
            return $header;
        }
    }
    // Fallback for hosts that strip unrecognised X- headers.
    if (isset($_GET['${TOKEN_QUERY}'])) {
        return trim((string) wp_unslash($_GET['${TOKEN_QUERY}']));
    }
    return '';
}

/** hash_equals keeps the comparison constant-time. */
function snaily_seo_token_ok() {
    $stored = snaily_seo_token();
    $sent = snaily_seo_sent_token();
    return $stored !== '' && $sent !== '' && hash_equals($stored, $sent);
}

/** True when the current request targets one of this plugin's routes. */
function snaily_seo_is_our_route() {
    $uri = isset($_SERVER['REQUEST_URI']) ? (string) $_SERVER['REQUEST_URI'] : '';
    return strpos($uri, SNAILY_SEO_NS) !== false;
}

/**
 * Re-opens the REST API for this plugin's routes only.
 *
 * Many security plugins and managed hosts reject every logged-out REST request
 * through this filter. It runs *before* permission_callback, so without this
 * our routes would be refused before the token was ever looked at — which is
 * exactly what a locked-down site does to a connector like this.
 *
 * The bypass is deliberately narrow: our namespace, and only with a valid
 * token. Every other route keeps whatever protection the site already had.
 */
add_filter('rest_authentication_errors', 'snaily_seo_allow_rest', 99);

function snaily_seo_allow_rest($result) {
    if (!snaily_seo_is_our_route()) {
        return $result;
    }
    if (snaily_seo_token_ok()) {
        return true;
    }
    return $result;
}

/** Per-route gate. Distinct codes so the app can say what actually happened. */
function snaily_seo_authorise(WP_REST_Request $request) {
    $sent = $request->get_header('${TOKEN_HEADER}');
    if (!is_string($sent) || $sent === '') {
        $sent = snaily_seo_sent_token();
    }

    if ($sent === '') {
        return new WP_Error(
            'snaily_no_token',
            'No connector token reached the site — the host may be stripping the header.',
            array('status' => 401)
        );
    }

    $stored = snaily_seo_token();

    if ($stored === '') {
        return new WP_Error(
            'snaily_not_initialised',
            'This site has no connector token stored. Open Settings > Snaily SEO and generate one.',
            array('status' => 403)
        );
    }

    if (!hash_equals($stored, $sent)) {
        return new WP_Error(
            'snaily_bad_token',
            'The connector token does not match this site.',
            array('status' => 403)
        );
    }

    return true;
}

/* ---------------------------------------------------------------------------
 * Routes
 * ------------------------------------------------------------------------ */

add_action('rest_api_init', 'snaily_seo_routes');

function snaily_seo_routes() {
    register_rest_route(SNAILY_SEO_NS, '/site', array(
        'methods'             => 'GET',
        'callback'            => 'snaily_seo_site',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/posts', array(
        'methods'             => 'GET',
        'callback'            => 'snaily_seo_posts',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/draft', array(
        'methods'             => 'POST',
        'callback'            => 'snaily_seo_draft',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/draft/(?P<id>[0-9]+)', array(
        'methods'             => 'POST',
        'callback'            => 'snaily_seo_draft_update',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/media', array(
        'methods'             => 'GET',
        'callback'            => 'snaily_seo_media_list',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/media', array(
        'methods'             => 'POST',
        'callback'            => 'snaily_seo_media_upload',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/media/(?P<id>[0-9]+)/alt', array(
        'methods'             => 'POST',
        'callback'            => 'snaily_seo_media_set_alt',
        'permission_callback' => 'snaily_seo_authorise',
    ));

    register_rest_route(SNAILY_SEO_NS, '/taxonomies', array(
        'methods'             => 'GET',
        'callback'            => 'snaily_seo_taxonomies',
        'permission_callback' => 'snaily_seo_authorise',
    ));
}

/** Which SEO plugin is active, so the app knows which meta keys to expect. */
function snaily_seo_detect_seo_plugin() {
    if (defined('WPSEO_VERSION')) {
        return 'yoast';
    }
    if (class_exists('RankMath')) {
        return 'rankmath';
    }
    if (defined('AIOSEO_VERSION') || defined('AIOSEOP_VERSION')) {
        return 'aioseo';
    }
    return 'none';
}

/** Handshake payload. The wizard calls this to verify a pasted token. */
function snaily_seo_site() {
    $posts = wp_count_posts('post');
    $pages = wp_count_posts('page');

    return array(
        'name'           => get_bloginfo('name'),
        'url'            => home_url(),
        'wp_version'     => get_bloginfo('version'),
        'plugin_version' => SNAILY_SEO_VERSION,
        // What this install can actually do, so the app never sends a payload
        // the site will silently drop. An older connector answers without this
        // key at all, which is exactly the signal the app needs.
        'supports'       => array(
            'focus_keyword'    => true,
            'robots'           => true,
            'primary_category' => true,
            'recipe'           => snaily_seo_wprm_active(),
            'nutrition'        => snaily_seo_wprm_can_calculate_nutrition(),
        ),
        'seo_plugin'     => snaily_seo_detect_seo_plugin(),
        'counts'         => array(
            'posts' => isset($posts->publish) ? (int) $posts->publish : 0,
            'pages' => isset($pages->publish) ? (int) $pages->publish : 0,
        ),
    );
}

/** SEO fields from whichever SEO plugin is installed. */
function snaily_seo_meta($id) {
    $plugin = snaily_seo_detect_seo_plugin();
    $title  = '';
    $desc   = '';
    $focus  = '';
    $score  = null;

    if ($plugin === 'yoast') {
        $title = (string) get_post_meta($id, '_yoast_wpseo_title', true);
        $desc  = (string) get_post_meta($id, '_yoast_wpseo_metadesc', true);
        $focus = (string) get_post_meta($id, '_yoast_wpseo_focuskw', true);
        $raw   = get_post_meta($id, '_yoast_wpseo_linkdex', true);
        $score = ($raw === '' || $raw === false) ? null : (int) $raw;
    } elseif ($plugin === 'rankmath') {
        $title = (string) get_post_meta($id, 'rank_math_title', true);
        $desc  = (string) get_post_meta($id, 'rank_math_description', true);
        $focus = (string) get_post_meta($id, 'rank_math_focus_keyword', true);
        $raw   = get_post_meta($id, 'rank_math_seo_score', true);
        $score = ($raw === '' || $raw === false) ? null : (int) $raw;
    } elseif ($plugin === 'aioseo') {
        $title = (string) get_post_meta($id, '_aioseo_title', true);
        $desc  = (string) get_post_meta($id, '_aioseo_description', true);
    }

    // Rank Math stores a comma-separated list; only the primary one matters.
    if ($focus !== '' && strpos($focus, ',') !== false) {
        $parts = explode(',', $focus);
        $focus = trim($parts[0]);
    }

    /*
     * The robots switches and the primary category, so a draft can be checked
     * after it is written rather than taken on trust. Reported as plain
     * booleans: Yoast's own storage is '1'/'2' for noindex and '1'/'0' for
     * nofollow, and nobody reading an export report should have to know that.
     */
    $noindex = null;
    $nofollow = null;
    $primary = 0;

    if ($plugin === 'yoast') {
        $ni = (string) get_post_meta($id, '_yoast_wpseo_meta-robots-noindex', true);
        $nf = (string) get_post_meta($id, '_yoast_wpseo_meta-robots-nofollow', true);
        if ($ni !== '') {
            $noindex = ($ni === '1');
        }
        if ($nf !== '') {
            $nofollow = ($nf === '1');
        }
        $primary = (int) get_post_meta($id, '_yoast_wpseo_primary_category', true);
    }

    return array(
        'title'         => $title,
        'description'   => $desc,
        'focus_keyword' => $focus,
        'score'         => $score,
        'noindex'       => $noindex,
        'nofollow'      => $nofollow,
        'primary_category' => $primary > 0
            ? (string) get_cat_name($primary)
            : '',
    );
}

/** Word count that survives accented and non-Latin text. */
function snaily_seo_word_count($html) {
    $plain = wp_strip_all_tags(strip_shortcodes((string) $html));
    $plain = trim($plain);
    if ($plain === '') {
        return 0;
    }
    $words = preg_split('/\\s+/u', $plain, -1, PREG_SPLIT_NO_EMPTY);
    return is_array($words) ? count($words) : 0;
}

/** Term names, tolerating taxonomies a theme may have removed. */
function snaily_seo_terms($id, $taxonomy) {
    $terms = wp_get_post_terms($id, $taxonomy, array('fields' => 'names'));
    return is_array($terms) ? array_values($terms) : array();
}

function snaily_seo_shape($post) {
    return array(
        'id'           => (int) $post->ID,
        'type'         => $post->post_type,
        'status'       => $post->post_status,
        'title'        => get_the_title($post),
        'slug'         => $post->post_name,
        'link'         => get_permalink($post),
        'excerpt'      => wp_strip_all_tags(get_the_excerpt($post)),
        'content'      => (string) $post->post_content,
        'word_count'   => snaily_seo_word_count($post->post_content),
        'categories'   => snaily_seo_terms($post->ID, 'category'),
        'tags'         => snaily_seo_terms($post->ID, 'post_tag'),
        'author'       => (string) get_the_author_meta('display_name', $post->post_author),
        'published_at' => $post->post_date_gmt,
        'modified_at'  => $post->post_modified_gmt,
        'seo'          => snaily_seo_meta($post->ID),
        'recipe'       => snaily_seo_recipe_summary($post->ID),
    );
}

/**
 * The WP Recipe Maker card attached to a post, if there is one.
 *
 * Read back from the saved recipe rather than from what was sent, so an export
 * report can say the card exists and carries nutrition without either being
 * assumed. Cheap enough to include on every shaped post: one meta read when
 * there is no block at all.
 */
function snaily_seo_recipe_summary($post_id) {
    $recipe_id = snaily_seo_existing_recipe_id($post_id);
    if ($recipe_id <= 0) {
        return null;
    }

    $ingredients = get_post_meta($recipe_id, 'wprm_ingredients', true);
    $instructions = get_post_meta($recipe_id, 'wprm_instructions', true);
    $nutrition = get_post_meta($recipe_id, 'wprm_nutrition', true);
    $calories = is_array($nutrition) && isset($nutrition['calories'])
        ? $nutrition['calories']
        : null;

    return array(
        'id'                => $recipe_id,
        'name'              => (string) get_the_title($recipe_id),
        'ingredient_count'  => snaily_seo_recipe_count($ingredients, 'ingredients'),
        'instruction_count' => snaily_seo_recipe_count($instructions, 'instructions'),
        'nutrition_fields'  => is_array($nutrition) ? count($nutrition) : 0,
        'calories'          => is_numeric($calories) ? (float) $calories : null,
        'servings'          => (string) get_post_meta($recipe_id, 'wprm_servings', true),
        'prep_time'         => (int) get_post_meta($recipe_id, 'wprm_prep_time', true),
        'cook_time'         => (int) get_post_meta($recipe_id, 'wprm_cook_time', true),
        'course'            => snaily_seo_terms($recipe_id, 'wprm_course'),
        'cuisine'           => snaily_seo_terms($recipe_id, 'wprm_cuisine'),
        'ingredients'       => snaily_seo_recipe_lines($ingredients, 'ingredients'),
    );
}

/**
 * The ingredient names as saved, so the app can prove nothing was rewritten.
 *
 * Capped, because this rides along on every post in a listing and a hundred
 * lines of recipe on each is not a listing any more.
 */
function snaily_seo_recipe_lines($groups, $kind) {
    $out = array();
    foreach ((array) $groups as $group) {
        if (!isset($group[$kind]) || !is_array($group[$kind])) {
            continue;
        }
        foreach ($group[$kind] as $row) {
            if (count($out) >= 40) {
                return $out;
            }
            $out[] = isset($row['name']) ? (string) $row['name'] : '';
        }
    }
    return $out;
}

/**
 * Posts and pages, newest-modified first.
 *
 * Paginated because a site with a few thousand posts would otherwise time out,
 * and filterable by modified date so repeat syncs only carry what changed.
 */
function snaily_seo_posts(WP_REST_Request $request) {
    $page     = max(1, (int) $request->get_param('page'));
    $per_page = (int) $request->get_param('per_page');
    $per_page = $per_page > 0 ? min(100, $per_page) : 50;

    $args = array(
        'post_type'        => array('post', 'page'),
        'post_status'      => array('publish', 'draft', 'pending', 'private', 'future'),
        'posts_per_page'   => $per_page,
        'paged'            => $page,
        'orderby'          => 'modified',
        'order'            => 'DESC',
        'suppress_filters' => true,
        'no_found_rows'    => false,
    );

    $modified_after = $request->get_param('modified_after');
    if (is_string($modified_after) && $modified_after !== '') {
        $args['date_query'] = array(
            array(
                'column' => 'post_modified_gmt',
                'after'  => $modified_after,
            ),
        );
    }

    $query = new WP_Query($args);
    $items = array();
    foreach ($query->posts as $post) {
        $items[] = snaily_seo_shape($post);
    }

    return array(
        'items' => $items,
        'total' => (int) $query->found_posts,
        'pages' => (int) $query->max_num_pages,
        'page'  => $page,
    );
}

/* ---------------------------------------------------------------------------
 * Article binding
 * ------------------------------------------------------------------------ */

/** The Drafter article id on this request, or '' when the caller sent none. */
function snaily_seo_article_key(WP_REST_Request $request) {
    $raw = (string) $request->get_param('article_id');
    // Drafter ids are cuids. Anything else is not one, and is not going into a
    // meta_query as-is.
    if (!preg_match('/^[A-Za-z0-9_-]{1,64}$/', $raw)) {
        return '';
    }
    return $raw;
}

/**
 * The draft already bound to this article, or 0.
 *
 * Deliberately narrow: post type 'post', status exactly 'draft'. A published
 * post or one in the trash is not something a re-export may touch, so it does
 * not count as a match and a new draft is made instead.
 */
function snaily_seo_bound_draft($article) {
    if ($article === '') {
        return 0;
    }

    $found = get_posts(array(
        'post_type'        => 'post',
        'post_status'      => 'draft',
        'posts_per_page'   => 1,
        'orderby'          => 'ID',
        'order'            => 'DESC',
        'fields'           => 'ids',
        'no_found_rows'    => true,
        'suppress_filters' => true,
        'meta_key'         => SNAILY_SEO_ARTICLE_META,
        'meta_value'       => $article,
    ));

    return empty($found) ? 0 : (int) $found[0];
}

/**
 * Records which article a draft came from.
 *
 * Also written on update, so drafts exported before this existed get bound the
 * first time the author re-exports them rather than staying unprotected.
 */
function snaily_seo_bind_article($id, $article) {
    if ($article === '' || $id <= 0) {
        return;
    }
    update_post_meta($id, SNAILY_SEO_ARTICLE_META, $article);
}

/**
 * Creates a new draft. This is the only write the plugin performs.
 *
 * post_status is hard-coded to 'draft' and no post ID is accepted, so this
 * endpoint cannot publish and cannot overwrite existing content — even if the
 * caller asks it to.
 */
function snaily_seo_draft(WP_REST_Request $request) {
    $title = sanitize_text_field((string) $request->get_param('title'));
    if ($title === '') {
        return new WP_Error('snaily_no_title', 'A title is required.', array('status' => 400));
    }

    /*
     * Create is an upsert, keyed on the article.
     *
     * The app already refuses to ask for a second draft of an article it knows
     * it has exported. This is the case it cannot refuse: the app asked once,
     * the request was retried somewhere below it — a proxy, the fetch retry in
     * the connector client, a second tab — and by the time the retry arrives
     * the first insert has already happened. Without this, the author gets two
     * drafts of one recipe and no way to tell which is the real one.
     *
     * Only a draft is ever reused. A bound post the author has since published
     * is left alone and a fresh draft is made, because the alternative is
     * rewriting a live post, which this plugin exists to never do.
     */
    $article = snaily_seo_article_key($request);
    if ($article !== '') {
        $bound = snaily_seo_bound_draft($article);
        if ($bound > 0) {
            $request->set_param('id', $bound);
            $result = snaily_seo_draft_update($request);
            if (!is_wp_error($result) && is_array($result)) {
                $result['deduped'] = true;
            }
            return $result;
        }
    }

    $insert = array(
        'post_title'   => $title,
        'post_content' => wp_kses_post((string) $request->get_param('content')),
        'post_excerpt' => sanitize_text_field((string) $request->get_param('excerpt')),
        'post_name'    => sanitize_title((string) $request->get_param('slug')),
        'post_status'  => 'draft',
        'post_type'    => 'post',
    );

    $author = snaily_seo_author_id();
    if ($author > 0) {
        $insert['post_author'] = $author;
    }

    $id = wp_insert_post($insert, true);

    if (is_wp_error($id)) {
        return $id;
    }

    snaily_seo_bind_article((int) $id, $article);
    snaily_seo_write_seo_meta((int) $id, $request);
    snaily_seo_apply_draft_extras((int) $id, $request);
    snaily_seo_write_primary_category((int) $id, $request);

    $recipe = snaily_seo_create_recipe((int) $id, $request->get_param('recipe'));

    /*
     * The card is a separate post, and the article body refers to it by id.
     * A template that already carries a WPRM block has a placeholder id in it,
     * so the block is pointed at the card that was just made rather than a
     * second one being appended underneath.
     */
    if (!empty($recipe['created'])) {
        snaily_seo_attach_recipe_block((int) $id, (int) $recipe['recipe_id']);
    }

    return array(
        'id'      => (int) $id,
        'status'  => 'draft',
        'deduped' => false,
        'recipe'  => $recipe,
        'seo'     => snaily_seo_meta((int) $id),
        // Built by hand rather than with get_edit_post_link(): that checks
        // current_user_can(), and a token-authenticated request has no logged-in
        // user, so it would always return null here.
        'edit_link' => admin_url('post.php?post=' . (int) $id . '&action=edit'),
    );
}

/**
 * SEO title and description, written per field.
 *
 * Each field is written only when the app actually has a value for it. Writing
 * the pair together meant that sending a title with no description blanked
 * whatever description the author had typed in Yoast, every time they updated
 * the draft. An empty field here means "the app has nothing to say about
 * this", never "clear it".
 */
function snaily_seo_write_seo_meta($id, WP_REST_Request $request) {
    $title  = sanitize_text_field((string) $request->get_param('meta_title'));
    $desc   = sanitize_text_field((string) $request->get_param('meta_description'));
    $plugin = snaily_seo_detect_seo_plugin();

    $keys = array();
    if ($plugin === 'yoast') {
        $keys = array('title' => '_yoast_wpseo_title', 'desc' => '_yoast_wpseo_metadesc');
    } elseif ($plugin === 'rankmath') {
        $keys = array('title' => 'rank_math_title', 'desc' => 'rank_math_description');
    } elseif ($plugin === 'aioseo') {
        $keys = array('title' => '_aioseo_title', 'desc' => '_aioseo_description');
    } else {
        return;
    }

    if ($title !== '') {
        update_post_meta($id, $keys['title'], $title);
    }
    if ($desc !== '') {
        update_post_meta($id, $keys['desc'], $desc);
    }

    $focus = sanitize_text_field((string) $request->get_param('focus_keyword'));
    if ($focus !== '') {
        if ($plugin === 'yoast') {
            update_post_meta($id, '_yoast_wpseo_focuskw', $focus);
        } elseif ($plugin === 'rankmath') {
            update_post_meta($id, 'rank_math_focus_keyword', $focus);
        } elseif ($plugin === 'aioseo') {
            update_post_meta($id, '_aioseo_keywords', $focus);
        }
    }

    snaily_seo_write_robots($id, $request, $plugin);
}

/**
 * The two switches on Yoast's Advanced tab.
 *
 * Written only when the app sends them, because absent must keep meaning "no
 * opinion" rather than "set it back to the default" - an update that silently
 * re-indexed a draft the author had deliberately hidden would be worse than
 * not writing it at all.
 *
 * Yoast's own encoding, which is not a boolean: noindex is '1' to hide and
 * '2' to show, with '0' meaning "follow the site default". nofollow is the
 * plain '1' or '0'.
 */
function snaily_seo_write_robots($id, WP_REST_Request $request, $plugin) {
    $robots = $request->get_param('robots');
    if (!is_array($robots)) {
        return;
    }

    $noindex  = array_key_exists('noindex', $robots) ? (bool) $robots['noindex'] : null;
    $nofollow = array_key_exists('nofollow', $robots) ? (bool) $robots['nofollow'] : null;

    if ($plugin === 'yoast') {
        if ($noindex !== null) {
            update_post_meta($id, '_yoast_wpseo_meta-robots-noindex', $noindex ? '1' : '2');
        }
        if ($nofollow !== null) {
            update_post_meta($id, '_yoast_wpseo_meta-robots-nofollow', $nofollow ? '1' : '0');
        }
    } elseif ($plugin === 'rankmath') {
        $robots_meta = array();
        $robots_meta[] = $noindex ? 'noindex' : 'index';
        $robots_meta[] = $nofollow ? 'nofollow' : 'follow';
        update_post_meta($id, 'rank_math_robots', $robots_meta);
    } elseif ($plugin === 'aioseo') {
        if ($noindex !== null) {
            update_post_meta($id, '_aioseo_robots_noindex', $noindex ? '1' : '0');
        }
        if ($nofollow !== null) {
            update_post_meta($id, '_aioseo_robots_nofollow', $nofollow ? '1' : '0');
        }
    }
}

/**
 * Featured image, categories and tags. Categories/tags are matched by name
 * so Drafter can send the labels the author already picked.
 */
function snaily_seo_apply_draft_extras($id, WP_REST_Request $request) {
    $thumb = (int) $request->get_param('featured_media');
    if ($thumb > 0) {
        set_post_thumbnail($id, $thumb);
    }

    $cats = $request->get_param('categories');
    if (is_array($cats) && $cats !== array()) {
        $ids = array();
        foreach ($cats as $name) {
            $term = get_term_by('name', sanitize_text_field((string) $name), 'category');
            if ($term && !is_wp_error($term)) {
                $ids[] = (int) $term->term_id;
            }
        }
        if ($ids !== array()) {
            wp_set_post_categories($id, $ids);
        }
    }

    $tags = $request->get_param('tags');
    if (is_array($tags) && $tags !== array()) {
        $clean = array();
        foreach ($tags as $name) {
            $clean[] = sanitize_text_field((string) $name);
        }
        wp_set_post_tags($id, $clean);
    }
}

/**
 * Yoast's primary category, which is one term id and not a list.
 *
 * The app sends its categories with the primary one first, so this reads the
 * head of the list it already sent rather than adding a second source of
 * truth. Only ever a category the post is actually in.
 */
function snaily_seo_write_primary_category($id, WP_REST_Request $request) {
    if (snaily_seo_detect_seo_plugin() !== 'yoast') {
        return;
    }

    $cats = $request->get_param('categories');
    if (!is_array($cats) || $cats === array()) {
        return;
    }

    $term = get_term_by('name', sanitize_text_field((string) $cats[0]), 'category');
    if (!$term || is_wp_error($term)) {
        return;
    }
    if (!has_term((int) $term->term_id, 'category', $id)) {
        return;
    }

    update_post_meta($id, '_yoast_wpseo_primary_category', (int) $term->term_id);
}

/**
 * Creating the WP Recipe Maker card for a draft.
 *
 * The shape below is WPRM's own, read off the live recipes on this site rather
 * than from memory: ingredients and instructions are arrays of *groups*, each
 * group holding the real rows, and every row carries a uid of its own. Get
 * wrong produces a card that saves without complaint and renders empty.
 *
 * The one rule that overrides everything else here: the ingredient and
 * instruction text is the author's, character for character. It is inserted,
 * never parsed into parts, never re-ordered, never corrected. Amounts and
 * units are only split out when the app has already split them - the app
 * carries the original line alongside, and that is what is written when there
 * is any doubt.
 */
function snaily_seo_recipe_groups($rows, $kind) {
    $items = array();
    $uid = 0;

    foreach ((array) $rows as $row) {
        if (is_string($row)) {
            $row = array('name' => $row);
        }
        if (!is_array($row)) {
            continue;
        }

        if ($kind === 'ingredients') {
            $name = (string) (isset($row['name']) ? $row['name'] : '');
            if (trim($name) === '') {
                continue;
            }
            $items[] = array(
                'uid'    => $uid,
                'amount' => sanitize_text_field((string) (isset($row['amount']) ? $row['amount'] : '')),
                'unit'   => sanitize_text_field((string) (isset($row['unit']) ? $row['unit'] : '')),
                'name'   => sanitize_text_field($name),
                'notes'  => sanitize_text_field((string) (isset($row['notes']) ? $row['notes'] : '')),
            );
        } else {
            $text = (string) (isset($row['text']) ? $row['text'] : '');
            if (trim($text) === '') {
                continue;
            }
            $items[] = array(
                'uid'         => $uid,
                'name'        => sanitize_text_field((string) (isset($row['name']) ? $row['name'] : '')),
                'text'        => wp_kses_post($text),
                'image'       => 0,
                'ingredients' => array(),
            );
        }
        $uid++;
    }

    if ($items === array()) {
        return array();
    }

    return array(array('name' => '', $kind => $items));
}

function snaily_seo_recipe_equipment($rows) {
    $out = array();
    $uid = 0;
    foreach ((array) $rows as $row) {
        $name = is_string($row) ? $row : (isset($row['name']) ? (string) $row['name'] : '');
        if (trim($name) === '') {
            continue;
        }
        $out[] = array(
            'uid'    => $uid,
            'amount' => '',
            'name'   => sanitize_text_field($name),
            'notes'  => '',
        );
        $uid++;
    }
    return $out;
}

/**
 * Builds and saves the recipe, and returns what actually landed.
 *
 * Returns a report rather than a bare id: the app has to be able to say
 * "the card exists and nutrition is on it" without guessing, and the only
 * honest way to answer that is to read the saved recipe back.
 */
function snaily_seo_create_recipe($post_id, $payload) {
    if (!snaily_seo_wprm_active()) {
        return array('created' => false, 'reason' => 'WP Recipe Maker is not active on this site.');
    }
    if (!is_array($payload)) {
        return array('created' => false, 'reason' => 'No recipe data was sent.');
    }

    $name = sanitize_text_field((string) (isset($payload['name']) ? $payload['name'] : ''));
    if ($name === '') {
        return array('created' => false, 'reason' => 'The recipe has no title.');
    }

    $ingredients = snaily_seo_recipe_groups(
        isset($payload['ingredients']) ? $payload['ingredients'] : array(),
        'ingredients'
    );
    $instructions = snaily_seo_recipe_groups(
        isset($payload['instructions']) ? $payload['instructions'] : array(),
        'instructions'
    );

    if ($ingredients === array() || $instructions === array()) {
        return array(
            'created' => false,
            'reason'  => 'The recipe needs both ingredients and instructions.',
        );
    }

    $recipe_id = wp_insert_post(array(
        'post_type'   => WPRM_POST_TYPE,
        'post_status' => 'publish',
        'post_title'  => $name,
        'post_author' => (int) get_post_field('post_author', $post_id),
    ), true);

    if (is_wp_error($recipe_id)) {
        return array('created' => false, 'reason' => $recipe_id->get_error_message());
    }
    $recipe_id = (int) $recipe_id;

    $num = function ($key) use ($payload) {
        $v = isset($payload[$key]) ? $payload[$key] : '';
        $v = is_numeric($v) ? (int) $v : 0;
        return $v > 0 ? $v : '';
    };

    $recipe = array(
        'name'          => $name,
        'summary'       => wp_kses_post((string) (isset($payload['summary']) ? $payload['summary'] : '')),
        'servings'      => sanitize_text_field((string) (isset($payload['servings']) ? $payload['servings'] : '')),
        'servings_unit' => sanitize_text_field((string) (isset($payload['servings_unit']) ? $payload['servings_unit'] : '')),
        'cost'          => sanitize_text_field((string) (isset($payload['cost']) ? $payload['cost'] : '')),
        'prep_time'     => $num('prep_time'),
        'cook_time'     => $num('cook_time'),
        'custom_time'   => $num('custom_time'),
        'notes'         => wp_kses_post((string) (isset($payload['notes']) ? $payload['notes'] : '')),
        'equipment'     => snaily_seo_recipe_equipment(isset($payload['equipment']) ? $payload['equipment'] : array()),
        'ingredients'   => $ingredients,
        'instructions'  => $instructions,
        'parent_post_id' => (int) $post_id,
    );

    $prep = $recipe['prep_time'] === '' ? 0 : (int) $recipe['prep_time'];
    $cook = $recipe['cook_time'] === '' ? 0 : (int) $recipe['cook_time'];
    $custom = $recipe['custom_time'] === '' ? 0 : (int) $recipe['custom_time'];
    if ($prep + $cook + $custom > 0) {
        $recipe['total_time'] = $prep + $cook + $custom;
    }

    WPRM_Recipe_Saver::update_recipe($recipe_id, $recipe);

    // Taxonomies WPRM keeps beside the recipe rather than inside it.
    $taxonomies = array(
        'course'          => 'wprm_course',
        'cuisine'         => 'wprm_cuisine',
        'keyword'         => 'wprm_keyword',
        'suitablefordiet' => 'wprm_suitablefordiet',
    );
    foreach ($taxonomies as $key => $taxonomy) {
        $values = isset($payload[$key]) ? $payload[$key] : array();
        if (!is_array($values) || $values === array()) {
            continue;
        }
        if (!taxonomy_exists($taxonomy)) {
            continue;
        }
        $clean = array();
        foreach ($values as $v) {
            $v = sanitize_text_field((string) $v);
            if ($v !== '') {
                $clean[] = $v;
            }
        }
        if ($clean !== array()) {
            wp_set_object_terms($recipe_id, $clean, $taxonomy, false);
        }
    }

    $nutrition = snaily_seo_recipe_nutrition($recipe_id);

    // Read it back. Reporting what was sent would tell the app nothing.
    $saved_ingredients = get_post_meta($recipe_id, 'wprm_ingredients', true);
    $saved_instructions = get_post_meta($recipe_id, 'wprm_instructions', true);

    return array(
        'created'          => true,
        'recipe_id'        => $recipe_id,
        'ingredient_count' => snaily_seo_recipe_count($saved_ingredients, 'ingredients'),
        'instruction_count' => snaily_seo_recipe_count($saved_instructions, 'instructions'),
        'nutrition'        => $nutrition,
    );
}

function snaily_seo_recipe_count($groups, $kind) {
    $n = 0;
    foreach ((array) $groups as $group) {
        if (isset($group[$kind]) && is_array($group[$kind])) {
            $n += count($group[$kind]);
        }
    }
    return $n;
}

/**
 * Asks WPRM to work out the nutrition, then reads back what stuck.
 *
 * Automatic nutrition is a paid WPRM feature and depends on its ingredients
 * being matched to a food database, so this can legitimately come back empty
 * on a perfectly healthy install. It reports which of those happened instead
 * of pretending either way.
 */
function snaily_seo_recipe_nutrition($recipe_id) {
    if (!snaily_seo_wprm_can_calculate_nutrition()) {
        return array(
            'attached' => false,
            'reason'   => 'This WP Recipe Maker install has no automatic nutrition calculation.',
        );
    }

    $done = false;
    if (class_exists('WPRM_Nutrition_Api') && method_exists('WPRM_Nutrition_Api', 'calculate_nutrition_facts')) {
        try {
            WPRM_Nutrition_Api::calculate_nutrition_facts($recipe_id);
            $done = true;
        } catch (Exception $e) {
            $done = false;
        }
    }

    $saved = get_post_meta($recipe_id, 'wprm_nutrition', true);
    $calories = is_array($saved) && isset($saved['calories']) ? $saved['calories'] : null;

    if (is_numeric($calories) && (float) $calories > 0) {
        return array('attached' => true, 'calories' => (float) $calories, 'fields' => count($saved));
    }

    return array(
        'attached' => false,
        'called'   => $done,
        'reason'   => $done
            ? 'WP Recipe Maker returned no nutrition for these ingredients.'
            : 'No automatic nutrition entry point was available.',
    );
}

/** Whether WP Recipe Maker is installed and its saver is reachable. */
function snaily_seo_wprm_active() {
    return defined('WPRM_POST_TYPE') && class_exists('WPRM_Recipe_Saver');
}

/** Whether this WPRM install can work out nutrition by itself. */
function snaily_seo_wprm_can_calculate_nutrition() {
    if (!snaily_seo_wprm_active()) {
        return false;
    }
    return class_exists('WPRM_Nutrition_Api') || class_exists('WPRM_Nutrition');
}

/**
 * Updates an existing *draft* only. Published posts are refused.
 */
function snaily_seo_draft_update(WP_REST_Request $request) {
    $id = (int) $request->get_param('id');
    $post = get_post($id);
    if (!$post || $post->post_type !== 'post') {
        return new WP_Error('snaily_not_found', 'That draft was not found.', array('status' => 404));
    }
    if ($post->post_status !== 'draft') {
        return new WP_Error(
            'snaily_not_a_draft',
            'Snaily SEO can only update drafts. Published posts stay untouched.',
            array('status' => 403)
        );
    }

    $title = sanitize_text_field((string) $request->get_param('title'));
    $data = array('ID' => $id);
    if ($title !== '') {
        $data['post_title'] = $title;
    }
    if ($request->get_param('content') !== null) {
        $data['post_content'] = wp_kses_post((string) $request->get_param('content'));
    }
    // Empty means "the app has no value for this", not "clear it" - otherwise
    // every update would wipe an excerpt or churn a slug the author set here.
    $excerpt = sanitize_text_field((string) $request->get_param('excerpt'));
    if ($excerpt !== '') {
        $data['post_excerpt'] = $excerpt;
    }
    $slug = sanitize_title((string) $request->get_param('slug'));
    if ($slug !== '') {
        $data['post_name'] = $slug;
    }

    /*
     * Re-attribute on update as well. A draft exported before this existed
     * carries the wrong byline, and re-exporting is how the author fixes it.
     */
    $author = snaily_seo_author_id();
    if ($author > 0) {
        $data['post_author'] = $author;
    }

    $updated = wp_update_post($data, true);
    if (is_wp_error($updated)) {
        return $updated;
    }

    snaily_seo_bind_article($id, snaily_seo_article_key($request));
    snaily_seo_write_seo_meta($id, $request);
    snaily_seo_apply_draft_extras($id, $request);
    snaily_seo_write_primary_category($id, $request);

    /*
     * Only ever one card per draft. Re-exporting used to be safe because no
     * card was made at all; now that one is, a second export has to find the
     * first rather than leave a stack of orphaned recipes behind.
     */
    $recipe = array('created' => false, 'reason' => 'No recipe data was sent.');
    if ($request->get_param('recipe') !== null) {
        $existing = snaily_seo_existing_recipe_id($id);
        if ($existing > 0) {
            wp_trash_post($existing);
        }
        $recipe = snaily_seo_create_recipe($id, $request->get_param('recipe'));
        if (!empty($recipe['created'])) {
            snaily_seo_attach_recipe_block($id, (int) $recipe['recipe_id']);
        }
    }

    return array(
        'id'        => $id,
        'status'    => 'draft',
        'recipe'    => $recipe,
        'seo'       => snaily_seo_meta($id),
        'edit_link' => admin_url('post.php?post=' . $id . '&action=edit'),
    );
}

/** The WPRM card this draft already points at, or 0. */
function snaily_seo_existing_recipe_id($post_id) {
    $content = (string) get_post_field('post_content', $post_id);
    if (preg_match('/<!--\\s*wp:wp-recipe-maker\\/recipe\\s*(\\{.*?\\})?\\s*\\/?-->/s', $content, $m)) {
        if (isset($m[1])) {
            $attrs = json_decode($m[1], true);
            if (is_array($attrs) && isset($attrs['id'])) {
                return (int) $attrs['id'];
            }
        }
    }
    return 0;
}

/**
 * Points the post's WPRM block at the card that was just created.
 *
 * The template's block carries whatever id it was saved with. Rewriting the
 * attribute keeps the card where the author laid it out; appending a shortcode
 * is the fallback for a post that has no block at all, because a card nobody
 * can see is the same as no card.
 */
function snaily_seo_attach_recipe_block($post_id, $recipe_id) {
    $content = (string) get_post_field('post_content', $post_id);

    $replaced = preg_replace(
        '/<!--\\s*wp:wp-recipe-maker\\/recipe\\s*(?:\\{.*?\\})?\\s*(\\/?)-->/s',
        '<!-- wp:wp-recipe-maker/recipe {"id":' . (int) $recipe_id . '} $1-->',
        $content,
        1,
        $count
    );

    if ($count > 0 && is_string($replaced)) {
        $content = $replaced;
    } else {
        /*
         * chr(10) rather than an escape sequence: this PHP is carried in a
         * TypeScript template literal, which eats one level of backslash on
         * the way through. Building the newline from its code point means
         * there is nothing here for it to eat.
         */
        $nl = chr(10);
        $block = '<!-- wp:wp-recipe-maker/recipe {"id":' . (int) $recipe_id . '} -->'
            . '[wprm-recipe id="' . (int) $recipe_id . '"]'
            . '<!-- /wp:wp-recipe-maker/recipe -->';
        $content .= $nl . $nl . $block . $nl;
    }

    wp_update_post(array('ID' => $post_id, 'post_content' => $content));
}

function snaily_seo_taxonomies() {
    $cats = get_terms(array(
        'taxonomy'   => 'category',
        'hide_empty' => false,
        'number'     => 80,
    ));
    $tags = get_terms(array(
        'taxonomy'   => 'post_tag',
        'hide_empty' => false,
        'number'     => 80,
    ));

    $shape = function ($terms) {
        $out = array();
        if (is_wp_error($terms) || !is_array($terms)) {
            return $out;
        }
        foreach ($terms as $t) {
            $out[] = array(
                'id'   => (int) $t->term_id,
                'name' => $t->name,
                'slug' => $t->slug,
            );
        }
        return $out;
    };

    return array(
        'categories' => $shape($cats),
        'tags'       => $shape($tags),
    );
}

function snaily_seo_media_list(WP_REST_Request $request) {
    $page = max(1, (int) $request->get_param('page'));
    $q = new WP_Query(array(
        'post_type'      => 'attachment',
        'post_status'    => 'inherit',
        'post_mime_type' => 'image',
        'posts_per_page' => 24,
        'paged'          => $page,
        'orderby'        => 'date',
        'order'          => 'DESC',
    ));
    $items = array();
    foreach ($q->posts as $post) {
        $src = wp_get_attachment_image_src($post->ID, 'medium');
        $full = wp_get_attachment_image_src($post->ID, 'full');
        $items[] = array(
            'id'     => (int) $post->ID,
            'title'  => get_the_title($post),
            'alt'    => (string) get_post_meta($post->ID, '_wp_attachment_image_alt', true),
            'url'    => $full ? $full[0] : wp_get_attachment_url($post->ID),
            'thumb'  => $src ? $src[0] : '',
            'width'  => $full ? (int) $full[1] : 0,
            'height' => $full ? (int) $full[2] : 0,
        );
    }
    return array('items' => $items, 'pages' => (int) $q->max_num_pages);
}

/**
 * Alt text on one media item.
 *
 * The narrowest write this plugin performs, and deliberately so. Content
 * Intelligence audits the *published* site, and everything else here refuses
 * to touch published content - so a fix for a missing alt could not exist
 * without a route scoped tightly enough to be obviously safe.
 *
 * It is: the target must be an attachment, and the only thing written is
 * the _wp_attachment_image_alt meta key. No post content, no post status and
 * no other meta: a backtick here would end the template literal this PHP lives
 * in, which is why none appear anywhere in this file.
 * A page's words cannot change through this route, only the accessible name of
 * an image, which is the thing the audit objected to.
 *
 * The stored value is read back and returned, so the caller confirms the change
 * landed rather than trusting a 200. Writing the same alt twice is a no-op,
 * which makes the fix safe to retry.
 */
function snaily_seo_media_set_alt(WP_REST_Request $request) {
    $id = (int) $request->get_param('id');
    $post = get_post($id);

    if (!$post || $post->post_type !== 'attachment') {
        return new WP_Error(
            'snaily_not_media',
            'That media item was not found.',
            array('status' => 404)
        );
    }

    if (!wp_attachment_is_image($id)) {
        return new WP_Error(
            'snaily_not_an_image',
            'Alt text only applies to images.',
            array('status' => 400)
        );
    }

    $alt = sanitize_text_field((string) $request->get_param('alt'));
    if (strlen($alt) > 500) {
        return new WP_Error(
            'snaily_alt_too_long',
            'Alt text is limited to 500 characters.',
            array('status' => 400)
        );
    }

    $before = (string) get_post_meta($id, '_wp_attachment_image_alt', true);
    update_post_meta($id, '_wp_attachment_image_alt', $alt);
    $after = (string) get_post_meta($id, '_wp_attachment_image_alt', true);

    return array(
        'id'        => $id,
        'url'       => (string) wp_get_attachment_url($id),
        'before'    => $before,
        'alt'       => $after,
        // The caller compares this with what it sent; a false here means the
        // write did not persist, whatever the status code said.
        'persisted' => $after === $alt,
        'unchanged' => $before === $alt,
    );
}

function snaily_seo_media_upload(WP_REST_Request $request) {
    $filename = sanitize_file_name((string) $request->get_param('filename'));
    if ($filename === '') {
        $filename = 'image.jpg';
    }
    $raw = (string) $request->get_param('data');
    $comma = strpos($raw, ',');
    if ($comma !== false) {
        $raw = substr($raw, $comma + 1);
    }
    $bin = base64_decode($raw, true);
    if ($bin === false || strlen($bin) < 32) {
        return new WP_Error('snaily_bad_image', 'That image could not be read.', array('status' => 400));
    }
    if (strlen($bin) > 6 * 1024 * 1024) {
        return new WP_Error('snaily_image_too_large', 'Images must be under 6 MB.', array('status' => 413));
    }

    $tmp = wp_tempnam($filename);
    if ($tmp === false || file_put_contents($tmp, $bin) === false) {
        return new WP_Error('snaily_tmp', 'Could not store the upload.', array('status' => 500));
    }

    require_once ABSPATH . 'wp-admin/includes/file.php';
    require_once ABSPATH . 'wp-admin/includes/media.php';
    require_once ABSPATH . 'wp-admin/includes/image.php';

    $file = array(
        'name'     => $filename,
        'tmp_name' => $tmp,
        'size'     => strlen($bin),
        'error'    => 0,
    );
    $id = media_handle_sideload($file, 0);
    if (is_wp_error($id)) {
        @unlink($tmp);
        return $id;
    }

    $alt = sanitize_text_field((string) $request->get_param('alt'));
    if ($alt !== '') {
        update_post_meta($id, '_wp_attachment_image_alt', $alt);
    }
    $caption = sanitize_text_field((string) $request->get_param('caption'));
    if ($caption !== '') {
        wp_update_post(array('ID' => $id, 'post_excerpt' => $caption));
    }

    $src = wp_get_attachment_image_src($id, 'full');
    return array(
        'id'     => (int) $id,
        'url'    => $src ? $src[0] : (string) wp_get_attachment_url($id),
        'width'  => $src ? (int) $src[1] : 0,
        'height' => $src ? (int) $src[2] : 0,
        'alt'    => $alt,
    );
}

/* ---------------------------------------------------------------------------
 * Settings screen
 * ------------------------------------------------------------------------ */

add_action('admin_menu', 'snaily_seo_menu');

function snaily_seo_menu() {
    add_options_page(
        'Snaily SEO',
        'Snaily SEO',
        'manage_options',
        'snaily-seo',
        'snaily_seo_settings_page'
    );
}

add_action('admin_post_snaily_seo_regenerate', 'snaily_seo_regenerate');
add_action('admin_post_snaily_seo_save_author', 'snaily_seo_save_author');

function snaily_seo_save_author() {
    if (!current_user_can('manage_options')) {
        wp_die('Not allowed.');
    }
    check_admin_referer('snaily_seo_save_author');

    $author = isset($_POST['snaily_author']) ? (int) $_POST['snaily_author'] : 0;
    if ($author > 0 && get_userdata($author)) {
        update_option(SNAILY_SEO_AUTHOR_OPTION, $author, false);
    }

    wp_safe_redirect(admin_url('options-general.php?page=snaily-seo&author_saved=1'));
    exit;
}

/** Rotates the token, which immediately breaks any existing connection. */
function snaily_seo_regenerate() {
    if (!current_user_can('manage_options')) {
        wp_die('You do not have permission to do that.');
    }
    check_admin_referer('snaily_seo_regenerate');

    snaily_seo_generate_token();
    wp_safe_redirect(admin_url('options-general.php?page=snaily-seo&regenerated=1'));
    exit;
}

/**
 * Proves the token survives a round trip to the database.
 *
 * A token that is not actually being persisted looks completely normal on this
 * screen but can never match on an API call, which is impossible to diagnose
 * from the outside. Checking here turns that into a visible error.
 */
function snaily_seo_token_persists($token) {
    if ($token === '') {
        return false;
    }
    wp_cache_delete(SNAILY_SEO_OPTION, 'options');
    return snaily_seo_token() === $token;
}

function snaily_seo_settings_page() {
    if (!current_user_can('manage_options')) {
        return;
    }

    $token = snaily_seo_token();
    $regenerated = isset($_GET['regenerated']);
    $author_saved = isset($_GET['author_saved']);
    $persists = snaily_seo_token_persists($token);
    ?>
    <div class="wrap">
        <h1>Snaily SEO Connector</h1>

        <?php if ($author_saved) : ?>
            <div class="notice notice-success"><p>
                Draft author saved. New and re-exported drafts will use it.
            </p></div>
        <?php endif; ?>

        <?php if ($regenerated) : ?>
            <div class="notice notice-warning"><p>
                A new token was generated. Paste it into Snaily SEO to reconnect.
            </p></div>
        <?php endif; ?>

        <?php if ($token === '') : ?>
            <div class="notice notice-error"><p>
                No token has been generated yet. Click
                <strong>Generate a new token</strong> below.
            </p></div>
        <?php elseif (!$persists) : ?>
            <div class="notice notice-error"><p>
                <strong>This token is not being saved.</strong> It changes on
                every page load, so it can never match. This usually means a
                read-only database or a misconfigured object cache. Connecting
                will not work until that is fixed.
            </p></div>
        <?php endif; ?>

        <p>Copy this token and paste it into Snaily SEO to connect this site.</p>

        <table class="form-table" role="presentation">
            <tr>
                <th scope="row"><label for="snaily-token">Secret token</label></th>
                <td>
                    <input type="text" id="snaily-token" class="large-text code"
                           readonly value="<?php echo esc_attr($token); ?>"
                           onfocus="this.select();" />
                    <p class="description">
                        Treat this like a password. Anyone holding it can read
                        your content and create drafts.
                    </p>
                </td>
            </tr>
            <tr>
                <th scope="row">Site URL</th>
                <td><code><?php echo esc_html(home_url()); ?></code></td>
            </tr>
            <tr>
                <th scope="row">SEO plugin detected</th>
                <td><code><?php echo esc_html(snaily_seo_detect_seo_plugin()); ?></code></td>
            </tr>
            <tr>
                <th scope="row">Connection test</th>
                <td>
                    <a href="<?php echo esc_url(add_query_arg('${TOKEN_QUERY}', $token, rest_url(SNAILY_SEO_NS . '/site'))); ?>"
                       target="_blank" rel="noopener">Open the connector endpoint</a>
                    <p class="description">
                        This should show JSON about your site. If it shows an
                        error instead, a security plugin or your host is
                        blocking the REST API and needs to allow
                        <code>/<?php echo esc_html(SNAILY_SEO_NS); ?>/</code>.
                    </p>
                </td>
            </tr>
        </table>

        <h2>What this plugin allows</h2>
        <ul style="list-style: disc; margin-left: 20px;">
            <li>Reading your posts and pages, including SEO titles and scores.</li>
            <li>Creating and updating <strong>drafts</strong>, including images.</li>
            <li>
                It cannot publish, and it cannot change a published post.
                Deactivate the plugin to revoke access entirely.
            </li>
        </ul>

        <h2>Draft author</h2>
        <p>
            Every draft Snaily SEO creates is attributed to this user, whoever
            sent it from the app.
        </p>
        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="snaily_seo_save_author" />
            <?php wp_nonce_field('snaily_seo_save_author'); ?>
            <?php
            wp_dropdown_users(array(
                'name'     => 'snaily_author',
                'selected' => snaily_seo_author_id(),
                'who'      => 'authors',
            ));
            ?>
            <?php submit_button('Save author', 'secondary'); ?>
        </form>

        <form method="post" action="<?php echo esc_url(admin_url('admin-post.php')); ?>">
            <input type="hidden" name="action" value="snaily_seo_regenerate" />
            <?php wp_nonce_field('snaily_seo_regenerate'); ?>
            <?php submit_button('Generate a new token', 'secondary'); ?>
        </form>
    </div>
    <?php
}
`;

const README = `=== Snaily SEO Connector ===
Requires at least: 5.6
Tested up to: 6.7
Requires PHP: 7.4
Stable tag: ${PLUGIN_VERSION}
License: GPLv2 or later

Connects this site to Snaily SEO.

== Description ==

Exposes your posts and pages to Snaily SEO over an authenticated REST endpoint,
and lets Snaily SEO deliver finished articles into your drafts folder.

The plugin is read-only apart from creating and updating drafts (including
media uploads). It cannot publish, and it cannot modify a published post.

== Installation ==

1. Upload the zip via Plugins > Add New > Upload Plugin.
2. Activate it.
3. Go to Settings > Snaily SEO and copy the secret token.
4. Paste the token into Snaily SEO.

To revoke access, deactivate the plugin or generate a new token.
`;

/** The installable plugin archive. Deterministic — same bytes every call. */
export function buildPluginZip(): Buffer {
  return buildZip([
    { path: `${PLUGIN_SLUG}/${PLUGIN_SLUG}.php`, contents: PHP },
    { path: `${PLUGIN_SLUG}/readme.txt`, contents: README },
  ]);
}

/** Exposed so the download route can sanity-check the emitted source. */
export const PLUGIN_PHP = PHP;
