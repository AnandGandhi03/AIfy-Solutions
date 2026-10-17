# QA report: aify.solutions (October 16, 2026)

Everything below was tested on a local copy of the site, with the AI, Twilio and email services replaced by stand-ins that behave like the real ones. Results: **0 failures**.

| Suite | Checks | Result |
|---|---|---|
| Static audit (all 20 pages): valid HTML structure, one H1, heading order, titles and descriptions unique, canonical URLs, structured data parses, no leftover template code, no dead links, brand rules | 20 pages, 18 sitemap URLs | Pass |
| Link crawl: every internal link and anchor resolves | 29 URLs | Pass |
| Netlify bundling: each function bundled with esbuild (as Netlify does) and loaded | 5 functions | Pass |
| Function tests: validation, CORS, missing keys, upstream failures, spend caps, demo tools, phone line signature and TwiML, lead capture, visibility check lifecycle | 56 | Pass |
| Browser tests: every page on desktop and phone (no overflow, no errors), WCAG 2 AA accessibility scan (no serious or critical issues), navigation, mobile menu, AIfy Agent, live demo call, demo lead form, AI visibility check, blog, contact form, 404 | 117 | Pass |

## Fixed during QA

- Dealerships demo tabs had an unclosed element (now valid HTML).
- Demo page heading order (cards used h4 under h2).
- Colour contrast: demo step labels, "booked" time slots, example cards, and the score fraction on the visibility report now meet WCAG AA.
- AIfy Agent: Escape now closes the chat from anywhere; choosing "Try the live demo" closes the chat so it doesn't cover the demo; on phones the chat button is a compact icon.
- Links in AI replies can no longer point to another site through `//` paths.
- Spend protection: daily per-visitor caps on AIfy Agent (150 messages), the demo (150) and the lead form (10), in addition to the 3-per-day cap on visibility checks; answers in a visibility check are never paid for twice.
- GEO article meta description shortened to search-result length.

## Can only be verified after deploy (needs your real accounts)

1. **Real AI replies**: add `ANTHROPIC_API_KEY`, then try the chat, a demo call and a visibility check.
2. **Web search for the visibility check**: must be allowed for your organisation in the Anthropic Console.
3. **Voice in the demo**: uses the browser's own speech; test in Chrome and on an iPhone (Safari) with the microphone allowed.
4. **Netlify Forms**: submit the Contact form once, then turn on form notifications.
5. **Lead storage and email**: check Netlify → Blobs → `leads`; set `RESEND_API_KEY` for email.
6. **Phone line**: after connecting Twilio, call the number, book something, and ask for a person to test the transfer.
7. **Function time limit**: if visibility answers often show "Couldn't check", set `VISIBILITY_MAX_SEARCHES=1`.
