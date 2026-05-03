import { NextResponse } from "next/server";
import { z } from "zod";
import { authedRoute } from "@/server/api";
import * as projects from "@/server/projects";

type Ctx = { params: Promise<{ id: string }> };

const postSchema = z.object({ reviewId: z.string().min(1) });

export const POST = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = postSchema.parse(await request.json());
    const added = await projects.addReviewToProject(userId, id, body.reviewId);
    return NextResponse.json({ added });
  },
);

const deleteSchema = z.object({ reviewId: z.string().min(1) });

export const DELETE = authedRoute(
  async (userId, request: Request, { params }: Ctx) => {
    const { id } = await params;
    const body = deleteSchema.parse(await request.json());
    const removed = await projects.removeReviewFromProject(
      userId,
      id,
      body.reviewId,
    );
    return NextResponse.json({ removed });
  },
);
