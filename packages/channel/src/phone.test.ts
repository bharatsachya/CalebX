import { describe, expect, it } from "bun:test";
import {
  isPhoneMatch,
  isValidPhone,
  maskPhone,
  normalizePhone,
} from "./phone.ts";

describe("Phone Normalization", () => {
  it("normalizes standard Indian 10-digit mobile number", () => {
    expect(normalizePhone("9876543210")).toBe("+919876543210");
  });

  it("normalizes number with trunk zero prefix", () => {
    expect(normalizePhone("09876543210")).toBe("+919876543210");
  });

  it("normalizes number with spaces, hyphens, and parens", () => {
    expect(normalizePhone("+91 (987) 654-3210")).toBe("+919876543210");
    expect(normalizePhone("98765-43210")).toBe("+919876543210");
    expect(normalizePhone("98765 43210")).toBe("+919876543210");
  });

  it("normalizes international 00 prefix", () => {
    expect(normalizePhone("00919876543210")).toBe("+919876543210");
  });

  it("normalizes Telegram contact phone format (no leading plus)", () => {
    expect(normalizePhone("919876543210")).toBe("+919876543210");
  });

  it("normalizes international US number", () => {
    expect(normalizePhone("+14155552671")).toBe("+14155552671");
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
  });

  it("rejects invalid inputs", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("abc")).toBeNull();
    expect(normalizePhone("123")).toBeNull(); // too short
    expect(normalizePhone("12345678901234567890")).toBeNull(); // too long
    expect(normalizePhone(undefined)).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });

  it("validates phone numbers correctly", () => {
    expect(isValidPhone("9876543210")).toBe(true);
    expect(isValidPhone("+919876543210")).toBe(true);
    expect(isValidPhone("invalid")).toBe(false);
  });

  it("matches phone numbers across formatting differences", () => {
    expect(isPhoneMatch("9876543210", "+91 98765 43210")).toBe(true);
    expect(isPhoneMatch("09876543210", "919876543210")).toBe(true);
    expect(isPhoneMatch("+919876543210", "9876543210")).toBe(true);
    expect(isPhoneMatch("+919876543210", "+919876543211")).toBe(false);
    expect(isPhoneMatch("invalid", "9876543210")).toBe(false);
  });

  it("masks phone numbers safely", () => {
    expect(maskPhone("+919876543210")).toBe("+91*****3210");
    expect(maskPhone("9876543210")).toBe("+91*****3210");
    expect(maskPhone("")).toBe("[empty]");
  });
});
