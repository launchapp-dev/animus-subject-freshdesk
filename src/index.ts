import { definePlugin, PluginKind, type Subject, type SubjectBackend, type SubjectCreateRequest, type SubjectListParams, type SubjectPatch, type SubjectStatus } from "@launchapp-dev/animus-plugin-sdk";

const NAME = "animus-subject-freshdesk";
const VERSION = "0.1.0";
const SUBJECT_KIND = "freshdesk.ticket";

interface Config {
  baseUrl: string;
  apiKey: string;
  requesterEmail?: string;
  source: number;
}

interface FreshdeskTicket {
  id: number;
  subject?: string;
  description_text?: string;
  description?: string;
  status?: number;
  priority?: number;
  requester_id?: number;
  responder_id?: number | null;
  email?: string;
  tags?: string[];
  type?: string | null;
  source?: number;
  created_at?: string;
  updated_at?: string;
  due_by?: string | null;
  fr_due_by?: string | null;
  is_escalated?: boolean;
  custom_fields?: Record<string, unknown>;
}

function optionalEnv(name: string): string | undefined {
  const raw = process.env[name]?.trim();
  return raw === "" ? undefined : raw;
}

function readConfig(): Config {
  const apiKey = optionalEnv("FRESHDESK_API_KEY");
  const domain = optionalEnv("FRESHDESK_DOMAIN");
  const base = optionalEnv("FRESHDESK_BASE_URL") ?? (domain ? `https://${domain.replace(/^https?:\/\//, "").replace(/\/+$/, "")}` : undefined);
  if (!apiKey) throw new Error("FRESHDESK_API_KEY is required");
  if (!base) throw new Error("FRESHDESK_DOMAIN or FRESHDESK_BASE_URL is required");
  return {
    baseUrl: base.replace(/\/+$/, ""),
    apiKey,
    requesterEmail: optionalEnv("FRESHDESK_REQUESTER_EMAIL"),
    source: Number(optionalEnv("FRESHDESK_SOURCE") ?? 2),
  };
}

function ticketId(id: string | number): string {
  return `${SUBJECT_KIND}:${id}`;
}

function parseTicketId(id: string): string {
  const raw = id.startsWith(`${SUBJECT_KIND}:`) ? id.slice(`${SUBJECT_KIND}:`.length) : id;
  if (/^\d+$/.test(raw)) return raw;
  throw new Error(`expected id '${SUBJECT_KIND}:<ticket-id>', got '${id}'`);
}

function toIso(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const millis = Date.parse(value);
  return Number.isFinite(millis) ? new Date(millis).toISOString() : undefined;
}

function statusFromTicket(ticket: FreshdeskTicket): SubjectStatus {
  switch (ticket.status) {
    case 3:
      return "in-progress";
    case 4:
    case 5:
      return "done";
    case 6:
      return "cancelled";
    case 2:
    default:
      return "ready";
  }
}

function nativeStatusFor(status: SubjectStatus | undefined): number | undefined {
  if (!status) return undefined;
  if (status === "blocked" || status === "in-progress") return 3;
  if (status === "done") return 4;
  if (status === "cancelled") return 5;
  return 2;
}

function nativeStatusName(value: number | undefined): string | undefined {
  switch (value) {
    case 2:
      return "Open";
    case 3:
      return "Pending";
    case 4:
      return "Resolved";
    case 5:
      return "Closed";
    case 6:
      return "Cancelled";
    default:
      return value === undefined ? undefined : String(value);
  }
}

function subjectFromTicket(ticket: FreshdeskTicket): Subject {
  const created = toIso(ticket.created_at) ?? toIso(ticket.updated_at) ?? new Date().toISOString();
  const updated = toIso(ticket.updated_at) ?? created;
  return {
    id: ticketId(ticket.id),
    kind: SUBJECT_KIND,
    title: ticket.subject ?? String(ticket.id),
    description: ticket.description_text || ticket.description || undefined,
    status: statusFromTicket(ticket),
    created_at: created,
    updated_at: updated,
    labels: ticket.tags ?? [],
    assignee: ticket.responder_id === null || ticket.responder_id === undefined ? undefined : String(ticket.responder_id),
    url: `${ticket.id}`,
    native_status: nativeStatusName(ticket.status),
    priority: ticket.priority,
    custom: {
      freshdesk_id: ticket.id,
      requester_id: ticket.requester_id,
      responder_id: ticket.responder_id,
      email: ticket.email,
      type: ticket.type,
      source: ticket.source,
      due_by: ticket.due_by,
      fr_due_by: ticket.fr_due_by,
      is_escalated: ticket.is_escalated,
      custom_fields: ticket.custom_fields,
    },
  };
}

