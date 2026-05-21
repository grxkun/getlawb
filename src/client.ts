/**
 * getlawb Client - Main SDK class
 * Powered by OpenClaude (Gitlawb legal reasoning LLM)
 * 
 * Routes legal queries to OpenClaude API
 * Handles caching, audit hashing, and response formatting
 */

import * as https from 'https';
import * as http from 'http';
import * as crypto from 'crypto';

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

type QueryType = 'contract_audit' | 'regulatory_check' | 'governance_validation' | 'legal_precedent' | 'risk_assessment' | 'custom_query';
type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Severity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
type Status = 'success' | 'error' | 'pending';
type FindingType = 'REGULATORY' | 'LIABILITY' | 'GOVERNANCE' | 'PRECEDENT' | 'COMPLIANCE';

interface QueryRequest {
  type: QueryType;
  data: Record<string, any>;
  jurisdiction?: string;
  urgency?: 'low' | 'medium' | 'high';
}

interface Finding {
  type: FindingType;
  severity: Severity;
  description: string;
  remediation?: string;
  reference?: string;
}

interface QueryMetadata {
  tokens_used: number;
  model: string;
  latency_ms: number;
  cache_hit: boolean;
}

interface GetlawbResponse {
  query_hash: string;
  query_id: string;
  query_type: QueryType;
  timestamp: number;
  status: Status;
  findings: Finding[];
  risk_level: RiskLevel;
  confidence: number;
  audit_hash: string;
  openclaude_version: string;
  metadata: QueryMetadata;
}

interface CacheEntry {
  response: GetlawbResponse;
  timestamp: number;
  ttl: number;
}

// ============================================================================
// CACHE IMPLEMENTATION
// ============================================================================

class RequestCache {
  private cache: Map<string, CacheEntry> = new Map();
  private readonly DEFAULT_TTL = 30 * 24 * 60 * 60 * 1000; // 30 days

  set(key: string, response: GetlawbResponse, ttl: number = this.DEFAULT_TTL): void {
    this.cache.set(key, {
      response,
      timestamp: Date.now(),
      ttl,
    });
  }

  get(key: string): GetlawbResponse | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const isExpired = Date.now() - entry.timestamp > entry.ttl;
    if (isExpired) {
      this.cache.delete(key);
      return null;
    }

    return entry.response;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }
}

// ============================================================================
// MAIN CLIENT
// ============================================================================

export interface GetlawbClientConfig {
  /** Anthropic API key. Not required when baseUrl points to a local provider like Ollama. */
  apiKey?: string;
  /**
   * OpenAI-compatible base URL, e.g. http://localhost:11434 for Ollama.
   * When set, uses /v1/chat/completions instead of the Anthropic API.
   */
  baseUrl?: string;
  /** Model name. Defaults to claude-opus-4-7 (Anthropic) or llama3.2:3b (Ollama). */
  model?: string;
}

export class GetlawbClient {
  private apiKey: string;
  private baseUrl: string | null;
  private cache: RequestCache;
  private model: string;

  constructor(apiKeyOrConfig: string | GetlawbClientConfig = {}) {
    const config: GetlawbClientConfig =
      typeof apiKeyOrConfig === 'string' ? { apiKey: apiKeyOrConfig } : apiKeyOrConfig;

    this.baseUrl = config.baseUrl ?? null;
    this.apiKey = config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '';
    this.model = config.model ?? (this.baseUrl ? 'llama3.2:3b' : 'claude-opus-4-7');

    if (!this.baseUrl && !this.apiKey) {
      throw new Error('Provide apiKey for Anthropic, or baseUrl for a local provider like Ollama');
    }
    this.cache = new RequestCache();
  }

  /**
   * Generate deterministic query hash
   */
  private generateQueryHash(request: QueryRequest): string {
    const canonical = JSON.stringify({
      type: request.type,
      data: request.data,
      jurisdiction: request.jurisdiction || 'global',
    });
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Build system prompt for OpenClaude
   */
  private buildPrompt(request: QueryRequest): string {
    const basePrompt = `You are OpenClaude, a legal reasoning LLM specializing in Web3, blockchain, and smart contracts.

Your task: Analyze the following ${request.type} query and provide deterministic, auditable findings.

Temperature: 0.1 (deterministic)
Response format: JSON only, no explanation

Required fields in response:
{
  "findings": [
    {
      "type": "REGULATORY|LIABILITY|GOVERNANCE|PRECEDENT|COMPLIANCE",
      "severity": "LOW|MEDIUM|HIGH|CRITICAL",
      "description": "Clear, actionable finding",
      "remediation": "How to address this",
      "reference": "Source or standard"
    }
  ],
  "risk_level": "LOW|MEDIUM|HIGH|CRITICAL",
  "confidence": 0.0-1.0
}`;

    switch (request.type) {
      case 'contract_audit':
        return `${basePrompt}

QUERY: Contract Audit
CODE: ${request.data.code || ''}
LANGUAGE: ${request.data.language || 'solidity'}

Focus on: Regulatory exposure, liability gaps, governance conflicts.`;

      case 'regulatory_check':
        return `${basePrompt}

QUERY: Regulatory Compliance Check
ACTION: ${request.data.action || ''}
JURISDICTION: ${request.jurisdiction || 'global'}
DETAILS: ${request.data.details || ''}

Focus on: Securities law, token classification, airdrop legality, regulatory bodies involved.`;

      case 'governance_validation':
        return `${basePrompt}

QUERY: DAO Governance Validation
PROPOSAL: ${request.data.proposal_title || ''}
ACTIONS: ${JSON.stringify(request.data.actions || [])}
DAO: ${request.data.dao || ''}

Focus on: Governance conflicts, execution risk, token holder implications.`;

      case 'risk_assessment':
        return `${basePrompt}

QUERY: Risk Assessment
ENTITY: ${request.data.entity || ''}
CONTEXT: ${request.data.context || ''}
EXPOSURE: ${request.data.exposure || ''}

Focus on: Legal risk, compliance gaps, mitigation strategies.`;

      default:
        return `${basePrompt}

QUERY: ${request.data.question || ''}
CONTEXT: ${JSON.stringify(request.data.context || {})}`;
    }
  }

  /**
   * Call the configured LLM backend — Anthropic or any OpenAI-compatible endpoint (e.g. Ollama).
   */
  private callOpenClaude(systemPrompt: string, userMessage: string): Promise<string> {
    return this.baseUrl
      ? this.callOpenAICompatible(systemPrompt, userMessage)
      : this.callAnthropic(systemPrompt, userMessage);
  }

  private callAnthropic(systemPrompt: string, userMessage: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const data = JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      });

