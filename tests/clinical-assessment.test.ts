import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { clinicalAssessmentSchema, emptyAssessment, firstIssue } from "../src/lib/clinical-assessment.ts";

function parse(overrides: Record<string, unknown>) {
  return clinicalAssessmentSchema.safeParse({ ...emptyAssessment(), ...overrides });
}

describe("Clinical assessment validation", () => {
  it("accepts an empty assessment", () => {
    assert.equal(parse({}).success, true);
  });

  it("accepts a full assessment and trims text", () => {
    const result = parse({
      bpSystolic: 128, bpDiastolic: 84, pulseRate: 76, spo2: 98, weightKg: 70.25, heightCm: 172,
      maritalStatus: "MARRIED", chiefComplaints: "  Knee pain for 2 weeks  ",
      comorbidities: ["HTN", "DM", "OTHER"], comorbidityOther: "Gout",
      habits: ["SMOKING"], habitDetails: "5 cigarettes a day",
      drugAllergy: true, drugAllergyDetails: "Penicillin – rash",
    });
    assert.equal(result.success, true);
    assert.equal(result.data?.chiefComplaints, "Knee pain for 2 weeks");
    assert.equal(result.data?.weightKg, 70.3);
    assert.deepEqual(result.data?.comorbidities, ["HTN", "DM", "OTHER"]);
  });

  it("treats blank text as not recorded", () => {
    assert.equal(parse({ treatment: "   " }).data?.treatment, null);
  });

  it("rejects out-of-range and inconsistent vitals", () => {
    assert.match(firstIssue(parse({ spo2: 101 }).error!), /SpO₂ must be at most 100/);
    assert.match(firstIssue(parse({ pulseRate: 72.5 }).error!), /whole number/);
    assert.match(firstIssue(parse({ bpSystolic: 120 }).error!), /both systolic and diastolic/);
    assert.match(firstIssue(parse({ bpSystolic: 80, bpDiastolic: 90 }).error!), /higher than diastolic/);
    assert.equal(parse({ weightKg: Number.NaN }).success, false);
  });

  it("requires details for conditional options", () => {
    assert.match(firstIssue(parse({ comorbidities: ["OTHER"] }).error!), /other comorbidity/);
    assert.match(firstIssue(parse({ habits: ["ALCOHOL", "OTHER"] }).error!), /other habit/);
    assert.match(firstIssue(parse({ drugAllergy: true }).error!), /drug allergy/);
    assert.equal(parse({ habits: ["ALCOHOL"] }).success, true, "details are optional for listed habits");
  });

  it("drops details that belong to unselected options", () => {
    const result = parse({ comorbidityOther: "stale", habits: [], habitDetails: "stale", drugAllergy: false, drugAllergyDetails: "stale" });
    assert.equal(result.data?.comorbidityOther, null);
    assert.equal(result.data?.habitDetails, null);
    assert.equal(result.data?.drugAllergyDetails, null);
  });

  it("rejects unknown option values", () => {
    assert.equal(parse({ comorbidities: ["CANCER"] }).success, false);
    assert.equal(parse({ maritalStatus: "DIVORCED" }).success, false);
  });
});
