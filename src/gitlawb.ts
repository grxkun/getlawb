/**
 * gitlawb Integration
 *
 * Connects getlawb legal analysis to the gitlawb decentralized git network.
 * Registers as a legal review agent, watches repos for smart contract changes,
 * and posts findings as PR reviews using Ed25519 HTTP signatures (RFC 9421).
 *
 * gitlawb API: https://node.gitlawb.com
 * Auth: DID-based identity + Ed25519 HTTP Signatures, no API keys
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { GetlawbClient, GetlawbResponse } from './client';

// ============================================================================
// TYPES
// ============================================================================

export interface GitlawbConfig {
  /** gitlawb node URL. Defaults to https://node.gitlawb.com */
  nodeUrl?: string;
  /** Your agent DID, e.g. did:gitlawb:z6MkYourAgent */
  did: string;
  /**
   * Path to Ed25519 private key PEM file (e.g. ~/.gitlawb/keys/ed25519.pem).
   * Mutually exclusive with privateKeyPem.
   */
  keyPath?: string;
  /**
   * Ed25519 private key as PEM string.
   * Mutually exclusive with keyPath.
   */
  privateKeyPem?: string;
}

export interface WatchConfig {
  owner: string;
  repo: string;
  /** Automatically post getlawb findings as PR reviews. Default: true */
  autoReview?: boolean;
  /** Called after every analysis, regardless of autoReview */
  onFindings?: (event: PREvent, analysis: GetlawbResponse) => Promise<void>;
  /** Poll interval in ms. Default: 5 minutes */
  pollIntervalMs?: number;
}

export interface PREvent {
  owner: string;
  repo: string;
  number: number;
  title: string;
  branch: string;
}

interface PRFile {
  path: string;
  patch: string;
}

interface GitlawbPR {
  number: number;
  title: string;
  branch: string;
  status: string;
}

// ============================================================================
// INTEGRATION
// ============================================================================

export class GitlawbIntegration {
  private readonly client: GetlawbClient;
  private readonly nodeUrl: string;
  private readonly did: string;
  private readonly privateKey: crypto.KeyObject;

  constructor(client: GetlawbClient, config: GitlawbConfig) {
    if (!config.did) throw new Error('GitlawbIntegration: did is required');
    if (!config.keyPath && !config.privateKeyPem) {
      throw new Error('GitlawbIntegration: keyPath or privateKeyPem is required');
    }

    this.client = client;
    this.nodeUrl = (config.nodeUrl ?? 'https://node.gitlawb.com').replace(/\/$/, '');
    this.did = config.did;

    const pem = config.privateKeyPem ?? fs.readFileSync(config.keyPath!, 'utf8');
    this.privateKey = crypto.createPrivateKey(pem);
  }

  // --------------------------------------------------------------------------
  // AGENT REGISTRATION
  // --------------------------------------------------------------------------

  /**
   * Register getlawb as a legal review agent on the gitlawb network.
   * Call once on first setup; the DID becomes the persistent agent identity.
   */
  async registerAgent(name = 'getlawb'): Promise<{ did: string }> {
    return this.request('POST', '/api/v1/agents', {
      '@context': 'https://gitlawb.com/ns/agent/v1',
      '@type': 'Agent',
      did: this.did,
      name,
      capabilities: [
        'legal-review',
        'contract-audit',
        'regulatory-check',
        'governance-validation',
        'risk-assessment',
      ],
      description: 'Automated Web3 legal analysis — powered by getlawb',
      homepage: 'https://github.com/grxkun/getlawb',
    });
  }

  // --------------------------------------------------------------------------
  // PR AUDIT
  // --------------------------------------------------------------------------

