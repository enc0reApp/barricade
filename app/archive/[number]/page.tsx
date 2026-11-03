import type { Metadata } from "next";
import { notFound } from "next/navigation";
import Game from "@/components/game/Game";

type Params = Promise<{ number: string }>;

function parseNumber(raw: string): number | null {
  if (!/^\d{1,5}$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

export async function generateMetadata({ params }: { params: Params }): Promise<Metadata> {
  const n = parseNumber((await params).number);
  return n ? { title: `Set #${n} (archive)`, robots: { index: false } } : {};
}

/** Archive play: the same game, not scored, never touches the streak. */
export default async function ArchiveSetPage({ params }: { params: Params }) {
  const n = parseNumber((await params).number);
  if (n === null) notFound();
  return (
    <main>
      <Game key={n} route={{ kind: "archive", number: n }} />
    </main>
  );
}
