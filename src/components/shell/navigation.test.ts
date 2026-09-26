import { describe, expect, it } from "vitest";
import { appHome, locate, navApps } from "./navigation";

const all = { showRevenueCycle: true, showDesignSystem: true };
const none = { showRevenueCycle: false, showDesignSystem: false };

describe("navApps", () => {
  it("hides revenue cycle and setup from users who can't open them", () => {
    const ids = navApps(none).map((app) => app.id);
    expect(ids).toEqual(["denials", "claims", "insight"]);
    expect(navApps(all).map((app) => app.id)).toEqual([
      "denials",
      "claims",
      "revenue-cycle",
      "insight",
      "setup",
    ]);
  });

  it("an app with only planned pages has no home", () => {
    const insight = navApps(none).find((app) => app.id === "insight")!;
    expect(appHome(insight)).toBeNull();
  });
});

describe("locate", () => {
  const apps = navApps(all);

  it("maps a path to its app and page, detail pages to their list", () => {
    expect(locate(apps, "/")).toMatchObject({ app: { id: "denials" }, item: { label: "Overview" } });
    expect(locate(apps, "/denials/abc")).toMatchObject({
      app: { id: "denials" },
      item: { label: "Denial queue" },
    });
    expect(locate(apps, "/revenue-cycle/journal/1")).toMatchObject({
      app: { id: "revenue-cycle" },
      item: { label: "Journal vouchers" },
    });
    expect(locate(apps, "/revenue-cycle/deposits")).toMatchObject({ item: { label: "Deposits" } });
    expect(locate(apps, "/revenue-cycle/ar-aging")).toMatchObject({ item: { label: "A/R aging" } });
    expect(locate(apps, "/design")).toMatchObject({ app: { id: "setup" }, item: { label: "Design system" } });
  });

  it("does not match a path that only shares a prefix, and never a planned page", () => {
    expect(locate(apps, "/claimsx").item).toBeNull();
    expect(locate(apps, "/appeals").item).toBeNull();
    expect(locate(apps, "/appeals").app.id).toBe("denials");
  });
});
