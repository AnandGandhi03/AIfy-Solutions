# AIfy website, AIfy Agent and the live dealership demo

Two separate AI agents run on this site:

| | AIfy Agent | Live demo (Harbour Lane Motors) |
|---|---|---|
| Where | Chat button on every page | `/demo` page, plus an optional real phone number |
| Job | Answers questions about AIfy, recommends the demo, books discovery calls (captures leads) | Plays a dealership service desk end to end: answers the call, answers questions, checks the schedule, books, texts a confirmation, briefs the advisor, logs a call summary |
| Code | `netlify/functions/agent/` + `public/agent/` | `netlify/lib/dealer/` (shared brain), `netlify/functions/demo/` (web voice call), `netlify/functions/voice/` (phone line), `public/demo/demo.js` |

A third tool, the **free AI visibility check** (`/ai-visibility`, code in `netlify/functions/visibility/` and `netlify/lib/visibility.mjs`), is our GEO / AEO lead magnet: it asks an AI with live web search six customer questions about the visitor's business type and city, and reports whether they're named, who's named instead, which sources were used and what to fix.

Every lead lands in **Netlify Blobs** (store `leads`), and also by email or webhook if you set those up: chat leads, demo-page form requests, and every call to the demo phone line (caller number, transcript, outcome).

## 1. Deploy (about 10 minutes)

1. Put this folder in a Git repo and create a Netlify site from it (or `npm i -g netlify-cli` then `netlify deploy --prod`). Drag-and-drop deploys don't run functions.
2. **Site configuration → Environment variables**:

| Variable | Needed for | Notes |
|---|---|---|
| `ANTHROPIC_API_KEY` | Everything AI | From console.anthropic.com. **Set a monthly spend limit there.** |
| `ALLOWED_ORIGINS` | Recommended | `https://aify.solutions,https://www.aify.solutions` |
| `BOOKING_URL` | Recommended | Cal.com or Calendly link. AIfy Agent offers it to interested visitors. |
| `RESEND_API_KEY` | Lead emails | Verified sending domain in Resend. `LEAD_EMAIL_TO` defaults to info@aify.solutions. |
| `LEAD_WEBHOOK_URL` | Optional | Leads as JSON to Zapier, Make, Slack or a CRM. |
| `ANTHROPIC_MODEL` | Optional | AIfy Agent model. Default `claude-sonnet-5-5`. |
| `DEMO_MODEL` / `VOICE_MODEL` | Optional | Demo models. Default `claude-haiku-5-5` (fast replies matter on a call). |

3. Redeploy, open `/demo`, press **Start the call**, allow the microphone and book an oil change.

## 2. Turn on the real demo phone line (Twilio, about 20 minutes)

1. Buy a local number in Twilio (a 604 or 778 number works well for BC prospects).
2. Number settings → Voice: **A call comes in** → Webhook, `POST https://aify.solutions/api/voice`.
   **Call status changes** → `POST https://aify.solutions/api/voice?event=status`.
3. Add env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` (also used to verify that requests really come from Twilio), `DEMO_PHONE_NUMBER` (e.g. `+16045550199`, shown on `/demo` and used to send texts). Optional: `TRANSFER_TO_NUMBER` (your cell: callers who ask for a person are put through to it), `TWILIO_VOICE` (default `Polly.Joanna-Neural`), `PUBLIC_BASE_URL` (`https://aify.solutions`, if signature checks fail behind a custom domain).
4. Call it. It books, sends a **real confirmation text** to the caller with a link back to aify.solutions/demo, and when the call ends you get the caller's number, transcript and outcome as a lead.

Texts to US numbers need A2P 10DLC registration in Twilio; Canadian numbers are simpler. Netlify functions time out after 10 seconds by default (26 on paid plans); the voice line uses the fast model and short replies to stay well inside that.

## 3. Included pages

Home, Live demo, Dealerships, Solutions, How we work, About, Contact, Blog (7 articles with structured data, RSS at `/blog/feed.xml`), Privacy, Terms, Thanks and 404, plus `sitemap.xml`, `robots.txt` (AI crawlers allowed) and `llms.txt` for AI assistants. See **DEPLOY.md** for the step-by-step launch.

## How the demo works

- The web demo uses the browser's own speech recognition and voices (Chrome, Edge, Safari). Visitors can always type instead.
- Tools the demo agent uses: `check_schedule`, `book_appointment`, `send_confirmation_text`, `notify_advisor`, `lookup_service_info` (sample price list, hours and policies), `check_recalls`, `repair_status`, `transfer_to_person`, `end_call`. Each one also lights up a step in the "What your team sees, live" panel.
- Store data is sample data (`netlify/lib/dealer/tools.mjs`). For a client build, these tools are where we connect the real scheduler, DMS, SMS and CRM.
- Change what either agent knows or how it behaves in its `prompt.mjs`.

## Safety and cost controls

API keys stay on the server. Messages are length-capped; demo calls end after 10 minutes; the phone line ends after 30 turns or 3 silences; replies are short. Agents never quote AIfy prices, never invent clients or results, and say they're AI. Each visitor message is one to three API calls; check Anthropic's current pricing and keep the spend limit on.
