"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { pickProfile, clip, TEXT_LIMITS } = require("../lib/profile");

const KEYS = [...Object.keys(TEXT_LIMITS), "interests", "photoURL", "bookedSlots"].sort();

test("pickProfile keeps the listed fields of a normal profile", () => {
  const slot = { day: "20261124", start: "09:00", end: "09:30", with: "uidB", meetingId: "m1" };
  const p = pickProfile({
    salutation: "Dr", name: "Ama Mensah", company: "Volta Solar", title: "CEO", sector: "Energy",
    country: "Ghana", ptype: "Delegate", website: "https://volta.example", linkedin: "linkedin.com/in/ama",
    bio: "Solar for rural Ghana.", interests: ["Investment", "Partnerships"], av: "AM",
    photoURL: "https://firebasestorage.googleapis.com/v0/b/x/o/photos%2Fu?alt=media", phone: "+233 20 000 0000",
    status: "approved", bookedSlots: [slot],
  });
  assert.deepEqual(Object.keys(p).sort(), KEYS);
  assert.equal(p.name, "Ama Mensah");
  assert.deepEqual(p.interests, ["Investment", "Partnerships"]);
  assert.deepEqual(p.bookedSlots, [slot]);
  assert.match(p.photoURL, /^https:\/\//);
});

test("pickProfile drops timestamps and unknown keys", () => {
  const p = pickProfile({ name: "A", registeredAt: { seconds: 1, nanoseconds: 0 }, email: "a@b.c", source: "x", isAdmin: true });
  assert.deepEqual(Object.keys(p).sort(), KEYS);
  assert.equal("registeredAt" in p, false);
  assert.equal("email" in p, false);
  assert.equal("isAdmin" in p, false);
});

test("pickProfile coerces hostile types", () => {
  const p = pickProfile({
    name: 12345, company: { toString: () => "evil" }, title: ["a", "b"], sector: null, country: undefined,
    ptype: true, bio: NaN, av: Infinity, status: { nested: { deep: 1 } }, interests: "Investment",
    bookedSlots: { day: "20261124" },
  });
  assert.equal(p.name, "12345");
  assert.equal(p.company, "");
  assert.equal(p.title, "");
  assert.equal(p.sector, "");
  assert.equal(p.country, "");
  assert.equal(p.ptype, "true");
  assert.equal(p.bio, "");
  assert.equal(p.av, "");
  assert.equal(p.status, "");
  assert.deepEqual(p.interests, []);
  assert.deepEqual(p.bookedSlots, []);
});

test("pickProfile clips huge strings to each field's limit", () => {
  const huge = "x".repeat(1_000_000);
  const p = pickProfile({ name: huge, bio: huge, salutation: huge, av: huge, sector: huge, website: huge, phone: huge, status: huge });
  assert.equal(p.name.length, 120);
  assert.equal(p.bio.length, 600);
  assert.equal(p.salutation.length, 20);
  assert.equal(p.av.length, 3);
  assert.equal(p.sector.length, 60);
  assert.equal(p.website.length, 200);
  assert.equal(p.phone.length, 40);
  assert.equal(p.status.length, 20);
});

test("pickProfile only keeps an https photoURL of at most 600 chars", () => {
  assert.equal(pickProfile({ photoURL: "javascript:alert(1)" }).photoURL, "");
  assert.equal(pickProfile({ photoURL: " https://x.example/a.png" }).photoURL, "");
  assert.equal(pickProfile({ photoURL: "http://x.example/a.png" }).photoURL, "");
  assert.equal(pickProfile({ photoURL: "data:image/png;base64,AAAA" }).photoURL, "");
  assert.equal(pickProfile({ photoURL: { href: "https://x.example" } }).photoURL, "");
  assert.equal(pickProfile({ photoURL: "https://x.example/" + "a".repeat(600) }).photoURL, "");
  assert.equal(pickProfile({ photoURL: "https://x.example/a.png" }).photoURL, "https://x.example/a.png");
});

test("pickProfile limits interests to 9 strings of 60", () => {
  const p = pickProfile({ interests: [1, { a: 1 }, ["x"], null, ...Array.from({ length: 20 }, (_, i) => "i" + i + "y".repeat(100))] });
  assert.equal(p.interests.length, 9);
  assert.ok(p.interests.every((i) => typeof i === "string" && i.length === 60));
  assert.ok(p.interests[0].startsWith("i0"));
});

test("pickProfile flattens bookedSlots to at most 50 objects of five clipped strings", () => {
  const nasty = {
    day: "20261124", start: { $gt: "" }, end: ["09:30"], with: "u".repeat(500), meetingId: 7,
    extra: "drop me", nested: { deep: { deeper: 1 } },
  };
  const p = pickProfile({ bookedSlots: [null, "slot", 42, ["a"], nasty, ...Array.from({ length: 80 }, () => ({ day: "d" }))] });
  assert.equal(p.bookedSlots.length, 50);
  assert.deepEqual(p.bookedSlots[0], { day: "20261124", start: "", end: "", with: "u".repeat(40), meetingId: "7" });
  for (const s of p.bookedSlots) {
    assert.deepEqual(Object.keys(s), ["day", "start", "end", "with", "meetingId"]);
    assert.ok(Object.values(s).every((v) => typeof v === "string" && v.length <= 40));
  }
});

test("pickProfile tolerates a missing or non-object document", () => {
  for (const doc of [null, undefined, 5, "str", [1, 2]]) {
    const p = pickProfile(doc);
    assert.deepEqual(Object.keys(p).sort(), KEYS);
    assert.equal(p.name, "");
    assert.deepEqual(p.interests, []);
    assert.deepEqual(p.bookedSlots, []);
  }
});

test("clip never leaves half a surrogate pair", () => {
  const s = "a".repeat(119) + "😀";
  assert.equal(clip(s, 120), "a".repeat(119));
  assert.equal(clip("😀", 2), "😀");
});
