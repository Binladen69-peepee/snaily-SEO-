import { getSession } from "@/lib/auth";
import { buildPluginZip, PLUGIN_SLUG, PLUGIN_VERSION } from "@/lib/wordpress/plugin";

/**
 * Serves the connector plugin as an installable .zip.
 *
 * Behind auth: the archive is not secret, but there is no reason to host an
 * anonymous download endpoint for it.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const zip = buildPluginZip();

  return new Response(new Uint8Array(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="${PLUGIN_SLUG}-${PLUGIN_VERSION}.zip"`,
      "Content-Length": String(zip.length),
      "Cache-Control": "no-store",
    },
  });
}
