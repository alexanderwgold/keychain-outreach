import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseCSVRows } from "./parse.ts";

// The exact header row from the Salesforce export.
const HEADER =
  "Account Name,manufacturer_id,first_name,last_name,email,title," +
  "opportunity_name,Opp Owner,stage_name,close_date,amount,next_step," +
  "next_steps_c,description,id,opportunity_id,account_id";

Deno.test("parseCSVRows: extracts contact fields correctly", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,john@acme.com,VP Sourcing,' +
    'Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025",,,,,' +
    '"003ABC","006ABC","001ABC"';

  const rows = parseCSVRows(csv);
  assertEquals(rows.length, 1);
  assertEquals(rows[0].contact.sf_contact_id, "003ABC");
  assertEquals(rows[0].contact.first_name, "John");
  assertEquals(rows[0].contact.last_name, "Doe");
  assertEquals(rows[0].contact.email, "john@acme.com");
  assertEquals(rows[0].contact.title, "VP Sourcing");
});

Deno.test("parseCSVRows: extracts opportunity fields correctly", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,john@acme.com,VP Sourcing,' +
    'Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025","1,500",,,,,' +
    '"003ABC","006ABC","001ABC"';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.account_name, "Acme Co");
  assertEquals(rows[0].opportunity.sf_opportunity_id, "006ABC");
  assertEquals(rows[0].opportunity.sf_account_id, "001ABC");
  assertEquals(rows[0].opportunity.manufacturer_id, "54,682");
  assertEquals(rows[0].opportunity.opp_owner, "Wesley Phillips");
  assertEquals(rows[0].opportunity.stage_name, "Revival");
  assertEquals(rows[0].opportunity.close_date, "2025-08-31");
  assertEquals(rows[0].opportunity.amount, 1500);
});

Deno.test("parseCSVRows: null email and title when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].contact.email, null);
  assertEquals(rows[0].contact.title, null);
});

Deno.test("parseCSVRows: null close_date when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.close_date, null);
});

Deno.test("parseCSVRows: null amount when blank", () => {
  const csv =
    HEADER +
    "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.amount, null);
});

Deno.test("parseCSVRows: parses close_date 'Aug 31, 2025' → '2025-08-31'", () => {
  const csv =
    HEADER +
    '\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,"Aug 31, 2025",,,,,' +
    "003ABC,006ABC,001ABC";

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.close_date, "2025-08-31");
});

Deno.test("parseCSVRows: parses amount '1,500' → 1500", () => {
  const csv =
    HEADER +
    '\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,"1,500",,,,003ABC,006ABC,001ABC';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.amount, 1500);
});

Deno.test("parseCSVRows: marks first contact per opportunity as primary", () => {
  const csv = [
    HEADER,
    "Acme Co,,John,Doe,john@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003AAA,006ABC,001ABC",
    "Acme Co,,Jane,Smith,jane@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003BBB,006ABC,001ABC",
  ].join("\n");

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].isPrimaryContact, true);
  assertEquals(rows[1].isPrimaryContact, false);
});

Deno.test("parseCSVRows: same contact on two opps is primary for each", () => {
  const csv = [
    HEADER,
    "Acme Co,,John,Doe,john@acme.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003AAA,006AAA,001ABC",
    "Beta Corp,,John,Doe,john@acme.com,,Beta Opp,Wesley Phillips,Revival,,,,,,003AAA,006BBB,001XYZ",
  ].join("\n");

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].isPrimaryContact, true); // primary for 006AAA
  assertEquals(rows[1].isPrimaryContact, true); // primary for 006BBB
});

Deno.test("parseCSVRows: manufacturer_id with comma is preserved as string", () => {
  const csv =
    HEADER +
    '\nAcme Co,"54,682",John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC';

  const rows = parseCSVRows(csv);
  assertEquals(rows[0].opportunity.manufacturer_id, "54,682");
});

Deno.test("parseCSVRows: skips empty trailing lines", () => {
  const csv = HEADER + "\nAcme Co,,John,Doe,j@a.com,,Acme Opp,Wesley Phillips,Revival,,,,,,003ABC,006ABC,001ABC\n\n";
  const rows = parseCSVRows(csv);
  assertEquals(rows.length, 1);
});
