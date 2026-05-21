/**
 * getlawb Front Desk — Lex
 *
 * A conversational AI legal receptionist on the gitlawb network.
 * Greets every new issue, conducts intake, then runs legal analysis.
 *
 * Flow:
 *   1. New issue opens → Lex posts a welcome + intake questions
 *   2. User replies → Lex responds (multi-turn conversation via Ollama)
 *   3. Enough context → runs getlawb analysis, posts formatted report
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { GetlawbClient, GetlawbResponse, QueryRequest } from './client';
import { GitlawbIntegration } from './gitlawb';

const execAsync = promisify(exec);

// ============================================================================
// TYPES
// ============================================================================

export interface FrontDeskConfig {
  owner: string;
  repo: string;
  agentDid: string;
  /** Poll interval in ms. Default: 90 seconds */
  pollIntervalMs?: number;
}

type IssueStatus = 'intake' | 'analyzing' | 'done';

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface IssueState {
  id: string;
  title: string;
  body: string;
  greeted: boolean;
  conversation: ChatMessage[];
  seenCommentIds: Set<string>;
  status: IssueStatus;
  turnCount: number;
}

interface GitlawbComment {
  id: string;
  author: string;
  body: string;
  created_at: string;
}

interface GitlawbIssue {
  id: string;
  title: string;
  body: string;
  author: string;
  status: string;
}

// ============================================================================
// FRONT DESK
// ============================================================================

const LEX_SYSTEM_PROMPT = `You are Lex, a professional AI legal front desk assistant for getlawb on the gitlawb network.

Your personality:
- Warm, professional, and concise
- Expert in Web3, blockchain, smart contracts, DeFi, DAOs, and token law
- You represent getlawb — the legal reasoning layer of the gitlawb ecosystem

Your job:
1. Greet users and understand their legal question through conversation
2. Ask focused clarifying questions (jurisdiction, contract details, token type, etc.)
3. Once you have enough context (usually after 1–2 user replies), signal readiness to analyze

Rules:
- Keep responses short and focused (3–6 sentences max for conversational turns)
- Use markdown sparingly — only for emphasis or lists when genuinely helpful
- Never give a final legal opinion yourself — your job is intake, then you hand off to analysis
- At the END of every response, output exactly one of these action tags on its own line:
  [ACTION:CONTINUE] — you need more information
  [ACTION:ANALYZE]  — you have enough context, ready to run analysis`;

export class GetlawbFrontDesk {
  private readonly client: GetlawbClient;
  private readonly integration: GitlawbIntegration;
  private readonly state = new Map<string, IssueState>();

  constructor(client: GetlawbClient, integration: GitlawbIntegration) {
    this.client = client;
    this.integration = integration;
  }

  async watch(config: FrontDeskConfig): Promise<() => void> {
    const { owner, repo, agentDid, pollIntervalMs = 90_000 } = config;

    const poll = async () => {
      try {
        const issues = await this.listOpenIssues(owner, repo);
        for (const issue of issues) {
          await this.handleIssue(owner, repo, issue, agentDid);
        }
      } catch (err) {
        console.error('[frontdesk] poll error:', err);
      }
    };

    await poll();
    const timer = setInterval(poll, pollIntervalMs);
    return () => clearInterval(timer);
  }

  // --------------------------------------------------------------------------

