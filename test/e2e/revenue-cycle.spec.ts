import { expect, test, type Page } from "@playwright/test";

async function openDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore the demo practice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

test.describe("revenue cycle as compliance (read-only)", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("rules and ledger show the seeded default configuration", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "Rules and ledger" }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Rules and ledger" })).toBeVisible();
    const rules = page.getByRole("table", { name: "Business rules in evaluation order" });
    await expect(rules.getByRole("row")).toHaveCount(13); // header + 12 rules
    await expect(rules.getByRole("row").nth(1)).toContainText("INTEREST");
    await expect(rules.getByRole("row").last()).toContainText("Every line not matched by an earlier rule");
    await expect(page.getByRole("table", { name: "GL accounts" })).toContainText("Default AR");
    await expect(page.getByRole("table", { name: "Payer classes" })).toContainText("MCR");
    await expect(page.getByRole("button", { name: "Load the default rule set" })).toHaveCount(0);
  });
});

test.describe("monthly files", () => {
  test.describe("as compliance (read-only)", () => {
    test.use({ storageState: "test/e2e/.auth/viewer.json" });

    test("lists the seeded file and opens its totals and lines", async ({ page }) => {
      await page.goto("/revenue-cycle/files");
      await expect(page.getByRole("heading", { name: "Import a monthly file" })).toHaveCount(0);
      await page.getByRole("table", { name: "Imported monthly files" }).getByRole("link").first().click();
      await expect(page.getByRole("region", { name: "File control totals" })).toContainText("150");
      const lines = page.getByRole("table", { name: "Classified lines" });
      await expect(lines.getByRole("row")).toHaveCount(51); // header + first page of 50
      // Compliance sees masked identifiers (minimum necessary).
      await expect(lines.getByRole("row").nth(1)).toContainText("•••• ");
      await expect(page.getByText(/^1–50 of 150/)).toBeVisible();
      await page
        .getByRole("table", { name: "Totals by rule" })
        .getByRole("link", { name: "STANDARD" })
        .click();
      await expect(page).toHaveURL(/rule=STANDARD/);
      for (const row of await lines
        .getByRole("row")
        .all()
        .then((rows) => rows.slice(1))) {
        await expect(row).toContainText("STANDARD");
      }
    });
  });

  test("a manager imports a synthetic file and real-looking files are rejected", async ({ page }) => {
    await openDemo(page);
    await page.goto("/revenue-cycle/files");
    const sample = await page.request.get("/api/revenue-cycle/sample-file");
    expect(sample.headers()["content-type"]).toContain("text/csv");
    const csv = await sample.text();

    // A file without SYN- account numbers is refused, naming rows but never echoing values.
    const real = csv.replaceAll("SYN-", "");
    await page.getByLabel("Monthly file (CSV, up to 5 MB)").setInputFiles({
      name: "march.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(real),
    });
    await page.getByLabel(/synthetic data only/).check();
    await page.getByRole("button", { name: "Import file" }).click();
    const problems = page.getByRole("list", { name: "Problems in the file" });
    await expect(problems).toContainText("Row 2: Account # must start with SYN-");

    await page.getByLabel("Monthly file (CSV, up to 5 MB)").setInputFiles({
      name: "synthetic-sample.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByLabel(/synthetic data only/).check();
    await page.getByRole("button", { name: "Import file" }).click();
    await expect(page).toHaveURL(/\/revenue-cycle\/files\/[0-9a-f-]{36}$/);
    await expect(page.getByRole("region", { name: "File control totals" })).toContainText("150");
    await expect(page.getByText(/^monthly-file-\d{4}-\d{2}\.csv/)).toBeVisible();
    // Managers work accounts, so they see identifiers unmasked.
    await expect(page.getByRole("table", { name: "Classified lines" }).getByRole("row").nth(1)).toContainText(
      "SYN-",
    );
    // Paging past the end lands on the last page.
    await page.goto(`${page.url()}?page=99`);
    await expect(page).toHaveURL(/page=3$/);
  });
});

test.describe("revenue cycle as a denial specialist", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("is hidden from navigation and returns 404", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Revenue cycle");
    expect((await page.goto("/revenue-cycle/rules"))?.status()).toBe(404);
    expect((await page.goto("/revenue-cycle/files"))?.status()).toBe(404);
    expect((await page.request.get("/api/revenue-cycle/sample-file")).status()).toBe(404);
  });
});
