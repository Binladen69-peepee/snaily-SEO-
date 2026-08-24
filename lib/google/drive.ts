import { google } from "googleapis";
import type { OAuth2Client } from "google-auth-library";

const DRAFTS_FOLDER = "Snaily SEO Drafts";

export class DriveError extends Error {
  constructor(
    message: string,
    /** True when the user needs to grant Drive access. */
    readonly needsAuth = false,
  ) {
    super(message);
    this.name = "DriveError";
  }
}

function folderIdFrom(input: string): string {
  const trimmed = input.trim();
  const fromUrl = /\/folders\/([a-zA-Z0-9_-]+)/.exec(trimmed);
  if (fromUrl) return fromUrl[1]!;
  return trimmed;
}

async function ensureFolder(
  auth: OAuth2Client,
  preferredId: string,
): Promise<string> {
  const drive = google.drive({ version: "v3", auth });
  const wanted = folderIdFrom(preferredId);

  if (wanted !== "") {
    try {
      const existing = await drive.files.get({
        fileId: wanted,
        fields: "id, mimeType, trashed",
      });
      if (
        existing.data.id &&
        existing.data.mimeType === "application/vnd.google-apps.folder" &&
        existing.data.trashed !== true
      ) {
        return existing.data.id;
      }
    } catch {
      // Fall through and create (or reuse) the app folder.
    }
  }

  const found = await drive.files.list({
    q: `name = '${DRAFTS_FOLDER.replace(/'/g, "\\'")}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    spaces: "drive",
    fields: "files(id, name)",
    pageSize: 1,
  });

  const existingId = found.data.files?.[0]?.id;
  if (existingId) return existingId;

  const created = await drive.files.create({
    requestBody: {
      name: DRAFTS_FOLDER,
      mimeType: "application/vnd.google-apps.folder",
    },
    fields: "id",
  });

  if (!created.data.id) {
    throw new DriveError("Google Drive did not create a drafts folder.");
  }
  return created.data.id;
}

/** The HTTP status a googleapis error carries, when it carries one. */
function statusOf(err: unknown): number | null {
  if (typeof err !== "object" || err === null) return null;
  const e = err as {
    status?: unknown;
    code?: unknown;
    response?: { status?: unknown };
  };
  for (const v of [e.status, e.code, e.response?.status]) {
    if (typeof v === "number") return v;
    if (typeof v === "string" && /^\d+$/.test(v)) return Number(v);
  }
  return null;
}

/**
 * Turns a Google API failure into an error the route can act on.
 *
 * The distinction that matters is whether re-consenting would help. A missing
 * grant is worth sending the author to the Drive consent screen for; a Drive
 * API that is switched off in the Cloud project answers 403 as well and would
 * send them round that loop forever, so it gets its own message.
 */
function driveFailure(err: unknown): DriveError {
  const message = err instanceof Error ? err.message : "Drive request failed";

  if (/has not been used in project|accessNotConfigured|is disabled/i.test(message)) {
    return new DriveError(
      "The Google Drive API is not enabled for this app's Google Cloud project.",
    );
  }

  const status = statusOf(err);
  if (status === 401 || status === 403 || /insufficient/i.test(message)) {
    return new DriveError(
      "Google Drive access is missing. Connect Drive and try again.",
      true,
    );
  }

  return new DriveError(`Could not save to Google Drive. ${message}`);
}

/**
 * Saves the article as a Google Doc in the Drafter folder.
 *
 * HTML is converted by Drive into a native Doc so the author can keep editing
 * it there. Returns the file id and the link to open it.
 */
export async function saveGoogleDoc(
  auth: OAuth2Client,
  opts: {
    title: string;
    html: string;
    folderId: string;
    /** When set, update this file instead of creating another copy. */
    fileId?: string;
  },
): Promise<{ id: string; url: string; folderId: string }> {
  const drive = google.drive({ version: "v3", auth });

  const media = {
    mimeType: "text/html",
    body: `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(
      opts.title,
    )}</title></head><body>${opts.html}</body></html>`,
  };

  try {
    /*
     * Inside the try on purpose. This used to run above it, so a Drive call
     * that failed while finding the folder bypassed the classification below
     * and surfaced as a bare 502 — which is exactly what a token missing the
     * Drive scope did, since finding the folder is the first call made.
     */
    const folderId = await ensureFolder(auth, opts.folderId);

    if (opts.fileId) {
      const updated = await drive.files.update({
        fileId: opts.fileId,
        media,
        fields: "id, webViewLink",
      });
      const id = updated.data.id ?? opts.fileId;
      return {
        id,
        url: updated.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit`,
        folderId,
      };
    }

    const created = await drive.files.create({
      requestBody: {
        name: opts.title.trim() || "Untitled draft",
        mimeType: "application/vnd.google-apps.document",
        parents: [folderId],
      },
      media,
      fields: "id, webViewLink",
    });

    const id = created.data.id;
    if (!id) throw new DriveError("Google Drive did not return a file id.");

    return {
      id,
      url: created.data.webViewLink ?? `https://docs.google.com/document/d/${id}/edit`,
      folderId,
    };
  } catch (err) {
    if (err instanceof DriveError) throw err;
    throw driveFailure(err);
  }
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
