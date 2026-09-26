import { readFileSync } from "node:fs";
import { expect, type Page } from "@playwright/test";
import { currentStep, totpAt } from "@/auth/totp";
import type { E2EUser } from "./global-setup";

export function e2eUser(key: "worker" | "viewer" | "newbie" | "locked"): E2EUser {
  return JSON.parse(readFileSync("test/e2e/.auth/users.json", "utf8"))[key];
}

/** Next unused TOTP code: waits for a fresh 30-second step so replay protection never trips. */
export async function freshCode(secret: string, usedSteps: Set<number>): Promise<string> {
  let step = currentStep();
  while (usedSteps.has(step)) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    step = currentStep();
  }
  usedSteps.add(step);
  return totpAt(secret, step);
}

export async function signInWithPassword(page: Page, user: E2EUser) {
  await page.goto("/login");
  await page.getByLabel("Work email").fill(user.email);
  await page.getByLabel("Password").fill(user.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

export async function signIn(page: Page, user: E2EUser) {
  await signInWithPassword(page, user);
  await expect(page.getByRole("heading", { name: "Two-step verification" })).toBeVisible();
  await page.getByLabel("6-digit code").fill(await freshCode(user.totpSecret!, new Set()));
  await page.getByRole("button", { name: "Verify" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}
