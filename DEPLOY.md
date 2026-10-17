# Deploy aify.solutions on Netlify: step by step

Everything in this folder is ready. `public/` is the website; `netlify/` is the server code (both AI agents, the demo, the phone line and lead capture). Netlify needs to *build* this folder to run the functions, so use GitHub (recommended) or the Netlify CLI, not drag-and-drop.

## Step 1: Put the folder on GitHub (5 minutes)

1. Go to github.com → **New repository** → name it `aify-website` → Private → Create.
2. On the new repo page click **uploading an existing file**, drag in everything inside this `aify-site` folder (not the folder itself), and **Commit changes**.

## Step 2: Create the Netlify site (3 minutes)

1. app.netlify.com → **Add new site → Import an existing project → GitHub** → pick `aify-website`.
2. Build settings are read from `netlify.toml` automatically (publish directory `public`, functions `netlify/functions`). Leave the build command empty. Click **Deploy**.

## Step 3: Add your keys (5 minutes)

**Site configuration → Environment variables → Add a variable → Add a single variable.** For each one: paste the key name and value, keep scopes on all (Functions must be included), tick **Contains secret values** for keys and tokens, and click **Create variable**.

| Key | Value | When |
|---|---|---|
| `ANTHROPIC_API_KEY` | from console.anthropic.com → API keys | Now (required) |
| `ALLOWED_ORIGINS` | `https://aify.solutions,https://www.aify.solutions` | Now |
| `BOOKING_URL` | your Google Calendar appointment schedule link (Step 5) | Now |
| `RESEND_API_KEY` | from resend.com, after verifying aify.solutions | Optional: emails each lead to info@aify.solutions |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | from the Twilio console | Step 6 |
| `DEMO_PHONE_NUMBER` | your Twilio number, e.g. `+16045550199` | Step 6 |
| `TRANSFER_TO_NUMBER` | your cell, e.g. `+16045551234` | Step 6 |
| `PUBLIC_BASE_URL` | `https://aify.solutions` | Recommended: used in report links and emails |

Then **Deploys → Trigger deploy → Deploy site**. New variables only reach the functions after a redeploy.

In the Anthropic console, set a **monthly spend limit** before you share the site.

## Step 4: Check it works

Open your `…netlify.app` address:
- **/demo**: press **Start the call**, allow the microphone, say "I need an oil change Thursday morning".
- The **Ask AIfy** button: ask "What do you build?"
- **/contact**: send a test request. Netlify → **Forms** shows it; turn on email notifications under **Forms → Form notifications**.
- Leads from the chat, the demo form and phone calls are saved in **Netlify Blobs → leads**. They're also in **Logs → Functions** as `LEAD {...}`.

### The free AI visibility check (/ai-visibility)

It uses the same `ANTHROPIC_API_KEY` with Claude's **web search** tool. In the Anthropic Console, check that web search is allowed for your organization (Settings → Privacy / tool settings), or every check will show "Couldn't check". Each check runs about 6 searches plus a few short AI calls. It's limited to 3 checks per visitor per day (`VISIBILITY_DAILY_LIMIT`). Every completed check is a lead: name, email, business, score and a link to their report, saved in Netlify Blobs → `leads`, and emailed to you if Resend is set up. Visitors also get their report link by email when Resend is set up.

Optional: set `PERPLEXITY_API_KEY` and `VISIBILITY_ENGINE=perplexity` to run checks on Perplexity instead.

## Step 5: Booking link from Google Workspace

Google Calendar → **Create → Appointment schedule** → 15 minutes, your available hours, add Google Meet → Save → **Open booking page** → copy the link → set it as `BOOKING_URL` → redeploy.

## Step 6: The demo phone line (Twilio)

1. Twilio console → **Phone Numbers → Buy a number** → a local 604 or 778 number with Voice and SMS.
2. Click the number → **Voice configuration**:
   - **A call comes in:** Webhook, `https://aify.solutions/api/voice`, HTTP POST
   - **Call status changes:** `https://aify.solutions/api/voice?event=status`
   (Use your `…netlify.app` address until the domain is switched.)
3. Add `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `DEMO_PHONE_NUMBER`, `TRANSFER_TO_NUMBER` in Netlify → redeploy.
4. Call the number. The AI answers; book something; you'll get a real text. Say "can I talk to a person?" and it rings your cell.

Calls go to the AI, not your phone. Your cell only rings when a caller asks for a person. After every call you get the caller's number, transcript and outcome as a lead.

## Step 7: Switch the domain

Netlify → **Domain management → Add a domain** → `aify.solutions` → follow the DNS instructions from wherever the domain is registered. HTTPS is set up automatically. Old blog URLs and anchors are no longer used; the new blog lives at `/blog/`.

## Spend protection (optional settings)

Daily caps per visitor (by IP): `AGENT_DAILY_LIMIT` (default 150 chat messages), `DEMO_DAILY_LIMIT` (default 150 demo turns), `VISIBILITY_DAILY_LIMIT` (default 3 checks). The lead form allows 10 submissions per visitor per day. Keep a monthly spend limit in the Anthropic Console as the final safety net.

## Changing things later

- What AIfy Agent knows: `netlify/functions/agent/prompt.mjs`
- The demo store's prices, hours and policies: `netlify/lib/dealer/tools.mjs`
- Blog articles: `content/blog/*.md` (ask Claude to add articles and rebuild the pages)

Push changes to GitHub and Netlify redeploys automatically.
