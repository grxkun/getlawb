/**
 * gitlawb Webhook Handler
 *
 * Listens for gitlawb webhook events (pull_request.opened, push, etc.)
 * and automatically runs getlawb legal analysis on incoming PRs.
 *
 * Verifies HMAC-SHA256 signatures so only genuine gitlawb payloads are processed.
 * Deploy anywhere — Codespace port, VPS, Lambda, Fly.io, Railway.
 */

import * as http from 'http';
import * as crypto from 'crypto';
import { GetlawbClient } from './client';
import { GitlawbIntegration } from './gitlawb';

// ============================================================================
// TYPES
// ============================================================================

export interface WebhookConfig {
  /** Port to listen on. Default: 3000 */
  port?: number;
  /** GetlawbClient instance — used for the /api/ask REST endpoint */
  client?: GetlawbClient;
  /**
   * HMAC secret set when creating the webhook with `gl webhook create --secret`.
   * If omitted, signature verification is skipped (not recommended for production).
   */
  secret?: string;
  /** Called after every analysis */
  onAnalysis?: (event: GitlawbWebhookEvent, summary: string) => void;
}

export interface GitlawbWebhookEvent {
  event: 'pull_request.opened' | 'pull_request.reviewed' | 'pull_request.merged' | 'pull_request.closed' | 'push' | string;
  repo: string;
  owner: string;
  pull_request?: {
    number: number;
    title: string;
    branch: string;
  };
  pusher?: string;
  ref?: string;
}

// ============================================================================
// HANDLER
// ============================================================================

export class GitlawbWebhookServer {
  private readonly integration: GitlawbIntegration;
  private readonly client: GetlawbClient;
  private readonly config: Required<WebhookConfig>;
  private server: http.Server | null = null;

  constructor(integration: GitlawbIntegration, config: WebhookConfig = {}) {
    this.integration = integration;
    this.client = config.client ?? (integration as any).client as GetlawbClient;
    this.config = {
      port: config.port ?? 3000,
      secret: config.secret ?? '',
      client: config.client ?? this.client,
      onAnalysis: config.onAnalysis ?? ((event, summary) => {
        console.log(`[getlawb] ${event.event} on ${event.owner}/${event.repo}`);
        console.log(summary);
      }),
    };
  }

  /** Start the webhook server. Returns the bound port. */
  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        // CORS headers for browser clients (front desk app)
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

        if (req.method === 'OPTIONS') {
          res.writeHead(204).end();
          return;
        }

        // ── /api/ask — legal query endpoint for the front desk web app ──
        if (req.url === '/api/ask' && req.method === 'POST') {
          let body = '';
          req.on('data', (chunk: Buffer) => (body += chunk));
          req.on('end', async () => {
            try {
              const { question } = JSON.parse(body);
              if (!question) { res.writeHead(400).end(JSON.stringify({ error: 'question required' })); return; }
              const analysis = await this.client.query({
                type: 'custom_query',
                data: { question, context: {} },
              });
              res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(analysis));
            } catch (err) {
              res.writeHead(500, { 'Content-Type': 'application/json' })
                .end(JSON.stringify({ error: String(err) }));
            }
          });
          return;
        }

        // ── /hooks — gitlawb webhook handler ──
        if (req.method !== 'POST') {
          res.writeHead(405).end('Method Not Allowed');
          return;
        }

        let body = '';
        req.on('data', (chunk: Buffer) => (body += chunk));
        req.on('end', () => {
          // Verify HMAC signature if a secret is configured
          if (this.config.secret) {
            const sig = req.headers['x-gitlawb-signature-256'] as string | undefined;
            if (!sig || !this.verifySignature(body, sig)) {
              res.writeHead(401).end('Invalid signature');
              return;
            }
          }

          try {
            const event: GitlawbWebhookEvent = JSON.parse(body);
            res.writeHead(200).end('ok');
            this.handleEvent(event).catch((err) => {
              console.error('[getlawb webhook] handler error:', err.message);
            });
          } catch {
            res.writeHead(400).end('Invalid JSON');
          }
        });
      });

      this.server.on('error', reject);
      this.server.listen(this.config.port, () => {
        const addr = this.server!.address();
        const port = typeof addr === 'object' && addr ? addr.port : this.config.port;
        console.log(`[getlawb] webhook server listening on port ${port}`);
        resolve(port);
      });
    });
  }

  /** Stop the server. */
  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) return resolve();
      this.server.close((err) => (err ? reject(err) : resolve()));
    });
  }

  // --------------------------------------------------------------------------
  // PRIVATE
  // --------------------------------------------------------------------------

  private async handleEvent(event: GitlawbWebhookEvent): Promise<void> {
    if (event.event !== 'pull_request.opened') return;
    if (!event.pull_request) return;

    const { owner, repo, pull_request: pr } = event;
    const analysis = await this.integration.auditPR(owner, repo, pr.number);
    await this.integration.postReview(owner, repo, pr.number, analysis);

    const summary = [
      `PR #${pr.number} "${pr.title}"`,
      `Risk: ${analysis.risk_level} | Confidence: ${Math.round(analysis.confidence * 100)}%`,
      `Findings: ${analysis.findings.length}`,
    ].join(' | ');

    this.config.onAnalysis(event, summary);
  }

  private verifySignature(body: string, header: string): boolean {
    const expected = 'sha256=' + crypto
      .createHmac('sha256', this.config.secret)
      .update(body, 'utf8')
      .digest('hex');
    try {
      return crypto.timingSafeEqual(Buffer.from(header), Buffer.from(expected));
    } catch {
      return false;
    }
  }
}
