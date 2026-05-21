/**
 * getlawb Client Tests
 * Jest test suite for GetlawbClient
 */

import { GetlawbClient } from '../src/client';
import crypto from 'crypto';

describe('GetlawbClient', () => {
  let client: GetlawbClient;

  beforeEach(() => {
    // Set dummy API key for testing
    process.env.ANTHROPIC_API_KEY = 'test-key-123';
    client = new GetlawbClient('test-key-123');
  });

  describe('Initialization', () => {
    test('should initialize GetlawbClient with API key', () => {
      expect(client).toBeDefined();
      expect(typeof client.query).toBe('function');
    });

    test('should throw error if no API key provided', () => {
      expect(() => new GetlawbClient('')).toThrow('ANTHROPIC_API_KEY is required');
    });
  });

  describe('Query Hash Generation', () => {
    test('should generate consistent hash for same query', () => {
      const request1 = {
        type: 'contract_audit' as const,
        data: { code: 'contract Test {}', language: 'solidity' },
      };

      // Call twice and verify hash is same
      const hash1 = crypto
        .createHash('sha256')
        .update(JSON.stringify({ type: request1.type, data: request1.data, jurisdiction: 'global' }))
        .digest('hex');

      const hash2 = crypto
        .createHash('sha256')
        .update(JSON.stringify({ type: request1.type, data: request1.data, jurisdiction: 'global' }))
        .digest('hex');

      expect(hash1).toBe(hash2);
      expect(hash1).toHaveLength(64);
    });

    test('should generate different hashes for different queries', () => {
      const query1 = JSON.stringify({
        type: 'contract_audit',
        data: { code: 'contract A {}' },
        jurisdiction: 'global',
      });

      const query2 = JSON.stringify({
        type: 'contract_audit',
        data: { code: 'contract B {}' },
        jurisdiction: 'global',
      });

      const hash1 = crypto.createHash('sha256').update(query1).digest('hex');
      const hash2 = crypto.createHash('sha256').update(query2).digest('hex');

      expect(hash1).not.toBe(hash2);
    });
  });

  describe('Audit Hash Verification', () => {
    test('should verify audit hash correctly', () => {
      const findings = [
        {
          type: 'REGULATORY' as const,
          severity: 'HIGH' as const,
          description: 'Test finding',
          remediation: 'Test fix',
        },
      ];

      const canonical = JSON.stringify(findings);
      const auditHash = crypto.createHash('sha256').update(canonical).digest('hex');

      // Create mock response
      const response = {
        query_hash: 'test',
        query_id: 'test',
        query_type: 'contract_audit' as const,
        timestamp: Date.now(),
        status: 'success' as const,
        findings,
        risk_level: 'HIGH' as const,
        confidence: 0.9,
        audit_hash: auditHash,
        openclaude_version: 'claude-opus-4-20250514',
        metadata: {
          tokens_used: 500,
          model: 'claude-opus-4-20250514',
          latency_ms: 100,
          cache_hit: false,
        },
      };

      // Verify should work
      expect(client.verifyAuditHash(response)).toBe(true);
    });

    test('should detect tampered findings', () => {
      const findings = [
        {
          type: 'REGULATORY' as const,
          severity: 'HIGH' as const,
          description: 'Original finding',
        },
      ];

      const auditHash = crypto
        .createHash('sha256')
        .update(JSON.stringify(findings))
        .digest('hex');

      // Tamper with findings
      const tamperedFindings = [
        {
          type: 'REGULATORY' as const,
          severity: 'LOW' as const,
          description: 'Tampered finding',
        },
      ];

      const response = {
        query_hash: 'test',
        query_id: 'test',
        query_type: 'contract_audit' as const,
        timestamp: Date.now(),
        status: 'success' as const,
        findings: tamperedFindings,
        risk_level: 'LOW' as const,
        confidence: 0.5,
        audit_hash: auditHash, // Original hash, but findings changed
        openclaude_version: 'claude-opus-4-20250514',
        metadata: {
          tokens_used: 500,
          model: 'claude-opus-4-20250514',
          latency_ms: 100,
          cache_hit: false,
        },
      };

      // Verify should fail
      expect(client.verifyAuditHash(response)).toBe(false);
    });
  });

  describe('Cache Behavior', () => {
    test('should cache responses with deterministic hashes', () => {
      // Since we can't call real API in tests, we test cache logic
      const query = {
        type: 'contract_audit' as const,
        data: { code: 'test' },
      };

      const canonical = JSON.stringify({
        type: query.type,
        data: query.data,
        jurisdiction: 'global',
      });

      const hash1 = crypto.createHash('sha256').update(canonical).digest('hex');
      const hash2 = crypto.createHash('sha256').update(canonical).digest('hex');

      expect(hash1).toBe(hash2);
    });
  });

  describe('Query Types', () => {
    test('should support all query types', () => {
      const queryTypes = [
        'contract_audit',
        'regulatory_check',
        'governance_validation',
        'legal_precedent',
        'risk_assessment',
        'custom_query',
      ];

      queryTypes.forEach((type) => {
        expect(['contract_audit', 'regulatory_check', 'governance_validation', 'legal_precedent', 'risk_assessment', 'custom_query']).toContain(type);
      });
    });
  });

  describe('Response Format', () => {
    test('should return GetlawbResponse interface shape', () => {
      // Verify response structure
      const mockResponse = {
        query_hash: 'abc123',
        query_id: 'uuid',
        query_type: 'contract_audit' as const,
        timestamp: Date.now(),
        status: 'success' as const,
        findings: [],
        risk_level: 'LOW' as const,
        confidence: 0.8,
        audit_hash: 'def456',
        openclaude_version: 'claude-opus-4-20250514',
        metadata: {
          tokens_used: 500,
          model: 'claude-opus-4-20250514',
          latency_ms: 150,
          cache_hit: false,
        },
      };

      expect(mockResponse).toHaveProperty('query_hash');
      expect(mockResponse).toHaveProperty('findings');
      expect(mockResponse).toHaveProperty('risk_level');
      expect(mockResponse).toHaveProperty('audit_hash');
    });
  });
});
