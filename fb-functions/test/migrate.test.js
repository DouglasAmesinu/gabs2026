"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { planMigration } = require("../lib/migrate");

test("claimed link: a participant's ticket links an existing unclaimed tickets/{ref} doc", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [{ id: "p1", ticket: "GABS-AAAAAA" }],
    existingTickets: { "GABS-AAAAAA": { uid: null } },
  });
  assert.equal(plan.ticketsToLink, 1);
  assert.equal(plan.ticketsToCreate, 0);
  assert.deepEqual(plan.ticketLinks, [{ ref: "GABS-AAAAAA", uid: "p1" }]);
  assert.deepEqual(plan.conflicts, []);
});

test("unclaimed ref: a legacy ref with no claimant just needs an empty tickets/{ref} placeholder", () => {
  const plan = planMigration({
    legacyRefs: ["GABS-BBBBBB"],
    participants: [],
    existingTickets: {},
  });
  assert.equal(plan.refsTotal, 1);
  assert.equal(plan.ticketsToCreate, 1);
  assert.deepEqual(plan.ticketCreates, [{ ref: "GABS-BBBBBB", uid: null }]);
  assert.equal(plan.ticketsToLink, 0);
});

test("duplicate ticket conflict: two participants claiming the same ref are both flagged and neither is linked", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [
      { id: "p1", ticket: "GABS-CCCCCC" },
      { id: "p2", ticket: "GABS-CCCCCC" },
    ],
    existingTickets: { "GABS-CCCCCC": { uid: null } },
  });
  assert.deepEqual(new Set(plan.conflicts), new Set(["p1", "p2"]));
  assert.equal(plan.ticketsToLink, 0);
  assert.equal(plan.participantsToClean, 0);
});

test("existing different uid preserved: a claim against an already-linked-to-someone-else ref is a conflict, not a relink", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [{ id: "p2", ticket: "GABS-DDDDDD" }],
    existingTickets: { "GABS-DDDDDD": { uid: "p1" } },
  });
  assert.deepEqual(plan.conflicts, ["p2"]);
  assert.equal(plan.ticketsToLink, 0);
  assert.equal(plan.ticketsToCreate, 0);
  assert.equal(plan.participantsToClean, 0); // p2 is conflicted, so its ticket field is left alone
});

test("email move: a participant with a non-empty email gets it queued for private/contact + public deletion", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [{ id: "p1", email: "person@example.com" }],
    existingTickets: {},
  });
  assert.equal(plan.emailsToMove, 1);
  assert.deepEqual(plan.emailMoves, [{ id: "p1", email: "person@example.com" }]);
  assert.deepEqual(plan.publicCleanups, [{ id: "p1", deleteEmail: true, deleteTicket: false }]);
});

test("no-email profile: a participant with no email field is not an error and isn't queued", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [{ id: "p1", name: "No Email Here" }],
    existingTickets: {},
  });
  assert.equal(plan.emailsToMove, 0);
  assert.deepEqual(plan.emailMoves, []);
  assert.deepEqual(plan.publicCleanups, []);
});

test("csv skip: a csv_-prefixed participant with no ticket is counted and otherwise ignored", () => {
  const plan = planMigration({
    legacyRefs: [],
    participants: [{ id: "csv_3", name: "Legacy CSV Row" }],
    existingTickets: {},
  });
  assert.equal(plan.csvSkipped, 1);
  assert.equal(plan.refsTotal, 0);
  assert.deepEqual(plan.conflicts, []);
});

test("invalid ref counted: a malformed legacy ref is ignored and tallied, not treated as a real ref", () => {
  const plan = planMigration({
    legacyRefs: ["NOT-A-TICKET", "GABS-EEEEEE"],
    participants: [],
    existingTickets: {},
  });
  assert.equal(plan.invalidRefs, 1);
  assert.equal(plan.refsTotal, 1);
  assert.deepEqual(plan.ticketCreates, [{ ref: "GABS-EEEEEE", uid: null }]);
});

test("idempotence: re-planning against the post-migration state yields zero further actions", () => {
  const legacyRefs = ["GABS-FFFFFF"];
  const participants = [
    { id: "p1", ticket: "GABS-GGGGGG", email: "p1@example.com" },
    { id: "csv_1", name: "Legacy row" },
  ];
  const existingTickets = {};

  const plan1 = planMigration({ legacyRefs, participants, existingTickets });
  assert.equal(plan1.ticketsToCreate, 2); // GABS-FFFFFF (unclaimed) + GABS-GGGGGG (claimed, created+linked in one step)
  assert.equal(plan1.ticketsToLink, 0);
  assert.equal(plan1.emailsToMove, 1);
  assert.equal(plan1.participantsToClean, 1);

  // Simulate applying plan1's writes.
  const existingTicketsAfter = { ...existingTickets };
  plan1.ticketCreates.forEach(({ ref, uid }) => {
    existingTicketsAfter[ref] = { uid };
  });
  plan1.ticketLinks.forEach(({ ref, uid }) => {
    existingTicketsAfter[ref] = { ...existingTicketsAfter[ref], uid };
  });
  const cleanupById = new Map(plan1.publicCleanups.map((c) => [c.id, c]));
  const participantsAfter = participants.map((p) => {
    const c = cleanupById.get(p.id);
    if (!c) return { ...p };
    const next = { ...p };
    if (c.deleteEmail) delete next.email;
    if (c.deleteTicket) delete next.ticket;
    return next;
  });

  const plan2 = planMigration({
    legacyRefs,
    participants: participantsAfter,
    existingTickets: existingTicketsAfter,
  });
  assert.equal(plan2.ticketsToCreate, 0);
  assert.equal(plan2.ticketsToLink, 0);
  assert.equal(plan2.emailsToMove, 0);
  assert.equal(plan2.participantsToClean, 0);
  assert.deepEqual(plan2.conflicts, []);
});
