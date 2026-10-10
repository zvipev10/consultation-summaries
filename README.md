# Consultation Summaries API

Backend-only API for recording customer consultation summaries, searching them, and preserving every consultation edit as an immutable revision.

## Stack

- Node.js 24, TypeScript, Express
- Neon Postgres via `@neondatabase/serverless`
- Vercel serverless deployment

## Local setup

```bash
npm install
copy .env.example .env
npm run dev
```

Set `DATABASE_URL` in `.env` to a Neon pooled Postgres connection string. The schema is created automatically on the first request or application start.

## API

### Create a consultation

Creating with customer details finds the customer by normalized phone, email, or external customer ID when possible; otherwise it creates a new customer.

```http
POST /api/consultations
Content-Type: application/json
Authorization: Bearer <HERMES_API_SECRET>
X-Hermes-WhatsApp-Group-Id: 120363432180645142@g.us

{
  "customer": {
    "fullName": "ישראל ישראלי",
    "phone": "050-123-4567",
    "email": "israel@example.com"
  },
  "summary": "Initial consultation summary.",
  "topic": "Onboarding",
  "consultedAt": "2026-10-10T09:00:00+03:00"
}
```

To attach the original handwritten summary screenshot to the initial consultation, add `handwrittenSummaryImage`. It is immutable after creation and accepts JPEG, PNG, or WebP up to 3 MB.

```json
"handwrittenSummaryImage": {
  "fileName": "handwritten-summary.jpg",
  "mimeType": "image/jpeg",
  "base64Data": "...base64-encoded-image..."
}
```

Retrieve it through `GET /api/consultations/42/handwritten-summary-image`. The consultation response contains only safe image metadata, never the image bytes.

Use `customerId` instead of `customer` to add another consultation for an existing customer.

### Search

```http
GET /api/customers/search?query=0501234567
GET /api/consultations?query=ישראל&from=2026-10-01&to=2026-10-31
GET /api/consultations?customerId=12
```

Every `/api/*` request must include the `Authorization` and
`X-Hermes-WhatsApp-Group-Id` headers shown above. The API only accepts the
configured Hermes secret and WhatsApp group ID; `/health` remains public for
Vercel monitoring.

### Read a consultation and its history

```http
GET /api/consultations/42
GET /api/consultations/42/history
```

### Update a consultation

Every update stores a full immutable snapshot, including the summary, topic, and consultation time.

```http
PATCH /api/consultations/42
Content-Type: application/json

{
  "summary": "Updated summary with follow-up information.",
  "changeNote": "Follow-up call"
}
```

## Deployment

Import the GitHub repository into Vercel and configure these environment variables:

- `DATABASE_URL`
- `HERMES_ALLOWED_WHATSAPP_GROUP_ID`
- `HERMES_API_SECRET`

Vercel routes all requests to `api/index.ts`.

## Current access model

All application endpoints are restricted to Hermes requests originating from
the configured WhatsApp group. The secret is server-to-server only and must
never be sent through WhatsApp messages.
