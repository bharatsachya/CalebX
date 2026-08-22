/**
 * Centralized phone normalization, validation, and masking.
 *
 * Implements canonical E.164 phone representation to ensure deterministic
 * matching across Telegram contact payloads, user input, and spreadsheet rows.
 */

const DEFAULT_COUNTRY_CODE = "+91";

/**
 * Normalizes a raw phone number into canonical E.164 format (+<country><digits>).
 * Returns null if the number cannot be deterministically normalized.
 */
export function normalizePhone(
  raw: string | undefined | null,
  defaultCountryCode = DEFAULT_COUNTRY_CODE,
): string | null {
  if (!raw || typeof raw !== "string") return null;

  const trimmed = raw.trim();
  if (trimmed === "") return null;

  // Remove common punctuation: spaces, dashes, dots, parens, slashes
  let cleaned = trimmed.replace(/[\s\-\(\)\.\/\\]+/g, "");

  // If there are invalid characters (letters or special chars other than leading +), reject
  if (!/^\+?\d+$/.test(cleaned)) return null;

  // Standardize default country code format (ensure leading +)
  const defaultCc = defaultCountryCode.startsWith("+")
    ? defaultCountryCode
    : `+${defaultCountryCode}`;
  const defaultDigits = defaultCc.slice(1);

  // Handle international prefix 00 (e.g. 0091... -> +91...)
  if (cleaned.startsWith("00")) {
    cleaned = `+${cleaned.slice(2)}`;
  }

  // If it starts with a plus, verify digits
  if (cleaned.startsWith("+")) {
    const digits = cleaned.slice(1);
    if (digits.length >= 7 && digits.length <= 15) {
      return `+${digits}`;
    }
    return null;
  }

  // Handle single leading 0 (trunk prefix, e.g. 09876543210 -> +919876543210)
  if (cleaned.startsWith("0") && !cleaned.startsWith("00")) {
    cleaned = cleaned.slice(1);
  }

  // If 10 digits (standard Indian/US mobile format without country code)
  if (cleaned.length === 10) {
    return `${defaultCc}${cleaned}`;
  }

  // If starts with country code without plus (e.g. 919876543210 or 14155552671)
  if (
    cleaned.startsWith(defaultDigits) &&
    cleaned.length === defaultDigits.length + 10
  ) {
    return `+${cleaned}`;
  }

  // General fallback: if length is between 10 and 15 digits
  if (cleaned.length >= 10 && cleaned.length <= 15) {
    // If it likely already contains a country code
    return `+${cleaned}`;
  }

  return null;
}

/** Returns true if the raw phone string can be normalized to valid E.164. */
export function isValidPhone(raw: string | undefined | null): boolean {
  return normalizePhone(raw) !== null;
}

/** Deterministically compares two phone strings after normalization. */
export function isPhoneMatch(
  phoneA: string | undefined | null,
  phoneB: string | undefined | null,
): boolean {
  const normA = normalizePhone(phoneA);
  const normB = normalizePhone(phoneB);
  if (normA === null || normB === null) return false;
  return normA === normB;
}

/**
 * Masks a phone number for privacy-safe structured logging.
 * Example: "+919876543210" -> "+91*****3210"
 */
export function maskPhone(phone: string | undefined | null): string {
  if (!phone || typeof phone !== "string") return "[empty]";
  const norm = normalizePhone(phone) ?? phone.trim();
  if (norm.length <= 5) return "***";
  const prefix = norm.slice(0, 3);
  const suffix = norm.slice(-4);
  return `${prefix}*****${suffix}`;
}
