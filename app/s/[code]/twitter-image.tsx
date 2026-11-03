import { decodeShareCode } from "@/lib/share/code";
import { setDateFor } from "@/lib/share/set-date";
import { ticketImageResponse } from "@/lib/share/ticket-og";

export const alt = "A BARRICADE ticket: how close someone got to the stage";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const s = decodeShareCode(code);
  if (!s) return new Response("Not found", { status: 404 });
  const date = await setDateFor(s.number);
  return ticketImageResponse({ number: s.number, outcomes: s.outcomes, date });
}
