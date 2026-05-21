/**
 * gitlawb Issue Auto-Reply
 *
 * Watches for new issues on gitlawb repos. When an issue mentions
 * legal/audit/compliance keywords, getlawb automatically runs analysis
 * and posts a signed comment with findings.
 */

import { GetlawbClient, GetlawbResponse, QueryRequest } from './client';
import { GitlawbIntegration } from './gitlawb';

// ============================================================================
// TYPES
// ============================================================================

export interface AutoReplyConfig {
  owner: string;
  repo: string;
  /** Keywords that trigger auto-reply. Default: common legal terms */
  triggers?: string[];
  /** Poll interval in ms. Default: 3 minutes */
  pollIntervalMs?: number;
  /** Called after every auto-reply */
  onReply?: (issue: GitlawbIssue, analysis: GetlawbResponse) => void;
}

interface GitlawbIssue {
  id: string;
  number: number;
  title: string;
  body: string;
  author_did: string;
  created_at: string;
  labels: string[];
}

const DEFAULT_TRIGGERS = [
  'audit', 'legal', 'comply', 'compliance', 'regulatory', 'regulation',
  'liability', 'governance', 'risk', 'securities', 'token', 'airdrop',
  'dao', 'defi', 'smart contract', 'solidity', 'vulnerability', 'exploit',
];

// ============================================================================
// AUTO-REPLY
// ============================================================================

export class GitlawbAutoReply {
  private readonly client: GetlawbClient;
  private readonly integration: GitlawbIntegration;
  private readonly replied = new Set<number>();

  constructor(client: GetlawbClient, integration: GitlawbIntegration) {
    this.client = client;
    this.integration = integration;
  }

  /**
   * Start watching a repo for issues to auto-reply to.
   * Returns an unsubscribe function.
   */
  async watch(config: AutoReplyConfig): Promise<() => void> {
    const {
      owner,
      repo,
      triggers = DEFAULT_TRIGGERS,
      pollIntervalMs = 3 * 60 * 1000,
      onReply,
    } = config;

    const poll = async () => {
      try {
        const issues = await this.listOpenIssues(owner, repo);
        for (const issue of issues) {
          if (this.replied.has(issue.number)) continue;
          if (!this.matches(issue, triggers)) continue;

          this.replied.add(issue.number);
          const analysis = await this.analyzeIssue(issue);
          await this.integration.postComment(owner, repo, issue.number, analysis);
          onReply?.(issue, analysis);
          console.log(`[getlawb] auto-replied to issue #${issue.number}: "${issue.title}"`);
        }
      } catch (err) {
        // Non-fatal
      }
    };

    await poll();
    const timer = setInterval(poll, pollIntervalMs);
    return () => clearInterval(timer);
  }

  // --------------------------------------------------------------------------

  private matches(issue: GitlawbIssue, triggers: string[]): boolean {
    const text = `${issue.title} ${issue.body}`.toLowerCase();
    return triggers.some((t) => text.includes(t.toLowerCase()));
  }

  private async analyzeIssue(issue: GitlawbIssue): Promise<GetlawbResponse> {
    const text = `${issue.title}\n${issue.body}`;

    // Detect Solidity code blocks
    const solidityMatch = text.match(/```(?:solidity|sol)?\n([\s\S]*?)```/);
    if (solidityMatch) {
      return this.client.query({
        type: 'contract_audit',
        data: { code: solidityMatch[1], language: 'solidity' },
      });
    }

    // Detect regulatory questions
    const regulatoryKeywords = ['airdrop', 'securities', 'token sale', 'ico', 'regulation', 'sec', 'mifid'];
    if (regulatoryKeywords.some((k) => text.toLowerCase().includes(k))) {
      return this.client.query({
        type: 'regulatory_check',
        data: { action: issue.title, details: issue.body },
      } as QueryRequest);
    }

    // Default: custom legal query
    return this.client.query({
      type: 'custom_query',
      data: { question: issue.title, context: { body: issue.body } },
    });
  }

  private async listOpenIssues(owner: string, repo: string): Promise<GitlawbIssue[]> {
    const res = await (this.integration as any).request(
      'GET',
      `/api/v1/repos/${owner}/${repo}/issues?status=open&limit=50`
    ) as { issues: GitlawbIssue[] };
    return res.issues ?? [];
  }
}
