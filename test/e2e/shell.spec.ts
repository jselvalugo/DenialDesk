import { expect, test } from "@playwright/test";

test("sign-in page shows the synthetic-data banner", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("note", { name: "Environment notice" })).toContainText("Synthetic data only");
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

test("the removed design system page returns 404", async ({ request }) => {
  expect((await request.get("/design")).status()).toBe(404);
});

test("health endpoint reports status without leaking config", async ({ request }) => {
  const response = await request.get("/api/health");
  const body = await response.json();
  expect(Object.keys(body).sort()).toEqual(["appEnv", "db", "status"]);
  expect(JSON.stringify(body)).not.toContain("postgres://");
});

test("pages send a nonce-based Content-Security-Policy and load without violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (message) => {
    if (message.text().includes("Content Security Policy")) violations.push(message.text());
  });
  const response = await page.goto("/login");
  const csp = response?.headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]+' 'strict-dynamic'/);
  expect(csp).toContain("frame-ancestors 'none'");
  await page.getByLabel("Work email").fill("csp-check@e2e.denialdesk.test");
  expect(violations).toEqual([]);
});

test("the preview seed endpoint rejects requests without the secret token", async ({ request }) => {
  // 404 without a valid token; 429 once this network exceeds the endpoint's rate limit.
  expect([404, 429]).toContain((await request.post("/api/preview/seed")).status());
  const wrong = await request.post("/api/preview/seed", {
    headers: { authorization: `Bearer ${"w".repeat(40)}` },
  });
  expect([404, 429]).toContain(wrong.status());
});

test("the preview operator status endpoint rejects requests without the secret token", async ({
  request,
}) => {
  expect([404, 429]).toContain((await request.get("/api/preview/operator-status")).status());
  const wrong = await request.get("/api/preview/operator-status", {
    headers: { authorization: `Bearer ${"w".repeat(40)}` },
  });
  expect([404, 429]).toContain(wrong.status());
});

test.describe("shell chrome", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the user menu switches the language and back (spec: internationalization)", async ({ page }) => {
    await page.goto("/overview");
    const userMenu = page.getByRole("button", { name: /Riley Worker/ });
    await userMenu.click();
    const language = page.getByRole("group", { name: "Language" });
    await expect(language.getByRole("button", { name: "English" })).toHaveAttribute("aria-pressed", "true");
    try {
      await language.getByRole("button", { name: "Español" }).click();
      // The whole page re-renders in Spanish: tab bar, header field, and <html lang>.
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await expect(
        page
          .getByRole("navigation", { name: "Principal" })
          .getByRole("link", { name: "Cola de denegaciones" }),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: /, cambiar de módulo$/ })).toBeVisible();
      await expect(page.getByRole("note", { name: "Aviso de entorno" })).toContainText(
        "Solo datos sintéticos",
      );
      // The choice is stored on the account and applied at the next sign-in; the cookie carries it now.
      await page.goto("/settings");
      await expect(page.locator("html")).toHaveAttribute("lang", "es");
      await userMenu.click();
      const idioma = page.getByRole("group", { name: "Idioma" });
      await expect(idioma.getByRole("button", { name: "Español" })).toHaveAttribute("aria-pressed", "true");
      await idioma.getByRole("button", { name: "Português" }).click();
      await expect(page.locator("html")).toHaveAttribute("lang", "pt");
      await expect(page.getByRole("navigation", { name: "Principal" })).toBeVisible();
    } finally {
      // Leave the shared worker account in English for the other tests.
      await page.goto("/overview");
      await userMenu.click();
      await page
        .getByRole("group", { name: /Language|Idioma/ })
        .getByRole("button", { name: "English" })
        .click();
      await expect(page.locator("html")).toHaveAttribute("lang", "en");
    }
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Denial queue" }),
    ).toBeVisible();
  });

  test("skip link moves focus to the main content", async ({ page }) => {
    await page.goto("/overview");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await skip.press("Enter");
    await expect(page).toHaveURL(/#main$/);
  });

  test("unbuilt sections are not links", async ({ page }) => {
    // Every module and page in the switcher has shipped (Design system removed, Appeals shipped
    // in A1, Insight standard reports shipped) — there is currently no NavItem left with
    // `available: false` to check in the switcher itself (src/components/shell/navigation.ts).
    // The switcher's own "Planned" rendering still exists in ModuleSwitcher.tsx and will be
    // exercised again the next time a module or page ships partway. In the meantime, the
    // Insight report catalog has two genuinely still-planned entries
    // (docs/specs/insight-standard-reports.md #7-#8) — this checks that pattern there instead.
    await page.goto("/overview");
    await page.getByRole("button", { name: /, switch module$/ }).click();
    const switcher = page.getByRole("dialog", { name: "Go to" });
    await expect(switcher.getByRole("link", { name: "Denial queue" })).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Reports" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.goto("/insight");
    await expect(page.getByText("Planned — see spec", { exact: true })).toHaveCount(2);
    await expect(page.getByRole("link", { name: /Prompt-pay scorecard/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Underpayment variance/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open" }).first()).toBeVisible();
  });

  test("the module switcher searches modules and pages and opens one", async ({ page }) => {
    await page.goto("/overview");
    // The shortcut listener attaches after hydration; wait for client-rendered chrome first.
    await expect(page.getByRole("button", { name: /, switch module$/ })).toBeEnabled();
    // The launcher shows the brand mark, not the module name.
    await expect(
      page.getByRole("button", { name: /, switch module$/ }).locator("svg[data-brand-mark]"),
    ).toBeVisible();
    await expect(async () => {
      await page.keyboard.press("Control+k");
      await expect(page.getByRole("dialog", { name: "Go to" })).toBeVisible({ timeout: 500 });
    }).toPass();
    const switcher = page.getByRole("dialog", { name: "Go to" });
    await expect(switcher.getByLabel("Search modules and pages")).toBeFocused();
    await switcher.getByLabel("Search modules and pages").fill("queue");
    await expect(switcher.getByRole("link", { name: "Denial queue" })).toBeVisible();
    // A module match keeps all of its pages; a page match shows only its module and that page.
    await switcher.getByLabel("Search modules and pages").fill("claims");
    await expect(switcher.getByRole("link", { name: "Claims module" })).toBeVisible();
    await expect(switcher.getByText("Remittances", { exact: true })).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Denials module" })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(switcher).toBeHidden();
    await page.getByRole("button", { name: /, switch module$/ }).click();
    await switcher.getByRole("link", { name: "Settings module" }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Settings", exact: true }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("navigation icons are decorative and link names stay text-only", async ({ page }) => {
    await page.goto("/settings");
    const nav = page.getByRole("navigation", { name: "Primary" });
    const moduleButton = page.getByRole("button", { name: "Settings, switch module", exact: true });
    await moduleButton.click();
    const switcher = page.getByRole("dialog", { name: "Go to" });
    // No nine-dot grid icon anywhere in the chrome (ADR 0005).
    await expect(page.locator("header svg.lucide-grip, header svg.lucide-grid-3x3")).toHaveCount(0);
    for (const scope of [nav, switcher, moduleButton]) {
      const icons = scope.locator("svg");
      expect(await icons.count()).toBeGreaterThan(0);
      for (const icon of await icons.all()) await expect(icon).toHaveAttribute("aria-hidden", "true");
    }
    await expect(nav.getByRole("link", { name: "Settings", exact: true })).toBeVisible();
    await expect(switcher.getByRole("link", { name: "Denial queue", exact: true })).toBeVisible();
  });

  test("the switcher marks the current module and counts results", async ({ page }) => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Settings, switch module", exact: true }).click();
    const switcher = page.getByRole("dialog", { name: "Go to" });
    await expect(
      switcher.getByRole("heading", { level: 3, name: /^Settings/ }).getByText("Current", { exact: true }),
    ).toBeVisible();
    await expect(switcher.getByRole("list", { name: "Settings", exact: true })).toBeVisible();
    await switcher.getByLabel("Search modules and pages").fill("claims");
    await expect(switcher.getByText("1 module · 3 pages")).toBeVisible();
  });

  test("the module switcher opens from the header field and closes with its button or the backdrop", async ({
    page,
  }) => {
    await page.goto("/overview");
    const switcher = page.getByRole("dialog", { name: "Go to" });
    await page.getByRole("button", { name: "Go to a module or page" }).click();
    await expect(switcher).toBeVisible();
    await switcher.getByRole("button", { name: "Close" }).click();
    await expect(switcher).toBeHidden();
    await page.getByRole("button", { name: /, switch module$/ }).click();
    await expect(switcher).toBeVisible();
    await page.mouse.click(8, 890); // the backdrop, outside the dialog box
    await expect(switcher).toBeHidden();
  });

  test("the header fits a 1024px window without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 800 });
    await page.goto("/overview");
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1024);
  });
});