function matchesFilters(ticket: FreshdeskTicket, params: SubjectListParams): boolean {
  const subject = subjectFromTicket(ticket);
  if (params.status && params.status.length > 0 && !params.status.includes(subject.status)) return false;
  if (params.assignee && params.assignee.length > 0 && (!subject.assignee || !params.assignee.includes(subject.assignee))) return false;
  const labels = new Set(subject.labels ?? []);
  if (params.labels_all && !params.labels_all.every((label) => labels.has(label))) return false;
  if (params.labels_any && params.labels_any.length > 0 && !params.labels_any.some((label) => labels.has(label))) return false;
  if (params.updated_since && new Date(subject.updated_at) < new Date(params.updated_since)) return false;
  return true;
}

function priorityFor(value: number | undefined): number | undefined {
  if (value === undefined) return undefined;
  return Math.max(1, Math.min(Math.round(value), 4));
}

function numericIdFor(value: string | null | undefined, field: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (/^\d+$/.test(value)) return Number(value);
  throw new Error(`${field} must be a numeric Freshdesk id`);
}

function createPayload(config: Config, params: SubjectCreateRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    subject: params.title,
    description: params.description ?? params.title,
    status: nativeStatusFor(params.status) ?? 2,
    priority: priorityFor(params.priority) ?? 2,
    source: config.source,
    tags: params.labels,
  };
  const requesterId = params.custom?.requester_id;
  if (typeof requesterId === "number") body.requester_id = requesterId;
  else body.email = typeof params.custom?.email === "string" ? params.custom.email : config.requesterEmail;
  if (!body.email && !body.requester_id) throw new Error("FRESHDESK_REQUESTER_EMAIL or custom.requester_id/custom.email is required for create");
  const responderId = numericIdFor(params.assignee, "assignee");
  if (typeof responderId === "number") body.responder_id = responderId;
  if (typeof params.custom?.type === "string") body.type = params.custom.type;
  if (params.custom?.custom_fields && typeof params.custom.custom_fields === "object" && !Array.isArray(params.custom.custom_fields)) body.custom_fields = params.custom.custom_fields;
  return body;
}

function updatePayload(patch: SubjectPatch, current?: FreshdeskTicket): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const status = nativeStatusFor(patch.status);
  if (status !== undefined) body.status = status;
  if (patch.assignee !== undefined) body.responder_id = numericIdFor(patch.assignee, "assignee");
  if (patch.labels_add || patch.labels_remove) {
    const labels = new Set(current?.tags ?? []);
    for (const label of patch.labels_add ?? []) labels.add(label);
    for (const label of patch.labels_remove ?? []) labels.delete(label);
    body.tags = [...labels];
  }
  if (patch.custom && typeof patch.custom.subject === "string") body.subject = patch.custom.subject;
  if (patch.custom && typeof patch.custom.description === "string") body.description = patch.custom.description;
  if (patch.custom && typeof patch.custom.priority === "number") body.priority = priorityFor(patch.custom.priority);
  if (patch.custom && typeof patch.custom.type === "string") body.type = patch.custom.type;
  if (patch.custom?.custom_fields && typeof patch.custom.custom_fields === "object" && !Array.isArray(patch.custom.custom_fields)) body.custom_fields = patch.custom.custom_fields;
  return body;
}

class FreshdeskClient {
  constructor(private readonly config: Config) {}

