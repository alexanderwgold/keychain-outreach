import { assertEquals } from "https://deno.land/std@0.208.0/assert/mod.ts";
import { parseMetabaseCSV, type MetabaseChunk } from "./parse.ts";

const HEADER =
  "manufacturer_name,salesforce_account_name," +
  "tagged_micro_cat_projects_last_365_days,tagged_micro_cat_projects_last_90_days," +
  "tagged_micro_cat_verified_projects_last_365_days,tagged_micro_cat_verified_projects_last_90_days," +
  "tagged_micro_cat_views_last_90_days,tagged_micro_cat_views_last_365_days";

Deno.test("parseMetabaseCSV: parses a simple row into a chunk", () => {
  const csv = HEADER + "\nTea India,Tea India,681,196,219,54,329,1410";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].accountName, "Tea India");
  assertEquals(chunks[0].sourceId, "test-report");
  assertEquals(chunks[0].sourceType, "metabase_report");
  assertEquals(chunks[0].content.includes("196 projects"), true);
  assertEquals(chunks[0].content.includes("Tea India"), true);
});

Deno.test("parseMetabaseCSV: handles commas in numbers", () => {
  const csv = HEADER + '\nBig Co,Big Co,"6,743","1,567","1,915",469,"3,562","14,723"';
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
  assertEquals(chunks[0].metadata.projects_90d, 1567);
  assertEquals(chunks[0].metadata.views_365d, 14723);
});

Deno.test("parseMetabaseCSV: skips rows with zero activity", () => {
  const csv = HEADER + "\nDead Co,Dead Co,0,0,0,0,0,0";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 0);
});

Deno.test("parseMetabaseCSV: uses salesforce_account_name as accountName", () => {
  const csv = HEADER + '\nPlatform Name,"SF Account Name",10,5,3,1,8,20';
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].accountName, "SF Account Name");
});

Deno.test("parseMetabaseCSV: handles empty salesforce_account_name", () => {
  const csv = HEADER + "\nSome Mfr,,10,5,3,1,8,20";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].accountName, "Some Mfr");
});

Deno.test("parseMetabaseCSV: stores numeric metadata", () => {
  const csv = HEADER + "\nAcme,Acme,100,25,50,10,30,200";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks[0].metadata.projects_365d, 100);
  assertEquals(chunks[0].metadata.projects_90d, 25);
  assertEquals(chunks[0].metadata.verified_365d, 50);
  assertEquals(chunks[0].metadata.verified_90d, 10);
  assertEquals(chunks[0].metadata.views_90d, 30);
  assertEquals(chunks[0].metadata.views_365d, 200);
});

Deno.test("parseMetabaseCSV: multiple rows produce multiple chunks", () => {
  const csv = [
    HEADER,
    "A Co,A Co,10,5,3,1,8,20",
    "B Co,B Co,20,10,6,2,16,40",
  ].join("\n");
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 2);
});

Deno.test("parseMetabaseCSV: skips empty trailing lines", () => {
  const csv = HEADER + "\nAcme,Acme,10,5,3,1,8,20\n\n";
  const chunks = parseMetabaseCSV(csv, "test-report");
  assertEquals(chunks.length, 1);
});
