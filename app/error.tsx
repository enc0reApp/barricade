"use client";

import Link from "next/link";
import { useEffect } from "react";
import StatusScreen from "@/components/game/StatusScreen";

export default function ErrorPage({ error, retry, reset }: { error: unknown; retry?: () => void; reset?: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const again = retry ?? reset;
  return (
    <div style={{ background: "var(--sky-0)", minHeight: "100dvh" }}>
      <StatusScreen
        kicker="TECHNICAL DIFFICULTIES"
        title="THE PA JUST BLEW."
        body={<p>something broke on our side. your answers are saved on this device.</p>}
        actions={
          <>
            {again ? (
              <button type="button" className="px-btn" onClick={() => again()}>
                TRY AGAIN
              </button>
            ) : null}
            <Link className="px-btn px-btn--ghost" href="/">
              BACK TO THE FIELD
            </Link>
          </>
        }
      />
    </div>
  );
}
