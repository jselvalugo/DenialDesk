import { expect, test, type Page } from "@playwright/test";
import { DEFAULT_RULES } from "@/domain/revenue-cycle/defaults";
import { openFromLauncher } from "./support";

async function openDemo(page: Page) {
  await page.goto("/login");
  await page.getByRole("button", { name: "Explore the demo practice" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
}

test.describe("revenue cycle as compliance (read-only)", () => {
  test.use({ storageState: "test/e2e/.auth/viewer.json" });

  test("rules and ledger show the seeded default configuration", async ({ page }) => {
    await page.goto("/");
    await openFromLauncher(page, "Rules and ledger");
    await expect(page.getByRole("heading", { level: 1, name: "Rules and ledger" })).toBeVisible();
    const rules = page.getByRole("table", { name: "Business rules in evaluation order" });
    await expect(rules.getByRole("row")).toHaveCount(DEFAULT_RULES.length + 1); // header + rules
    await expect(rules.getByRole("row").nth(1)).toContainText("PROMPT_PAY_INTEREST");
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
      await expect(page.getByRole("region", { name: "File control totals" })).toContainText("Open balance");
      const lines = page.getByRole("table", { name: "Classified lines" });
      await expect(lines.getByRole("row")).toHaveCount(51); // header + first page of 50
      // Compliance sees masked identifiers (minimum necessary).
      await expect(lines.getByRole("row").nth(1)).toContainText("•••• ");
      await expect(page.getByText(/^1–50 of \d{3}/)).toBeVisible();
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
    await expect(problems).toContainText("Row 2: Account number must start with SYN-");

    await page.getByLabel("Monthly file (CSV, up to 5 MB)").setInputFiles({
      name: "synthetic-sample.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(csv),
    });
    await page.getByLabel(/synthetic data only/).check();
    await page.getByRole("button", { name: "Import file" }).click();
    await expect(page).toHaveURL(/\/revenue-cycle\/files\/[0-9a-f-]{36}$/);
    const lineCount = csv.trim().split("\r\n").length - 1;
    await expect(page.getByRole("region", { name: "File control totals" })).toContainText(
      lineCount.toLocaleString("en-US"),
    );
    await expect(page.getByText(/^monthly-file-\d{4}-\d{2}\.csv/)).toBeVisible();
    // Managers work accounts, so they see identifiers unmasked.
    await expect(page.getByRole("table", { name: "Classified lines" }).getByRole("row").nth(1)).toContainText(
      "SYN-",
    );
    // Paging past the end lands on the last page.
    await page.goto(`${page.url()}?page=99`);
    await expect(page).toHaveURL(new RegExp(`page=${Math.ceil(lineCount / 50)}$`));
  });
});

test.describe("journal vouchers", () => {
  test("the demo manager approves a voucher prepared by a colleague and exports the GL file", async ({
    page,
  }) => {
    await openDemo(page);
    await openFromLauncher(page, "Revenue cycle app");
    await expect(page.getByRole("heading", { level: 1, name: "Monthly files" })).toBeVisible();
    // Inside the Revenue cycle app its pages are tabs.
    await page
      .getByRole("navigation", { name: "Primary" })
      .getByRole("link", { name: "Journal vouchers" })
      .click();
    const list = page.getByRole("table", { name: "Journal vouchers" });
    await expect(list).toContainText("Draft");
    await expect(list).toContainText("Dana Whitfield");
    await list.getByRole("link").first().click();
    await expect(page.getByRole("region", { name: "Voucher summary" })).toContainText("5 of 5");
    const checks = page.getByRole("list", { name: "Voucher checks" });
    await expect(checks.getByText("Pass")).toHaveCount(5);
    await page.getByRole("button", { name: "Approve voucher" }).click();
    await expect(page.getByRole("region", { name: "Voucher summary" })).toContainText("Approved");

    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export GL file" }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^RCM-\d{4}-\d{2}-v\d+\.csv$/);
    await expect(page.getByRole("region", { name: "Voucher summary" })).toContainText("Exported");
    await expect(page.getByRole("button", { name: "Download GL file again" })).toBeVisible();
  });

  test.describe("as compliance (read-only)", () => {
    test.use({ storageState: "test/e2e/.auth/viewer.json" });

    test("can review vouchers but not prepare or approve them", async ({ page }) => {
      await page.goto("/revenue-cycle/journal");
      await expect(page.getByRole("heading", { name: "Journal vouchers", level: 1 })).toBeVisible();
      await expect(page.getByRole("heading", { name: "Prepare a voucher" })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Approve voucher" })).toHaveCount(0);
    });
  });
});

test.describe("revenue cycle as a denial specialist", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("is hidden from navigation and returns 404", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "Primary" })).not.toContainText("Revenue cycle");
    await page.getByRole("button", { name: "App launcher" }).click();
    const launcher = page.getByRole("dialog", { name: "App launcher" });
    await expect(launcher.getByRole("link", { name: "Claims app" })).toBeVisible();
    await expect(launcher).not.toContainText("Revenue cycle");
    await expect(launcher).not.toContainText("Journal vouchers");
    await page.keyboard.press("Escape");
    expect((await page.goto("/revenue-cycle/journal"))?.status()).toBe(404);
    expect((await page.goto("/revenue-cycle/rules"))?.status()).toBe(404);
    expect((await page.goto("/revenue-cycle/files"))?.status()).toBe(404);
    expect((await page.request.get("/api/revenue-cycle/sample-file")).status()).toBe(404);
  });
});
