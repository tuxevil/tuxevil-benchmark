import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, expect, it, vi } from "vitest";
import { gradeIfstruct, IFSTRUCT_CASES } from "@/lib/ifstruct-pilot";

const listing = {
  listing_price_usd: 270000,
  property_type: "condo",
  year_built: 2010,
  square_feet: 900,
  bedrooms: 2,
  bathrooms: 1,
  stories: 2,
  has_pool: true,
  is_new_construction: false,
};
const invoice = [
  "invoice:",
  "  - vendor_name: Example",
  "    invoice_total_usd: 125",
  "    subtotal_usd: 100",
  "    tax_total_usd: 25",
  "    discount_total_usd: 0",
  "    due_in_days: 30",
  "    line_item_count: 1",
  "    billing_type: services",
  "    paid_by_bank_transfer_allowed: true",
].join("\n");

afterEach(() => vi.unstubAllEnvs());

it("executes the byte-for-byte official validator", () => {
  const digest = createHash("sha256").update(readFileSync("scripts/ifstruct/validator.py")).digest("hex");
  expect(digest).toBe("53e8a3da887e9489f998bef0c1579bdbb5549256110187d92143c88c101233f2");
});

it("validates JSON shape, typed fields and parse failures", async () => {
  const { fixture } = IFSTRUCT_CASES[0];
  await expect(gradeIfstruct(fixture, JSON.stringify([listing]))).resolves.toMatchObject({
    passed: true, details: { json_valid: true, schema_valid: true },
  });
  await expect(gradeIfstruct(fixture, JSON.stringify([{ ...listing, listing_price_usd: "270000" }]))).resolves.toMatchObject({
    passed: false, details: { json_valid: true, schema_valid: false },
  });
  await expect(gradeIfstruct(fixture, "[{")).resolves.toMatchObject({
    passed: false, details: { json_valid: false },
  });
});

it("checks the wrapper, count, and commentary constraints", async () => {
  const { fixture } = IFSTRUCT_CASES[1];
  const ticket = {
    event_name: "Example",
    ticket_count: 2,
    face_value_total_usd: 120,
    fees_total_usd: 5,
    total_paid_usd: 125,
    days_until_event: 30,
    section_label: "102",
    delivery_method: "mobile_ticket",
    purchase_channel: "primary_box_office",
    mobile_transfer_enabled: true,
  };
  const wrapped = JSON.stringify({ event_ticket_booking: [ticket] });
  await expect(gradeIfstruct(fixture, wrapped)).resolves.toMatchObject({ passed: true });
  await expect(gradeIfstruct(fixture, JSON.stringify([ticket]))).resolves.toMatchObject({ passed: false });
  await expect(gradeIfstruct(fixture, JSON.stringify({ event_ticket_booking: [ticket, ticket] })))
    .resolves.toMatchObject({ passed: false });
  await expect(gradeIfstruct(fixture, `Here is the answer: ${wrapped}`)).resolves.toMatchObject({ passed: false });
});

it("validates fenced YAML and rejects a missing fence", async () => {
  const { fixture } = IFSTRUCT_CASES[3];
  await expect(gradeIfstruct(fixture, `\`\`\`yaml\n${invoice}\n\`\`\``)).resolves.toMatchObject({
    passed: true, details: { yaml_valid: true, uses_code_block: true, was_wrapped: true },
  });
  await expect(gradeIfstruct(fixture, invoice)).resolves.toMatchObject({
    passed: false, details: { yaml_valid: true, uses_code_block: false },
  });
});

it("separates validator startup and input limits from model errors", async () => {
  const { fixture } = IFSTRUCT_CASES[0];
  await expect(gradeIfstruct(fixture, "x".repeat(128 * 1024))).resolves.toBeNull();
  vi.stubEnv("IFSTRUCT_PYTHON", "/nonexistent-ifstruct-python");
  await expect(gradeIfstruct(fixture, "[]")).resolves.toBeNull();
});
