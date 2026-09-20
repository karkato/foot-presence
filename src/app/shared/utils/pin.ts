/**
 * Shared PIN format rule, extracted so the "4 to 6 digits" rule lives in a
 * single place instead of drifting across profile.component.ts,
 * player-form.component.ts and the SQL regex (`^[0-9]{4,6}$` in
 * supabase/pinreset.sql). Returns a French error message, or `null` when
 * the PIN is valid.
 */
export function validatePin(pin: string): string | null {
  // Message conservé à l'identique pour ProfileComponent.savePin() (comportement
  // observable inchangé par le refactor), même s'il ne mentionne pas la borne max.
  if (pin.length < 4) {
    return 'PIN de 4 chiffres minimum';
  }
  if (pin.length > 6) {
    return 'PIN de 6 chiffres maximum';
  }
  if (!/^[0-9]+$/.test(pin)) {
    return 'Le PIN doit contenir uniquement des chiffres';
  }
  return null;
}
