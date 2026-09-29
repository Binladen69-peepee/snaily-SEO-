import { prisma } from "@/lib/db";
import { log } from "@/lib/log";

export async function reportError(input: {
  message: string;
  route?: string;
  requestId?: string;
  stack?: string;
}): Promise<void> {
  const message = input.message.slice(0, 500);
  log("error", {
    route: input.route,
    requestId: input.requestId,
    message,
  });
  try {
    await prisma.errorEvent.create({
      data: {
        message,
        route: (input.route ?? "").slice(0, 200),
        requestId: (input.requestId ?? "").slice(0, 64),
        stack: (input.stack ?? "").slice(0, 4000),
      },
    });
  } catch {
    /* table missing must not take down the request */
  }
}

export async function recentErrors(limit = 8) {
  try {
    return await prisma.errorEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        message: true,
        route: true,
        requestId: true,
        createdAt: true,
      },
    });
  } catch {
    return [];
  }
}