  /**
   * Fetch changed files in a PR and run legal analysis.
   * Detects Solidity contracts automatically and routes to contract_audit.
   */
  async auditPR(owner: string, repo: string, prNumber: number): Promise<GetlawbResponse> {
    const files = await this.getPRFiles(owner, repo, prNumber);
    const solFiles = files.filter((f) => f.path.endsWith('.sol'));

    if (solFiles.length > 0) {
      return this.client.query({
        type: 'contract_audit',
        data: {
          code: solFiles.map((f) => `// ${f.path}\n${f.patch}`).join('\n\n'),
          language: 'solidity',
        },
      });
    }

    // Non-Solidity PRs get a general risk assessment
    return this.client.query({
      type: 'risk_assessment',
      data: {
        entity: `${owner}/${repo} PR #${prNumber}`,
        context: `Files changed: ${files.map((f) => f.path).join(', ')}`,
        exposure: 'Code changes in Web3 repository',
      },
    });
  }

  /**
   * Post getlawb findings as a PR review on gitlawb.
   * Approves on LOW risk, requests changes on MEDIUM/HIGH/CRITICAL.
   */
  async postReview(
    owner: string,
    repo: string,
    prNumber: number,
    analysis: GetlawbResponse
  ): Promise<void> {
    await this.request('POST', `/api/v1/repos/${owner}/${repo}/prs/${prNumber}/reviews`, {
      '@context': 'https://gitlawb.com/ns/review/v1',
      '@type': 'Review',
      author: this.did,
      verdict: analysis.risk_level === 'LOW' ? 'APPROVE' : 'REQUEST_CHANGES',
      body: this.formatReview(analysis),
    });
  }

  /**
   * Post findings as a plain comment on a PR.
   */
  async postComment(
    owner: string,
    repo: string,
    prNumber: number,
    analysis: GetlawbResponse
  ): Promise<void> {
    await this.request('POST', `/api/v1/repos/${owner}/${repo}/prs/${prNumber}/comments`, {
      '@context': 'https://gitlawb.com/ns/comment/v1',
      '@type': 'Comment',
      author: this.did,
      body: this.formatReview(analysis),
    });
  }

  // --------------------------------------------------------------------------
  // REPO WATCHER
  // --------------------------------------------------------------------------

  /**
   * Poll a repo for new open PRs and automatically audit them.
   * Returns an unsubscribe function — call it to stop watching.
   *
   * @example
   * const stop = await integration.watchRepo({ owner: 'acme', repo: 'protocol' });
   * // ... later
   * stop();
   */
  async watchRepo(config: WatchConfig): Promise<() => void> {
    const {
      owner,
      repo,
      autoReview = true,
      onFindings,
      pollIntervalMs = 5 * 60 * 1000,
    } = config;

    const audited = new Set<number>();

    const poll = async () => {
      try {
        const prs = await this.listOpenPRs(owner, repo);
        for (const pr of prs) {
          if (audited.has(pr.number)) continue;
          audited.add(pr.number);

          const analysis = await this.auditPR(owner, repo, pr.number);
          const event: PREvent = {
            owner,
            repo,
            number: pr.number,
            title: pr.title,
            branch: pr.branch,
          };

          if (autoReview) {
            await this.postReview(owner, repo, pr.number, analysis);
          }
          if (onFindings) {
            await onFindings(event, analysis);
          }
        }
      } catch {
        // Polling errors are non-fatal; network blips shouldn't kill the watcher
      }
    };

    // Run immediately, then on interval
    await poll();
    const timer = setInterval(poll, pollIntervalMs);
    return () => clearInterval(timer);
  }

  // --------------------------------------------------------------------------
  // PRIVATE HELPERS
  // --------------------------------------------------------------------------

  private async listOpenPRs(owner: string, repo: string): Promise<GitlawbPR[]> {
    const res = await this.request<{ items: GitlawbPR[] }>(
      'GET',
      `/api/v1/repos/${owner}/${repo}/prs?status=open&limit=50`
    );
    return res.items ?? [];
  }

  private async getPRFiles(owner: string, repo: string, prNumber: number): Promise<PRFile[]> {
    const res = await this.request<{ files: PRFile[] }>(
      'GET',
      `/api/v1/repos/${owner}/${repo}/prs/${prNumber}/files`
    );
    return res.files ?? [];
  }

