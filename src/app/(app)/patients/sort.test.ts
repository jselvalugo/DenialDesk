import { describe, expect, it } from "vitest";
import { parsePatientSort, patientListHref } from "./sort";

describe("patient list sort", () => {
  it("defaults to name, ascending", () => {
    expect(parsePatientSort({})).toEqual({ sort: "name", dir: "asc" });
  });

  it("falls back to safe defaults for an invalid sort key or direction", () => {
    expect(parsePatientSort({ sort: "ssn", dir: "sideways" })).toEqual({ sort: "name", dir: "asc" });
  });

  it("accepts a valid sort key and direction", () => {
    expect(parsePatientSort({ sort: "birthDate", dir: "desc" })).toEqual({ sort: "birthDate", dir: "desc" });
  });

  it("defaults the direction per column when only the sort key is given", () => {
    expect(parsePatientSort({ sort: "mrn" })).toEqual({ sort: "mrn", dir: "asc" });
  });

  it("falls back to the column's default direction for an invalid dir value", () => {
    expect(parsePatientSort({ sort: "mrn", dir: "sideways" })).toEqual({ sort: "mrn", dir: "asc" });
  });

  it("builds a href with only the non-default params", () => {
    expect(patientListHref("name", "asc", 1)).toBe("/patients");
    expect(patientListHref("birthDate", "desc", 2)).toBe("/patients?sort=birthDate&dir=desc&page=2");
    expect(patientListHref("mrn", "asc", 1)).toBe("/patients?sort=mrn");
  });
});
