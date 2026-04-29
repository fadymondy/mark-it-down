import { describe, expect, it } from 'vitest';
import { scanForSecrets } from '../../src/warehouse/secretScanner';

describe('scanForSecrets', () => {
  it('returns empty array for clean text', () => {
    expect(scanForSecrets('# Hello\n\nNothing dangerous here.')).toEqual([]);
  });

  it('detects GitHub PATs', () => {
    const findings = scanForSecrets('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(findings.length).toBe(1);
    expect(findings[0].pattern).toBe('github-token');
    expect(findings[0].line).toBe(1);
    expect(findings[0].preview).toMatch(/^ghp_/);
    expect(findings[0].preview).toContain('…');
  });

  it('detects fine-grained github_pat tokens', () => {
    const token = 'github_pat_' + 'A'.repeat(70);
    expect(scanForSecrets(token).length).toBeGreaterThan(0);
  });

  it('detects AWS access key ids', () => {
    const findings = scanForSecrets('aws: AKIAIOSFODNN7EXAMPLE');
    expect(findings.find(f => f.pattern === 'aws-access-key')).toBeDefined();
  });

  it('detects OpenAI / Anthropic-style sk- keys', () => {
    const findings = scanForSecrets('OPENAI=sk-proj-abc1234567890def');
    expect(findings.find(f => f.pattern === 'openai-key')).toBeDefined();
  });

  it('detects Anthropic sk-ant- keys with the more specific pattern', () => {
    const findings = scanForSecrets(`key=sk-ant-${'a'.repeat(60)}`);
    expect(findings.find(f => f.pattern === 'anthropic-key')).toBeDefined();
  });

  it('detects Slack xoxp tokens', () => {
    const findings = scanForSecrets('slack: xoxp-1234567890-abc-def-ghi');
    expect(findings.find(f => f.pattern === 'slack-token')).toBeDefined();
  });

  it('detects Google API keys', () => {
    const findings = scanForSecrets('gmaps=AIzaSyB-1234567890_abcdef-ghijklmnopqrs');
    expect(findings.find(f => f.pattern === 'google-api-key')).toBeDefined();
  });

  it('detects PEM private key blocks', () => {
    const findings = scanForSecrets('-----BEGIN RSA PRIVATE KEY-----\nMIIE...\n-----END RSA PRIVATE KEY-----');
    expect(findings.find(f => f.pattern === 'private-key-pem')).toBeDefined();
  });

  it('detects JWTs', () => {
    const jwt =
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
    expect(scanForSecrets(jwt).find(f => f.pattern === 'jwt')).toBeDefined();
  });

  it('redacts the token in the preview', () => {
    const findings = scanForSecrets('ghp_secretvaluedontleak1234567890ABCDEFG');
    expect(findings[0].preview).not.toContain('secretvaluedontleak');
    expect(findings[0].preview).toContain('…');
  });

  it('reports the correct line number on multi-line input', () => {
    const findings = scanForSecrets('first line\nsecond line\nghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0].line).toBe(3);
  });
});
