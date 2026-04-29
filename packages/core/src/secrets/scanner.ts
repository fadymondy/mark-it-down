export interface SecretFinding {
  pattern: string;
  description: string;
  /** 1-indexed line number where the match starts. */
  line: number;
  /** Truncated, 8-char preview so the secret isn't fully exposed in the warning. */
  preview: string;
}

interface PatternDef {
  name: string;
  description: string;
  regex: RegExp;
}

const PATTERNS: PatternDef[] = [
  {
    name: 'github-token',
    description: 'GitHub personal access / app / OAuth token (ghp_, gho_, ghu_, ghs_, ghr_, github_pat_)',
    regex: /\b(?:gh[psuor]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{60,})\b/,
  },
  {
    name: 'aws-access-key',
    description: 'AWS access key id',
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    name: 'aws-secret-key',
    description: 'AWS-shaped secret access key',
    regex: /(?<![A-Za-z0-9/+=])[A-Za-z0-9/+=]{40}(?![A-Za-z0-9/+=])/,
  },
  {
    name: 'openai-key',
    description: 'OpenAI / Anthropic-style sk- API key',
    regex: /\bsk-[A-Za-z0-9_-]{20,}\b/,
  },
  {
    name: 'anthropic-key',
    description: 'Anthropic API key (sk-ant-)',
    regex: /\bsk-ant-[A-Za-z0-9_-]{40,}\b/,
  },
  {
    name: 'slack-token',
    description: 'Slack bot/user/app/legacy token',
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  },
  {
    name: 'google-api-key',
    description: 'Google API key',
    regex: /\bAIza[0-9A-Za-z_-]{35}\b/,
  },
  {
    name: 'private-key-pem',
    description: 'PEM-encoded private key block',
    regex: /-----BEGIN (?:RSA |OPENSSH |EC |DSA |PGP )?PRIVATE KEY-----/,
  },
  {
    name: 'jwt',
    description: 'JSON Web Token (header.payload.signature)',
    regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
];

export function scanForSecrets(content: string): SecretFinding[] {
  const lines = content.split(/\r?\n/);
  const findings: SecretFinding[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of PATTERNS) {
      const match = pattern.regex.exec(line);
      if (match) {
        findings.push({
          pattern: pattern.name,
          description: pattern.description,
          line: i + 1,
          preview: redact(match[0]),
        });
      }
    }
  }
  return findings;
}

function redact(token: string): string {
  if (token.length <= 8) {
    return '*'.repeat(token.length);
  }
  return `${token.slice(0, 4)}…${token.slice(-2)}`;
}
