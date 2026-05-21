/**
 * GitlawbIntegration Tests
 * Tests auth, formatting, and routing logic without hitting the live network.
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { GitlawbIntegration } from '../src/gitlawb';
import { GetlawbClient } from '../src/client';

// Generate a real Ed25519 keypair for tests
function generateTestKey(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }) as string,
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }) as string,
  };
}

describe('GitlawbIntegration', () => {
  const { privateKeyPem } = generateTestKey();
  const testDid = 'did:gitlawb:z6MkTestAgent123';

  describe('Initialization', () => {
    test('constructs with privateKeyPem', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, {
        did: testDid,
        privateKeyPem,
      });
      expect(integration).toBeDefined();
    });

    test('constructs with keyPath', () => {
      const tmpFile = path.join(os.tmpdir(), `getlawb-test-${Date.now()}.pem`);
      fs.writeFileSync(tmpFile, privateKeyPem);

      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, {
        did: testDid,
        keyPath: tmpFile,
      });
      expect(integration).toBeDefined();

      fs.unlinkSync(tmpFile);
    });

    test('throws if no DID provided', () => {
      const client = new GetlawbClient('test-key');
      expect(
        () => new GitlawbIntegration(client, { did: '', privateKeyPem })
      ).toThrow('did is required');
    });

    test('throws if no key provided', () => {
      const client = new GetlawbClient('test-key');
      expect(
        () => new GitlawbIntegration(client, { did: testDid })
      ).toThrow('keyPath or privateKeyPem is required');
    });
  });

  describe('HTTP Signature (RFC 9421)', () => {
    test('signature headers are present and correctly structured', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did: testDid, privateKeyPem });

      // Access private method via casting for unit testing
      const headers = (integration as any).buildSignatureHeaders('POST', '/api/v1/agents', '{"test":1}');

      expect(headers).toHaveProperty('signature');
      expect(headers).toHaveProperty('signature-input');
      expect(headers).toHaveProperty('content-digest');

      // Signature must be base64-wrapped: sig1=:BASE64:
      expect(headers['signature']).toMatch(/^sig1=:.+:$/);
      // Content-digest must use sha-256
      expect(headers['content-digest']).toMatch(/^sha-256=:.+:$/);
      // keyid in signature-input must match the DID
      expect(headers['signature-input']).toContain(`keyid="${testDid}"`);
      expect(headers['signature-input']).toContain('alg="ed25519"');
      // created timestamp must be present
      expect(headers['signature-input']).toMatch(/created=\d+/);
    });

    test('signature is verifiable with corresponding public key', () => {
      const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
      const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }) as string;
      const did = 'did:gitlawb:z6MkVerifyTest';

      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did, privateKeyPem: pem });

      const body = JSON.stringify({ '@type': 'Agent', did });
      const headers = (integration as any).buildSignatureHeaders('POST', '/api/v1/agents', body);

      // Reconstruct the signature base to verify
      const contentDigest = headers['content-digest'];
      const createdMatch = headers['signature-input'].match(/created=(\d+)/);
      const created = createdMatch ? createdMatch[1] : '';
      const sigBase = [
        `"@method": POST`,
        `"@path": /api/v1/agents`,
        `"content-digest": ${contentDigest}`,
        `"@signature-params": ("@method" "@path" "content-digest");keyid="${did}";alg="ed25519";created=${created}`,
      ].join('\n');

      // Extract raw signature bytes
      const rawSig = Buffer.from(headers['signature'].replace(/^sig1=:|:$/g, ''), 'base64');
      const valid = crypto.verify(null, Buffer.from(sigBase, 'utf8'), publicKey, rawSig);
      expect(valid).toBe(true);
    });

    test('no content-digest for requests without body', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did: testDid, privateKeyPem });

      const headers = (integration as any).buildSignatureHeaders('GET', '/api/v1/repos', '');
      expect(headers).not.toHaveProperty('content-digest');
      expect(headers['signature-input']).not.toContain('content-digest');
    });
  });

  describe('Review Formatting', () => {
    const mockAnalysis = {
      query_hash: 'abc123',
      query_id: 'qid-1',
      query_type: 'contract_audit' as const,
      timestamp: Date.now(),
      status: 'success' as const,
      risk_level: 'HIGH' as const,
      confidence: 0.91,
      audit_hash: 'deadbeef1234567890abcdef',
      openclaude_version: 'claude-opus-4-7',
      metadata: { tokens_used: 800, model: 'claude-opus-4-7', latency_ms: 1200, cache_hit: false },
      findings: [
        {
          type: 'REGULATORY' as const,
          severity: 'HIGH' as const,
          description: 'Token transfer may constitute unregistered securities offering.',
          remediation: 'Consult securities counsel before mainnet deploy.',
          reference: 'SEC v. W.J. Howey Co.',
        },
      ],
    };

    test('formats review markdown with correct risk emoji', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did: testDid, privateKeyPem });

      const md = (integration as any).formatReview(mockAnalysis);
      expect(md).toContain('🟠'); // HIGH emoji
      expect(md).toContain('HIGH');
      expect(md).toContain('91%');
      expect(md).toContain('deadbeef12345678');
      expect(md).toContain('REGULATORY');
      expect(md).toContain('SEC v. W.J. Howey Co.');
      expect(md).toContain('getlawb');
    });

    test('emits APPROVE verdict for LOW risk', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did: testDid, privateKeyPem });
      const md = (integration as any).formatReview({ ...mockAnalysis, risk_level: 'LOW', findings: [] });
      expect(md).toContain('🟢');
      expect(md).toContain('No legal issues detected.');
    });

    test('emits CRITICAL emoji for CRITICAL risk', () => {
      const client = new GetlawbClient('test-key');
      const integration = new GitlawbIntegration(client, { did: testDid, privateKeyPem });
      const md = (integration as any).formatReview({ ...mockAnalysis, risk_level: 'CRITICAL' });
      expect(md).toContain('🔴');
    });
  });
});
