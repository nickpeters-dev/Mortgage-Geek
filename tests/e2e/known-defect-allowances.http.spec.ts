// Tests for the test harness: proves the known-defect allowances in
// support/knownDefects.ts are narrow. Each allowance must apply ONLY with its
// defect's evidence present, and must reject look-alike errors. Pure function
// calls, no browser, so this runs in the "http" project.
import { test, expect } from "@playwright/test";
import { explainByKnownDefect, hasD2Signature } from "./support/knownDefects";

const BASE = "http://localhost:4321";
const BROKEN_CSS = `<html><head><style>body{font-family:&#x27;Figtree&#x27;}</style></head></html>`;
const CLEAN_CSS = `<html><head><style>body{font-family:'Figtree'}</style></head></html>`;
const brokenPage = { url: `${BASE}/about`, html: BROKEN_CSS };
const cleanPage = { url: `${BASE}/about`, html: CLEAN_CSS };
const HYDRATION = "uncaught exception: Minified React error #418; visit https://reactjs.org/...";

test("D-2 signature: entities inside <style> only", () => {
  expect(hasD2Signature(BROKEN_CSS)).toBe(true);
  expect(hasD2Signature(CLEAN_CSS)).toBe(false);
  // Entities in normal page text are correct HTML, not the defect.
  expect(hasD2Signature(`<p>Tom &amp; Jerry&#x27;s</p><style>a{color:red}</style>`)).toBe(false);
});

test("D-2: hydration errors are tolerated only when every loaded page carries the signature", () => {
  expect(explainByKnownDefect(HYDRATION, { baseURL: BASE, documents: [brokenPage] })).toBe("D-2");
  expect(explainByKnownDefect(HYDRATION, { baseURL: BASE, documents: [cleanPage] })).toBeNull();
  expect(explainByKnownDefect(HYDRATION, { baseURL: BASE, documents: [brokenPage, cleanPage] })).toBeNull();
  expect(explainByKnownDefect(HYDRATION, { baseURL: BASE, documents: [] })).toBeNull();
});

test("D-2: other React errors are never tolerated", () => {
  const other = "uncaught exception: Minified React error #301; visit ...";
  expect(explainByKnownDefect(other, { baseURL: BASE, documents: [brokenPage] })).toBeNull();
});

test("D-2: only the exact relative '&' URL 404 is tolerated, and only for a broken page", () => {
  const nested = { url: `${BASE}/deep-dives/gift-funds`, html: BROKEN_CSS };
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/&`, { baseURL: BASE, documents: [brokenPage] })).toBe("D-2");
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/deep-dives/&`, { baseURL: BASE, documents: [nested] })).toBe("D-2");
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/&`, { baseURL: BASE, documents: [cleanPage] })).toBeNull();
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/logo.png`, { baseURL: BASE, documents: [brokenPage] })).toBeNull();
  expect(explainByKnownDefect(`HTTP 500 ${BASE}/&`, { baseURL: BASE, documents: [brokenPage] })).toBeNull();
});

test("D-3a: only a 404 for exactly /manifest.json is tolerated", () => {
  const ctx = { baseURL: BASE, documents: [cleanPage] };
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/manifest.json`, ctx)).toBe("D-3a");
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/geeklog.webmanifest`, ctx)).toBeNull();
  expect(explainByKnownDefect(`HTTP 404 ${BASE}/manifest.json?v=2`, ctx)).toBeNull();
  expect(explainByKnownDefect(`HTTP 500 ${BASE}/manifest.json`, ctx)).toBeNull();
});

test("unrelated errors are never explained", () => {
  const ctx = { baseURL: BASE, documents: [brokenPage] };
  for (const e of [
    "console.error: TypeError: Cannot read properties of undefined",
    "uncaught exception: NaN payment",
    `HTTP 404 ${BASE}/assets/entry.client.js`,
    `HTTP 501 ${BASE}/api/prospects`,
  ]) {
    expect(explainByKnownDefect(e, ctx), e).toBeNull();
  }
});