test.describe("signed in", () => {
  test.use({ storageState: "test/e2e/.auth/worker.json" });

  test("the tab bar names the current module and opens the switcher from it", async ({ page }) => {
    await page.goto("/overview");
    const button = page.getByRole("button", { name: "Denials, switch module", exact: true });
    await expect(button).toHaveAttribute("aria-haspopup", "dialog");
    await button.click();
    const switcher = page.getByRole("dialog", { name: "Go to" });
    await expect(switcher).toBeVisible();
    await switcher.getByRole("link", { name: "Claims module" }).click();
    await expect(page.getByRole("button", { name: "Claims, switch module", exact: true })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Primary" }).getByRole("link", { name: "Claims" }),
    ).toHaveAttribute("aria-current", "page");
  });

  test("the logo opens the home page, and /welcome redirects there", async ({ page }) => {
    await page.goto("/welcome");
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await page.goto("/claims");
    await page.getByRole("link", { name: "DenialDesk home" }).click();
    await expect.poll(() => new URL(page.url()).pathname).toBe("/");
    await expect(page.getByRole("heading", { level: 1, name: /^Welcome, / })).toBeVisible();
    for (const name of [
      "How DenialDesk works",
      "From patient record to claim and denial",
      "Your modules",
      "Safeguards",
    ]) {
      await expect(page.getByRole("heading", { level: 2, name })).toBeVisible();
    }
    // Shipped steps link to their page; planned steps are labelled, never linked.
    for (const step of [1, 2, 3]) {
      await expect(page.locator(`[data-step="${step}"]`).getByRole("link")).toHaveCount(1);
    }
    for (const step of [4, 5]) {
      const item = page.locator(`[data-step="${step}"]`);
      await expect(item.getByRole("link")).toHaveCount(0);
      await expect(item.getByText("Planned")).toBeVisible();
    }
    for (const step of [1, 4]) {
      await expect(page.locator(`[data-record-step="${step}"]`).getByRole("link")).toHaveAttribute(
        "href",
        "/patients",
      );
    }
    for (const step of [2, 3]) {
      const item = page.locator(`[data-record-step="${step}"]`);
      await expect(item.getByRole("link")).toHaveCount(0);
      await expect(item.getByText("Planned", { exact: true })).toBeVisible();
    }
    for (const title of [
      "Sign-in needs a second factor",
      "Identifiers are encrypted",
      "Business Associate Agreements on file",
    ]) {
      await expect(page.getByText(title, { exact: true })).toBeVisible();
    }
  });
});
