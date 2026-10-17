// AIfy Agent tools: lead capture only. The dealership demo has its own agent and tools (functions/demo).
import { saveLead, validEmail } from "../../lib/leads.mjs";

export const TOOLS = [
  {
    name: "capture_lead",
    description: "Send a visitor's contact details to the AIfy team so a person follows up about a demo or project. Call only after the visitor has given at least their name and email and agreed to be contacted.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string" },
        email: { type: "string" },
        phone: { type: "string" },
        business: { type: "string", description: "Business or dealership name" },
        interest: { type: "string", description: "What they want, e.g. dealership voice agent, website, GEO" },
        notes: { type: "string", description: "Short summary of the conversation and their main challenge" },
      },
      required: ["name", "email"],
    },
  },
];

export async function runTool(name, input) {
  if (name !== "capture_lead") return { data: { error: "unknown tool" } };
  if (!validEmail(input.email)) return { data: { ok: false, error: "That email doesn't look valid. Ask the visitor to check it." } };
  const { ok, record } = await saveLead({ ...input, source: "AIfy Agent (website chat)" }, { kind: "chat-lead" });
  return {
    data: ok ? { ok: true } : { ok: false, error: "Could not reach the team just now. Ask them to email info@aify.solutions." },
    ui: ok ? { kind: "lead", title: "Details sent to the AIfy team", lines: [record.name, record.email, record.business].filter(Boolean) } : undefined,
  };
}
