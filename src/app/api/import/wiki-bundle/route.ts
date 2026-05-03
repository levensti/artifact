import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute, HttpError } from "@/server/api";
import { prisma } from "@/server/db";
import { extractWikiLinkSlugs } from "@/lib/wiki-link-transform";
import { validateBundle } from "@/lib/client/sharing/bundle-format";

const schema = z.object({
  bundle: z.unknown(),
  strategy: z.enum(["skip", "overwrite", "rename"]).default("skip"),
});

export const POST = authedRoute(async (userId, request: Request) => {
  const { bundle: raw, strategy } = schema.parse(await request.json());
  const result = validateBundle(raw);
  if (!result.ok || !result.bundle || result.bundle.type !== "wiki") {
    throw new HttpError(400, "Invalid wiki bundle");
  }
  const bundle = result.bundle;

  let imported = 0;
  let skipped = 0;
  let renamed = 0;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    for (const page of bundle.data.pages) {
      const existing = await tx.wikiPage.findUnique({
        where: { userId_slug: { userId, slug: page.slug } },
      });

      let targetSlug = page.slug;
      let targetId = page.id;
      let targetCreatedAt = existing?.createdAt ?? new Date(page.createdAt ?? now);

      if (existing) {
        if (strategy === "skip") {
          skipped++;
          continue;
        }
        if (strategy === "overwrite") {
          targetSlug = existing.slug;
          targetId = existing.id;
          if (existing.content !== page.content) {
            await tx.wikiRevision.create({
              data: {
                userId,
                pageId: existing.id,
                slug: existing.slug,
                title: existing.title,
                content: existing.content,
                pageType: existing.pageType,
                savedAt: now,
              },
            });
          }
        } else {
          let candidate = `${page.slug}-imported`;
          let attempt = 2;
          while (
            await tx.wikiPage.findUnique({
              where: { userId_slug: { userId, slug: candidate } },
            })
          ) {
            candidate = `${page.slug}-imported-${attempt++}`;
          }
          targetSlug = candidate;
          targetId = crypto.randomUUID();
          targetCreatedAt = now;
          renamed++;
        }
      }

      await tx.wikiPage.upsert({
        where: { userId_slug: { userId, slug: targetSlug } },
        create: {
          id: targetId,
          userId,
          slug: targetSlug,
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          createdAt: targetCreatedAt,
          updatedAt: now,
        },
        update: {
          title: page.title,
          content: page.content,
          pageType: page.pageType,
          updatedAt: now,
        },
      });

      await tx.wikiBacklink.deleteMany({
        where: { userId, sourceId: targetId },
      });
      const targets = extractWikiLinkSlugs(page.content);
      if (targets.length > 0) {
        await tx.wikiBacklink.createMany({
          data: targets.map((t) => ({
            userId,
            sourceId: targetId,
            targetSlug: t,
          })),
          skipDuplicates: true,
        });
      }
      imported++;
    }
  });

  return NextResponse.json({ imported, skipped, renamed });
});
