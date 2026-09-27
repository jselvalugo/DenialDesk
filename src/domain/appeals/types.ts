import type { appealLevelEnum } from "@/db/schema";

export type AppealLevel = (typeof appealLevelEnum.enumValues)[number];

/** Levels the rules engine can compute a deadline for today (spec: appeals.md A1/A3). */
export const COMPUTABLE_LEVELS: readonly AppealLevel[] = ["first_level"];
