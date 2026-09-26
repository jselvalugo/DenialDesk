import { expect, test } from "@playwright/test";
import { openFromSwitcher } from "./support";

test.describe("patients", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("registers a patient, finds them without the name in the URL, and edits the record", async ({
    page,
  }) => {
    await page.goto("/");
    await openFromSwitcher(page, "Patients");
    await expect(page.getByRole("heading", { level: 1, name: "Patients" })).toBeVisible();
    await page.getByRole("link", { name: "Register patient" }).click();
    // Scoped to the page: the environment banner outside <main> says "Synthetic data only." too.
    await expect(page.getByRole("main").getByText("Synthetic data only.")).toBeVisible();

    const form = page.getByRole("form", { name: "Register patient" });
    await form.getByLabel("Last name").fill("Quillfeather");
    await form.getByLabel("First name").fill("Emberly");
    await form.getByLabel("Date of birth").fill("1984-03-09");
    await form.getByLabel("Sex").selectOption("F");
    await form.getByLabel("City").fill("Tampa");
    await form.getByLabel("ZIP").fill("33606");
    // The payer is a searchable text field: text that matches no payer blocks the save instead of
    // silently becoming self-pay; a listed name resolves to that payer.
    await form.getByLabel("Payer").fill("No Such Insurer");
    await expect(form.getByText(/No payer matches/)).toBeVisible();
    await expect(form.getByRole("button", { name: "Register patient" })).toBeDisabled();
    await form.getByLabel("Payer").fill("Gulf Coast Mutual");
    await expect(form.getByText(/No payer matches/)).toBeHidden();
    // A real-looking member ID is refused in a synthetic-only environment; typed values survive.
    await form.getByLabel("Member ID").fill("W123456789");
    await form.getByLabel(/I confirm this record is synthetic/).check();
    await form.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toContainText("must start with SYN");
    await expect(form.getByLabel("Last name")).toHaveValue("Quillfeather");

    await form.getByLabel("Member ID").fill("SYN555000111");
    await form.getByRole("button", { name: "Register patient" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Quillfeather, Emberly" })).toBeVisible();
    await expect(page).toHaveTitle(/^Patient/);
    await expect(page.getByText("•••• 0111")).toBeVisible();
    await expect(page.getByText("No claims for this patient")).toBeVisible();

    // Reveal is audited and asks why.
    await page.getByRole("button", { name: "Reveal" }).click();
    await page.getByLabel("Reason for viewing").selectOption("eligibility");
    await page.getByRole("button", { name: "Reveal" }).click();
    await expect(page.getByText("SYN555000111")).toBeVisible();

    await page.goto("/patients");
    await page.getByLabel("Find a patient").fill("Quillfeather, Em");
    await page.getByRole("button", { name: "Search", exact: true }).click();
    const results = page.getByRole("region", { name: "Search results" });
    await expect(results.getByRole("link", { name: "Quillfeather, Emberly" })).toBeVisible();
    expect(page.url()).not.toContain("Quillfeather");

    await results.getByRole("link", { name: "Quillfeather, Emberly" }).click();
    await page.getByRole("link", { name: "Edit record" }).click();
    const edit = page.getByRole("form", { name: "Edit patient" });
    await expect(edit.getByText("On file: •••• 0111")).toBeVisible();
    await edit.getByLabel("City").fill("Orlando");
    await edit.getByLabel("ZIP").fill("32801");
    await edit.getByLabel(/Reason for the change/).fill("Patient moved (synthetic)");
    await edit.getByLabel(/I confirm this record is synthetic/).check();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Quillfeather, Emberly" })).toBeVisible();
    await expect(page.getByText("Orlando, FL 32801")).toBeVisible();
  });

  test("a patient's chart links to their claims and denials, and back", async ({ page }) => {
    await page.goto("/claims?group=all");
    await page.getByRole("table").getByRole("row").nth(1).getByRole("link").nth(1).click();
    await expect(page.getByRole("heading", { name: "Primary insurance" })).toBeVisible();
    const claims = page.getByRole("table", { name: "Claims for this patient" });
    await expect(claims.getByRole("row")).not.toHaveCount(1);
    await claims.getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Version history" })).toBeVisible();
    await page
      .locator("section", { has: page.getByRole("heading", { name: "Patient", exact: true }) })
      .getByRole("link")
      .click();
    await expect(page.getByRole("heading", { name: "Primary insurance" })).toBeVisible();
  });

  test("rejects malformed and unknown patient IDs", async ({ page }) => {
    expect((await page.goto("/patients/not-a-uuid"))?.status()).toBe(404);
    expect((await page.goto("/patients/00000000-0000-4000-8000-000000000000"))?.status()).toBe(404);
  });
});

test.describe("patients as compliance (read-only)", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("can view patients but not register or edit them", async ({ page }) => {
    await page.goto("/patients");
    await expect(page.getByRole("link", { name: "Register patient" })).toHaveCount(0);
    await page.getByRole("table", { name: "Patients" }).getByRole("link").first().click();
    await expect(page.getByRole("heading", { name: "Demographics" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Edit record" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reveal" })).toHaveCount(0);
    await page.goto("/patients/new");
    await expect(page.getByText("Your role can view patients but not register them.")).toBeVisible();
  });
});