  private async handleIssue(
    owner: string,
    repo: string,
    issue: GitlawbIssue,
    agentDid: string
  ): Promise<void> {
    let s = this.state.get(issue.id);

    if (!s) {
      s = {
        id: issue.id,
        title: issue.title,
        body: issue.body,
        greeted: false,
        conversation: [],
        seenCommentIds: new Set(),
        status: 'intake',
        turnCount: 0,
      };
      this.state.set(issue.id, s);
    }

    if (s.status === 'done') return;

    // Post greeting on first encounter
    if (!s.greeted) {
      const greeting = this.buildGreeting(issue);
      await this.postComment(repo, issue.id, greeting);
      s.greeted = true;
      s.conversation.push({ role: 'assistant', content: greeting });
      console.log(`[frontdesk] greeted #${issue.id.slice(0, 8)}: "${issue.title}"`);
      return;
    }

    // Fetch new user comments since last check
    const comments = await this.listComments(owner, repo, issue.id);
    const newComments = comments.filter(
      (c) => !s!.seenCommentIds.has(c.id) && c.author !== agentDid
    );

    if (newComments.length === 0) return;

    for (const comment of newComments) {
      s.seenCommentIds.add(comment.id);
      s.conversation.push({ role: 'user', content: comment.body });
      s.turnCount++;
    }

    if (s.status === 'analyzing') return;

    // Generate Lex's response
    const lexReply = await this.client.chat(s.conversation, LEX_SYSTEM_PROMPT);

    // Parse action tag
    const actionMatch = lexReply.match(/\[ACTION:(CONTINUE|ANALYZE)\]/);
    const action = actionMatch?.[1] ?? 'CONTINUE';
    const cleanReply = lexReply.replace(/\[ACTION:(CONTINUE|ANALYZE)\]\s*$/m, '').trimEnd();

    await this.postComment(repo, issue.id, cleanReply);
    s.conversation.push({ role: 'assistant', content: cleanReply });
    console.log(`[frontdesk] replied #${issue.id.slice(0, 8)} → ACTION:${action}`);

    if (action === 'ANALYZE') {
      s.status = 'analyzing';
      await this.runAndPostAnalysis(repo, issue, s);
    }
  }

  private async runAndPostAnalysis(
    repo: string,
    issue: GitlawbIssue,
    s: IssueState
  ): Promise<void> {
    try {
      const thinkingMsg =
        `⏳ **Running legal analysis…**\n\n` +
        `I have enough context. Give me a moment to run a full getlawb analysis on your situation.`;
      await this.postComment(repo, issue.id, thinkingMsg);

      const request = this.buildQueryRequest(issue, s.conversation);
      const analysis = await this.client.query(request);
      const report = this.formatReport(analysis, s.conversation);

      await this.postComment(repo, issue.id, report);
      s.status = 'done';
      console.log(`[frontdesk] analysis done #${issue.id.slice(0, 8)}: ${analysis.risk_level}`);
    } catch (err) {
      console.error(`[frontdesk] analysis failed #${issue.id.slice(0, 8)}:`, err);
      s.status = 'intake';
    }
  }

  // --------------------------------------------------------------------------
  // GREETING
  // --------------------------------------------------------------------------

  private buildGreeting(issue: GitlawbIssue): string {
    return [
      `## 👋 Welcome to getlawb Legal Front Desk`,
      ``,
      `Hi! I'm **Lex**, getlawb's AI legal assistant on the gitlawb network.`,
      ``,
      `I can help with:`,
      `- 📋 **Smart contract audits** — Solidity security & regulatory review`,
      `- ⚖️ **Regulatory checks** — token sales, airdrops, DeFi, ICOs`,
      `- 🏛️ **Governance validation** — DAO proposals & treasury actions`,
      `- 🔍 **Risk assessments** — general Web3 legal exposure`,
      ``,
      `To get started, could you share:`,
      `1. A bit more context about your situation`,
      `2. Your jurisdiction (US, EU, global, etc.)`,
      `3. Any contract code or transaction details (paste inline or in a code block)`,
      ``,
      `I'll conduct an initial intake and then run a full legal analysis.`,
      ``,
      `---`,
      `*[getlawb](https://github.com/grxkun/getlawb) — automated legal reasoning for Web3 on gitlawb*`,
    ].join('\n');
  }

  // --------------------------------------------------------------------------
  // QUERY ROUTING
  // --------------------------------------------------------------------------

