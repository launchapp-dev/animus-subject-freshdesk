# animus-subject-freshdesk

Freshdesk ticket subject backend for Animus.

## Install

```bash
animus plugin install launchapp-dev/animus-subject-freshdesk --signature-policy strict
```

## Configuration

Required environment:

- `FRESHDESK_API_KEY`

One of these must also be set:

- `FRESHDESK_DOMAIN`, for example `example.freshdesk.com`
- `FRESHDESK_BASE_URL`, for example `https://example.freshdesk.com`

Optional environment:

- `FRESHDESK_REQUESTER_EMAIL` supplies the requester email for create calls when `custom.email` or `custom.requester_id` is not provided.
- `FRESHDESK_SOURCE` sets the source id for create calls. It defaults to `2`.

## Subject Kind

This plugin serves `freshdesk.ticket` subjects. Subject ids are shaped as:

```text
freshdesk.ticket:42
```

The plugin reads and writes common ticket fields including subject, description,
status, responder id, tags, priority, type, custom fields, and private notes.
Raw Freshdesk identifiers and service fields are preserved in `custom`.
