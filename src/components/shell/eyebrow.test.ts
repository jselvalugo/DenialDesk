import { describe, expect, it } from "vitest";
import { eyebrowText } from "./eyebrow";

describe("page eyebrow", () => {
  it("names a record page after itself", () => {
    expect(eyebrowText("Patients", "Patients", "Ashby, Avery", "Patient record")).toBe(
      "Patients · Patient record",
    );
  });
  it("adds the tab when it differs from both the title and the module", () => {
    expect(eyebrowText("Denials", "Appeals", "Ashby, Avery")).toBe("Denials · Appeals");
  });
  it("shows the module alone when the tab repeats the title or the module name", () => {
    expect(eyebrowText("Patients", "Patients", "Patients")).toBe("Patients");
    expect(eyebrowText("Patients", "Patients", "Edit patient")).toBe("Patients");
    expect(eyebrowText("Insight", undefined, "Reports")).toBe("Insight");
  });
});
