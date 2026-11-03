import Game from "@/components/game/Game";

/**
 * Tonight's set. The player's local date decides which set that is, so the
 * game boots on the client; the server only ships the shell.
 */
export default function Home() {
  return (
    <main>
      <Game route={{ kind: "today" }} />
    </main>
  );
}