      const req = https.request(
        {
          hostname: 'api.anthropic.com',
          port: 443,
          path: '/v1/messages',
          method: 'POST',
          headers: {
            'x-api-key': this.apiKey,
            'anthropic-version': '2023-06-01',
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data, 'utf8'),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body).content[0].text);
              } catch (e) {
                reject(new Error(`Failed to parse Anthropic response: ${e}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  private callOpenAICompatible(systemPrompt: string, userMessage: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const url = new URL('/v1/chat/completions', this.baseUrl!);
      const data = JSON.stringify({
        model: this.model,
        max_tokens: 4096,
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      });

      const isHttps = url.protocol === 'https:';
      const transport = isHttps ? https : http;

      const req = transport.request(
        {
          hostname: url.hostname,
          port: url.port || (isHttps ? 443 : 80),
          path: url.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(data, 'utf8'),
            ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (chunk: Buffer) => (body += chunk));
          res.on('end', () => {
            if (res.statusCode === 200) {
              try {
                resolve(JSON.parse(body).choices[0].message.content);
              } catch (e) {
                reject(new Error(`Failed to parse OpenAI-compatible response: ${e}`));
              }
            } else {
              reject(new Error(`HTTP ${res.statusCode}: ${body}`));
            }
          });
        }
      );
      req.on('error', reject);
      req.write(data);
      req.end();
    });
  }

  /**
   * Extract JSON from response (handles markdown code blocks)
   */
  private extractJSON(text: string): any {
    try {
      // Try direct JSON parse first
      return JSON.parse(text);
    } catch {
      // Try extracting from markdown code block
      const match = text.match(/```(?:json)?\n?([\s\S]*?)\n?```/);
      if (match) {
        return JSON.parse(match[1]);
      }
      throw new Error('Could not extract JSON from response');
    }
  }

  /**
   * Generate audit hash for tamper detection
   */
  private generateAuditHash(findings: Finding[]): string {
    const canonical = JSON.stringify(findings);
    return crypto.createHash('sha256').update(canonical).digest('hex');
  }

  /**
   * Format response
   */
  private formatResponse(
    request: QueryRequest,
    findings: Finding[],
    riskLevel: RiskLevel,
    confidence: number,
    tokensUsed: number,
    cacheHit: boolean,
    latencyMs: number
  ): GetlawbResponse {
    const queryHash = this.generateQueryHash(request);
    const auditHash = this.generateAuditHash(findings);

    return {
      query_hash: queryHash,
      query_id: crypto.randomUUID(),
      query_type: request.type,
      timestamp: Date.now(),
      status: 'success',
      findings,
      risk_level: riskLevel,
      confidence,
      audit_hash: auditHash,
      openclaude_version: this.model,
      metadata: {
        tokens_used: tokensUsed,
        model: this.model,
        latency_ms: latencyMs,
        cache_hit: cacheHit,
      },
    };
  }

  /**
   * Main query method
   */
  async query(request: QueryRequest): Promise<GetlawbResponse> {
    const startTime = Date.now();
    const queryHash = this.generateQueryHash(request);

    // Check cache
    const cached = this.cache.get(queryHash);
    if (cached) {
      const latencyMs = Date.now() - startTime;
      return {
        ...cached,
        metadata: { ...cached.metadata, latency_ms: latencyMs, cache_hit: true },
      };
    }

    // Build prompt and call OpenClaude
    const prompt = this.buildPrompt(request);
    const userMessage = 'Analyze and provide findings in JSON format.';

    const responseText = await this.callOpenClaude(prompt, userMessage);
    const responseJson = this.extractJSON(responseText);

    // Parse response
    const findings: Finding[] = responseJson.findings || [];
    const riskLevel: RiskLevel = responseJson.risk_level || 'MEDIUM';
    const confidence: number = responseJson.confidence || 0.8;
    const tokensUsed = 500; // Approximate

    const latencyMs = Date.now() - startTime;

    // Create response
    const response = this.formatResponse(
      request,
      findings,
      riskLevel,
      confidence,
      tokensUsed,
      false,
      latencyMs
    );

    // Cache response
    this.cache.set(queryHash, response);

    return response;
  }

  /**
   * Batch queries
   */
  async queryBatch(requests: QueryRequest[]): Promise<GetlawbResponse[]> {
    return Promise.all(requests.map((req) => this.query(req)));
  }

  /**
   * Verify audit hash (tamper detection)
   */
  verifyAuditHash(response: GetlawbResponse): boolean {
    const computed = this.generateAuditHash(response.findings);
    return computed === response.audit_hash;
  }
}

export { GetlawbResponse, QueryRequest, Finding, RiskLevel, QueryType };
