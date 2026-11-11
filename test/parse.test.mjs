// Tests for event parsing and time formatting.
// Run with: node --test test/
//
// The fixtures mirror titles produced by the UniFi Protect integration's media source.
// If the integration changes its title format, these tests document what the card expects.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function loadCard() {
  const src = readFileSync(new URL("../dist/protect-camera-card.js", import.meta.url), "utf8");
  const registry = new Map();
  const ctx = {
    HTMLElement: class {},
    customElements: {
      get: (n) => registry.get(n),
      define: (n, c) => registry.set(n, c),
    },
    console: { info() {}, warn() {}, log() {} },
    Date,
    Intl,
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return registry.get("protect-camera-card")._internals;
}

const { parseEvent, fmtTime, pickLang, I18N } = loadCard();

// 0x67300000 = 1731198976 s
const ID = "67300000aaaaaaaaaaaaaaaa";
const item = (title) => ({
  media_content_id: `media-source://unifiprotect/nvr1:event:${ID}`,
  title,
  thumbnail: "/api/thumb",
});

test("timestamp is read from the ObjectId", () => {
  assert.equal(parseEvent(item("Motion Event")).ts, 0x67300000 * 1000);
});

test("ring event", () => {
  const ev = parseEvent(item("13:05:10 3s Ring Event"), I18N.en);
  assert.equal(ev.kind, "ring");
  assert.equal(ev.label, "Doorbell");
  assert.equal(ev.recognized, true);
});

test("motion event", () => {
  const ev = parseEvent(item("13:05:10 12s Motion Event"), I18N.nb);
  assert.equal(ev.kind, "motion");
  assert.equal(ev.label, "Bevegelse");
  assert.equal(ev.duration, "12s");
  assert.equal(ev.clock, "13:05");
});

test("object detection, several objects, first decides kind", () => {
  const ev = parseEvent(item("13:05:10 1m 4s Object Detection - vehicle, license plate"), I18N.nb);
  assert.equal(ev.kind, "vehicle");
  assert.equal(ev.label, "Kjøretøy, Skilt");
  assert.equal(ev.duration, "1m 4s");
});

test("object detection in English capitalises raw names", () => {
  const ev = parseEvent(item("Object Detection - person"), I18N.en);
  assert.equal(ev.kind, "person");
  assert.equal(ev.label, "Person");
});

test("audio detection", () => {
  const ev = parseEvent(item("Audio Detection - smoke, baby cry"), I18N.nb);
  assert.equal(ev.kind, "audio");
  assert.equal(ev.label, "Lyd: Røykvarsler, Babygråt");
});

test("unknown title is flagged as not recognized", () => {
  const ev = parseEvent(item("Something new from Protect"), I18N.en);
  assert.equal(ev.kind, "other");
  assert.equal(ev.recognized, false);
});

test("non-ObjectId id gives no timestamp", () => {
  const ev = parseEvent({ media_content_id: "x:abc", title: "Motion Event" });
  assert.equal(ev.ts, null);
});

test("fmtTime: today, yesterday, older", () => {
  const now = new Date(2026, 10, 12, 10, 0);
  const at = (d, h) => ({ ts: new Date(2026, 10, d, h, 30).getTime() });
  assert.match(fmtTime(at(12, 8), I18N.en, "en-GB", now), /^08:30$/);
  assert.match(fmtTime(at(11, 23), I18N.nb, "nb-NO", now), /^i går 23:30$/);
  assert.doesNotMatch(fmtTime(at(9, 8), I18N.en, "en-GB", now), /yesterday/);
});

test("pickLang", () => {
  assert.equal(pickLang({}, { locale: { language: "nb" } }), "nb");
  assert.equal(pickLang({}, { locale: { language: "nn" } }), "nb");
  assert.equal(pickLang({}, { locale: { language: "de" } }), "en");
  assert.equal(pickLang({ language: "en" }, { locale: { language: "nb" } }), "en");
  assert.equal(pickLang({}, undefined), "en");
});
