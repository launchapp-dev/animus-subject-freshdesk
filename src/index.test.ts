import { describe, expect, it } from "vitest";
import { createPayload, matchesFilters, nativeStatusFor, parseTicketId, statusFromTicket, subjectFromTicket, toIso, updatePayload } from "./index.js";

const config = {
  baseUrl: "https://acme.freshdesk.com",
  apiKey: "key",
  requesterEmail: "sam@example.com",
  source: 2,
};

const ticket = {
  id: 42,
  subject: "Checkout question",
  description_text: "Customer cannot check out.",
  status: 3,
  priority: 3,
  requester_id: 1001,
  responder_id: 2002,
  email: "customer@example.com",
  tags: ["billing", "checkout"],
  type: "Question",
  source: 2,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-02T00:00:00Z",
  due_by: "2026-01-03T00:00:00Z",
  is_escalated: true,
  custom_fields: { cf_plan: "pro" },
};

describe("Freshdesk subject mapping", () => {
  it("parses canonical ids and raw ids", () => {
    expect(parseTicketId("freshdesk.ticket:42")).toBe("42");
    expect(parseTicketId("42")).toBe("42");
    expect(() => parseTicketId("freshdesk.ticket:x")).toThrow(/expected id/);
  });

  it("maps statuses", () => {
    expect(statusFromTicket({ id: 1, status: 2 })).toBe("ready");
    expect(statusFromTicket({ id: 1, status: 3 })).toBe("in-progress");
    expect(statusFromTicket({ id: 1, status: 4 })).toBe("done");
    expect(statusFromTicket({ id: 1, status: 5 })).toBe("done");
    expect(statusFromTicket({ id: 1, status: 6 })).toBe("cancelled");
    expect(nativeStatusFor("blocked")).toBe(3);
    expect(nativeStatusFor("done")).toBe(4);
    expect(nativeStatusFor("cancelled")).toBe(5);
  });

  it("builds create and update payloads", () => {
    expect(createPayload(config, { kind: "freshdesk.ticket", title: "New ticket", description: "Text", status: "done", labels: ["billing"], assignee: "2002", priority: 4 })).toEqual({
      subject: "New ticket",
      description: "Text",
      status: 4,
      priority: 4,
      source: 2,
      tags: ["billing"],
      email: "sam@example.com",
      responder_id: 2002,
    });
    expect(updatePayload({ status: "blocked", labels_add: ["blocked"], labels_remove: ["checkout"], assignee: null, custom: { subject: "Blocked ticket", priority: 1 } }, ticket)).toEqual({
      status: 3,
      responder_id: null,
      tags: ["billing", "blocked"],
      subject: "Blocked ticket",
      priority: 1,
    });
  });

  it("validates Freshdesk-specific create requirements", () => {
    expect(() => createPayload({ ...config, requesterEmail: undefined }, { kind: "freshdesk.ticket", title: "No requester" })).toThrow(/requester/i);
    expect(() => createPayload(config, { kind: "freshdesk.ticket", title: "Bad assignee", assignee: "agent@example.com" })).toThrow(/numeric Freshdesk id/);
  });

  it("applies filters and date conversion", () => {
    expect(toIso("2026-01-01T00:00:00Z")).toBe("2026-01-01T00:00:00.000Z");
    expect(matchesFilters(ticket, { labels_all: ["billing"], assignee: ["2002"] })).toBe(true);
    expect(matchesFilters(ticket, { labels_all: ["support"] })).toBe(false);
    expect(matchesFilters(ticket, { status: ["ready"] })).toBe(false);
    expect(matchesFilters(ticket, { updated_since: "2026-02-01T00:00:00.000Z" })).toBe(false);
  });

  it("emits required Animus subject fields", () => {
    expect(subjectFromTicket(ticket)).toMatchObject({
      id: "freshdesk.ticket:42",
      kind: "freshdesk.ticket",
      title: "Checkout question",
      assignee: "2002",
      native_status: "Pending",
      status: "in-progress",
      priority: 3,
      labels: ["billing", "checkout"],
    });
  });
});
