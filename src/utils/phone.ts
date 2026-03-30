import { parsePhoneNumberFromString } from 'libphonenumber-js';
import type { CountryCode } from 'libphonenumber-js';

export function normalizePhone(input: string, defaultCountry: string = 'US'): string {
  const phone = parsePhoneNumberFromString(input, defaultCountry as CountryCode);
  if (!phone || !phone.isValid()) {
    throw new Error(`Invalid phone number: ${input}`);
  }
  return phone.number; // E.164 format, e.g., '+12135551234'
}
