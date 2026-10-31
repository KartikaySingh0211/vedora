import { test, expect } from '@playwright/test';
import { isAllowedTestHostname } from '../proxy';

test.describe('Security: Playwright Hostname Parser Validation', () => {
  test('should allow valid exact loopback hostnames with and without ports', () => {
    // Standard localhost
    expect(isAllowedTestHostname('localhost')).toBe(true);
    expect(isAllowedTestHostname('localhost:3000')).toBe(true);
    expect(isAllowedTestHostname('localhost:3001')).toBe(true);
    expect(isAllowedTestHostname('LOCALHOST:8080')).toBe(true);

    // Standard IPv4 loopback
    expect(isAllowedTestHostname('127.0.0.1')).toBe(true);
    expect(isAllowedTestHostname('127.0.0.1:3001')).toBe(true);
    expect(isAllowedTestHostname('127.0.0.1:8080')).toBe(true);

    // Standard IPv6 loopback (bracketed and bare)
    expect(isAllowedTestHostname('[::1]')).toBe(true);
    expect(isAllowedTestHostname('[::1]:3001')).toBe(true);
    expect(isAllowedTestHostname('[::1]:8080')).toBe(true);
    expect(isAllowedTestHostname('::1')).toBe(true);
  });

  test('should strictly reject spoofed, prefix-matched, and public domain hostnames', () => {
    // Subdomain / prefix attack vectors
    expect(isAllowedTestHostname('localhost.attacker.com')).toBe(false);
    expect(isAllowedTestHostname('127.0.0.1.attacker.com')).toBe(false);
    expect(isAllowedTestHostname('localhost.evil.org:3001')).toBe(false);
    expect(isAllowedTestHostname('127.0.0.1.evil.org:3001')).toBe(false);

    // Production / public domains
    expect(isAllowedTestHostname('vedora.tv')).toBe(false);
    expect(isAllowedTestHostname('app.vedora.com')).toBe(false);
    expect(isAllowedTestHostname('vedora.vercel.app')).toBe(false);

    // Non-loopback IP addresses
    expect(isAllowedTestHostname('192.168.1.1')).toBe(false);
    expect(isAllowedTestHostname('10.0.0.1')).toBe(false);
    expect(isAllowedTestHostname('[::2]')).toBe(false);
    expect(isAllowedTestHostname('[::2]:3001')).toBe(false);

    // Malformed ports and injection attempts
    expect(isAllowedTestHostname('localhost:evil')).toBe(false);
    expect(isAllowedTestHostname('127.0.0.1:evil')).toBe(false);
    expect(isAllowedTestHostname('127.0.0.1:3000:4000')).toBe(false);
    expect(isAllowedTestHostname('127.0.0.1@attacker.com')).toBe(false);
    expect(isAllowedTestHostname('[::1')).toBe(false);
    expect(isAllowedTestHostname('[::1]:abc')).toBe(false);
    expect(isAllowedTestHostname('[::1]trailing')).toBe(false);

    // Null, undefined, and empty inputs
    expect(isAllowedTestHostname('')).toBe(false);
    expect(isAllowedTestHostname('   ')).toBe(false);
    expect(isAllowedTestHostname(null)).toBe(false);
    expect(isAllowedTestHostname(undefined)).toBe(false);
  });
});