  async request<T>(path: string, init: RequestInit = {}, params: Record<string, string | undefined> = {}): Promise<T> {
    const url = new URL(`${this.config.baseUrl}/api/v2${path}`);
    for (const [key, value] of Object.entries(params)) if (value !== undefined) url.searchParams.set(key, value);
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Basic ${Buffer.from(`${this.config.apiKey}:X`).toString("base64")}`);
    headers.set("Accept", "application/json");
    if (init.body !== undefined && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
    const response = await fetch(url, { ...init, headers });
    const text = await response.text();
    if (!response.ok) throw new Error(`Freshdesk API ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  async list(params: SubjectListParams): Promise<FreshdeskTicket[]> {
    const page = params.cursor && /^\d+$/.test(params.cursor) ? params.cursor : "1";
    const perPage = String(Math.max(1, Math.min(params.limit ?? 100, 100)));
    return this.request<FreshdeskTicket[]>("/tickets", {}, {
      page,
      per_page: perPage,
      order_by: "updated_at",
      order_type: "desc",
      updated_since: params.updated_since,
    });
  }

  async get(id: string): Promise<FreshdeskTicket> {
    return this.request<FreshdeskTicket>(`/tickets/${encodeURIComponent(id)}`);
  }

  async create(params: SubjectCreateRequest): Promise<FreshdeskTicket> {
    return this.request<FreshdeskTicket>("/tickets", {
      method: "POST",
      body: JSON.stringify(createPayload(this.config, params)),
    });
  }

  async update(id: string, patch: SubjectPatch): Promise<FreshdeskTicket> {
    const needsCurrent = (patch.labels_add?.length ?? 0) > 0 || (patch.labels_remove?.length ?? 0) > 0;
    const current = needsCurrent ? await this.get(id) : undefined;
    const body = updatePayload(patch, current);
    if (Object.keys(body).length > 0) {
      await this.request<FreshdeskTicket>(`/tickets/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify(body),
      });
    }
    if (patch.comment) await this.note(id, patch.comment);
    return this.get(id);
  }

  async note(id: string, body: string): Promise<void> {
    await this.request(`/tickets/${encodeURIComponent(id)}/notes`, {
      method: "POST",
      body: JSON.stringify({ body, private: true }),
    });
  }
}

function buildBackend(): SubjectBackend {
  let cached: { client: FreshdeskClient } | null = null;
  const runtime = (): { client: FreshdeskClient } => {
    cached ??= { client: new FreshdeskClient(readConfig()) };
    return cached;
  };
  return {
    async list(params) {
      const { client } = runtime();
      const page = params.cursor && /^\d+$/.test(params.cursor) ? Number(params.cursor) : 1;
      const rawTickets = await client.list(params);
      const tickets = rawTickets.filter((ticket) => matchesFilters(ticket, params));
      return {
        subjects: tickets.map(subjectFromTicket),
        next_cursor: rawTickets.length >= (params.limit ?? 100) ? String(page + 1) : null,
        fetched_at: new Date().toISOString(),
      };
    },
    async get(params) {
      const { client } = runtime();
      return subjectFromTicket(await client.get(parseTicketId(params.id)));
    },
    async create(params) {
      const { client } = runtime();
      return subjectFromTicket(await client.create(params));
    },
    async update(params) {
      const { client } = runtime();
      return subjectFromTicket(await client.update(parseTicketId(params.id), params.patch));
    },
    async status(params) {
      const { client } = runtime();
      return subjectFromTicket(await client.update(parseTicketId(params.id), { status: params.status }));
    },
    schema() {
      return {
        kinds: [SUBJECT_KIND],
        status_values: ["ready", "in-progress", "blocked", "done", "cancelled"],
        supports_watch: false,
        supports_create: true,
        supports_pagination: true,
        native_status_values: ["Open", "Pending", "Resolved", "Closed"],
        status_dispatch_hints: [
          { native_status: "Open", status: "ready" },
          { native_status: "Pending", status: "in-progress" },
          { native_status: "Resolved", status: "done" },
        ],
        custom_fields: ["freshdesk_id", "requester_id", "responder_id", "email", "type", "source", "due_by", "fr_due_by", "is_escalated", "custom_fields"],
      };
    },
    async health() {
      try {
        const { client } = runtime();
        await client.request("/agents/me");
        return { status: "healthy", uptime_ms: null, memory_usage_bytes: null, last_error: null };
      } catch (err) {
        return { status: "unhealthy", uptime_ms: null, memory_usage_bytes: null, last_error: String(err) };
      }
    },
  };
}

export { FreshdeskClient, createPayload, matchesFilters, nativeStatusFor, parseTicketId, statusFromTicket, subjectFromTicket, toIso, updatePayload };

const plugin = definePlugin({
  kind: PluginKind.SubjectBackend,
  name: NAME,
  version: VERSION,
  description: "Freshdesk tickets subject backend plugin for Animus",
  subject_kinds: [SUBJECT_KIND],
  env_required: [
    { name: "FRESHDESK_API_KEY", description: "Freshdesk API key.", required: true, sensitive: true },
    { name: "FRESHDESK_DOMAIN", description: "Freshdesk domain, for example example.freshdesk.com. FRESHDESK_BASE_URL is accepted as an alternative.", required: false },
    { name: "FRESHDESK_BASE_URL", description: "Freshdesk base URL, for example https://example.freshdesk.com.", required: false },
    { name: "FRESHDESK_REQUESTER_EMAIL", description: "Default requester email used for create calls.", required: false },
    { name: "FRESHDESK_SOURCE", description: "Default source id used for create calls. Defaults to 2.", required: false },
  ],
  impl: buildBackend(),
});

function isDirectRun(): boolean {
  const entry = process.argv[1] ?? "";
  return entry.endsWith("index.cjs") || entry.endsWith("index.js") || entry.endsWith(NAME);
}

if (isDirectRun()) {
  plugin.run().catch((err) => {
    process.stderr.write(`[${NAME}] fatal: ${String(err)}\n`);
    process.exit(1);
  });
}
