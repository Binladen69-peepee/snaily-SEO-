import { z } from "zod";

export const registerSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters").max(100),
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(8, "Password must be at least 8 characters").max(200),
});

export const loginSchema = z.object({
  email: z.string().email("Enter a valid email address"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

/** Accepts "example.com" or "https://example.com/" → "https://example.com" */
export function normalizeUrl(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const withProtocol = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;

  try {
    const url = new URL(withProtocol);

    // Allow localhost / IPs (self-hosted setups audit local sites); otherwise
    // require a real dotted hostname.
    const isLocal =
      url.hostname === "localhost" || /^\d{1,3}(\.\d{1,3}){3}$/.test(url.hostname);
    if (!isLocal && (url.hostname.length < 3 || !url.hostname.includes("."))) {
      return null;
    }

    // url.host keeps the port — url.hostname would silently drop it.
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return null;
  }
}

export const projectSchema = z.object({
  name: z.string().min(1, "Website name is required").max(100),
  url: z
    .string()
    .min(1, "Website URL is required")
    .transform((v, ctx) => {
      const normalized = normalizeUrl(v);
      if (!normalized) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Enter a valid website URL, e.g. example.com",
        });
        return z.NEVER;
      }
      return normalized;
    }),
  description: z.string().max(500).optional().or(z.literal("")),
});

export type ProjectInput = z.infer<typeof projectSchema>;