  private formatReview(analysis: GetlawbResponse): string {
    const emoji = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }[analysis.risk_level];
    const lines: string[] = [
      `## getlawb Legal Analysis ${emoji}`,
      '',
      `| Field | Value |`,
      `|-------|-------|`,
      `| Risk Level | **${analysis.risk_level}** |`,
      `| Confidence | ${Math.round(analysis.confidence * 100)}% |`,
      `| Audit Hash | \`${analysis.audit_hash.slice(0, 16)}…\` |`,
      '',
    ];

    if (analysis.findings.length === 0) {
      lines.push('No legal issues detected.');
    } else {
      lines.push(`### Findings (${analysis.findings.length})`);
      for (const f of analysis.findings) {
        lines.push('', `**[${f.severity}] ${f.type}**`, f.description);
        if (f.remediation) lines.push(`> **Fix:** ${f.remediation}`);
        if (f.reference) lines.push(`> **Ref:** ${f.reference}`);
      }
    }

    lines.push(
      '',
      '---',
      '*[getlawb](https://github.com/grxkun/getlawb) — automated legal reasoning for Web3 on gitlawb*'
    );
    return lines.join('\n');
  }

  /**
   * Make an authenticated HTTP request to the gitlawb node.
   * Signs every request with Ed25519 per RFC 9421 — no sessions, no API keys.
   */
  private request<T = unknown>(method: string, path: string, body?: object): Promise<T> {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : '';
      const bodyBytes = bodyStr ? Buffer.from(bodyStr, 'utf8') : null;
      const url = new URL(this.nodeUrl + path);

      const headers: Record<string, string | number> = {
        accept: 'application/ld+json',
        ...(bodyBytes
          ? {
              'content-type': 'application/ld+json',
              'content-length': bodyBytes.length,
            }
          : {}),
        ...this.buildSignatureHeaders(method, url.pathname + url.search, bodyStr),
      };

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname + url.search,
          method: method.toUpperCase(),
          headers,
          timeout: 30_000,
        },
        (res: http.IncomingMessage) => {
          let data = '';
          res.on('data', (chunk: Buffer) => (data += chunk));
          res.on('end', () => {
            const code = res.statusCode ?? 0;
            if (code >= 200 && code < 300) {
              try {
                resolve(data ? JSON.parse(data) : ({} as T));
              } catch {
                resolve(data as unknown as T);
              }
            } else {
              reject(new Error(`gitlawb ${method} ${path} → ${code}: ${data}`));
            }
          });
        }
      );

      req.on('error', reject);
      req.on('timeout', () => req.destroy(new Error('gitlawb request timed out after 30s')));

      if (bodyBytes) req.write(bodyBytes);
      req.end();
    });
  }

  /**
   * Build RFC 9421 HTTP Signature headers.
   * Covers @method, @path, date, and content-digest (when body present).
   */
  private buildSignatureHeaders(
    method: string,
    path: string,
    body: string
  ): Record<string, string> {
    const created = Math.floor(Date.now() / 1000);
    const coveredComponents = ['"@method"', '"@path"'];
    const headers: Record<string, string> = {};

    if (body) {
      const digest = crypto.createHash('sha256').update(body, 'utf8').digest('base64');
      headers['content-digest'] = `sha-256=:${digest}:`;
      coveredComponents.push('"content-digest"');
    }

    const sigParams = `(${coveredComponents.join(' ')});keyid="${this.did}";alg="ed25519";created=${created}`;

    // Signature base per RFC 9421 §2.5
    const sigBase = [
      `"@method": ${method.toUpperCase()}`,
      `"@path": ${path}`,
      ...(body ? [`"content-digest": ${headers['content-digest']}`] : []),
      `"@signature-params": ${sigParams}`,
    ].join('\n');

    const sig = crypto.sign(null, Buffer.from(sigBase, 'utf8'), this.privateKey);

    headers['signature-input'] = `sig1=${sigParams}`;
    headers['signature'] = `sig1=:${sig.toString('base64')}:`;

    return headers;
  }
}
