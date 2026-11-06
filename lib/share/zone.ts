/** The ticket "zone" printed on the stub — where in the field you ended up. */
export function zoneFor(distance: number): string {
  if (distance <= 0) return "BARRICADE";
  if (distance <= 50) return "THE PIT";
  if (distance <= 150) return "FRONT";
  if (distance <= 250) return "FOH";
  if (distance <= 350) return "THE FIELD";
  if (distance < 500) return "THE BACK";
  return "CAR PARK";
}