  private buildQueryRequest(issue: GitlawbIssue, conversation: ChatMessage[]): QueryRequest {
    const fullText = [issue.title, issue.body, ...conversation.map((m) => m.content)]
      .join('\n')
      .toLowerCase();

    // Detect Solidity code blocks
    const allText = [issue.body, ...conversation.map((m) => m.content)].join('\n');
    const solidityMatch = allText.match(/```(?:solidity|sol)?\n([\s\S]*?)```/);
    if (solidityMatch) {
      return {
        type: 'contract_audit',
        data: { code: solidityMatch[1], language: 'solidity' },
      };
    }

    if (['airdrop', 'token sale', 'ico', 'securities', 'sec', 'mifid'].some((k) => fullText.includes(k))) {
      return {
        type: 'regulatory_check',
        data: { action: issue.title, details: allText },
      };
    }

    if (['dao', 'governance', 'proposal', 'treasury', 'vote'].some((k) => fullText.includes(k))) {
      return {
        type: 'governance_validation',
        data: { proposal_title: issue.title, actions: [], dao: 'unknown' },
      };
    }

    return {
      type: 'custom_query',
      data: {
        question: issue.title,
        context: { conversation: conversation.map((m) => `${m.role}: ${m.content}`).join('\n') },
      },
    };
  }

  // --------------------------------------------------------------------------
  // REPORT FORMATTING
  // --------------------------------------------------------------------------

  private formatReport(analysis: GetlawbResponse, conversation: ChatMessage[]): string {
    const emoji = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }[analysis.risk_level] ?? '⚪';
    const lines: string[] = [
      `## getlawb Legal Analysis — Final Report ${emoji}`,
      ``,
      `| Field | Value |`,
      `|-------|-------|`,
      `| Risk Level | **${analysis.risk_level}** |`,
      `| Confidence | ${Math.round(analysis.confidence * 100)}% |`,
      `| Query Type | ${analysis.query_type} |`,
      `| Audit Hash | \`${analysis.audit_hash.slice(0, 16)}…\` |`,
      ``,
    ];

    if (analysis.findings.length === 0) {
      lines.push(`✅ No legal issues detected based on the information provided.`);
    } else {
      lines.push(`### Findings (${analysis.findings.length})`);
      for (const f of analysis.findings) {
        const sev = { LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴' }[f.severity] ?? '⚪';
        lines.push(``, `**${sev} [${f.severity}] ${f.type}**`, ``, f.description);
        if (f.remediation) lines.push(``, `> **Recommended action:** ${f.remediation}`);
        if (f.reference) lines.push(`> **Reference:** ${f.reference}`);
      }
    }

    lines.push(
      ``,
      `---`,
      `*This analysis is for informational purposes only and does not constitute legal advice. ` +
      `For binding legal opinions, consult a qualified attorney in your jurisdiction.*`,
      ``,
      `*[getlawb](https://github.com/grxkun/getlawb) on gitlawb — audit hash verifiable on-chain*`
    );
    return lines.join('\n');
  }

  // --------------------------------------------------------------------------
  // GITLAWB API HELPERS
  // --------------------------------------------------------------------------

  private async listOpenIssues(owner: string, repo: string): Promise<GitlawbIssue[]> {
    const res = await (this.integration as any).request(
      'GET',
      `/api/v1/repos/${owner}/${repo}/issues?status=open&limit=50`
    ) as { issues: GitlawbIssue[] };
    return res.issues ?? [];
  }

  private async listComments(owner: string, repo: string, issueId: string): Promise<GitlawbComment[]> {
    try {
      const res = await (this.integration as any).request(
        'GET',
        `/api/v1/repos/${owner}/${repo}/issues/${issueId}/comments`
      ) as { comments: GitlawbComment[] };
      return res.comments ?? [];
    } catch {
      return [];
    }
  }

  private async postComment(repo: string, issueId: string, body: string): Promise<void> {
    const escaped = body.replace(/'/g, `'\\''`);
    await execAsync(`gl issue comment --body '${escaped}' ${repo} ${issueId}`);
  }
}
