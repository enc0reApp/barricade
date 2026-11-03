/** Route-level fallback while a page streams in. Styles live in globals.css (.route-loading). */
export default function Loading() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span>DOORS OPENING…</span>
    </div>
  );
}
