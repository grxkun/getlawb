require('dotenv').config();
const { GetlawbClient } = require('./dist/client');
const { GitlawbIntegration } = require('./dist/gitlawb');
const { GitlawbWebhookServer } = require('./dist/webhook');
const { GitlawbAutoReply } = require('./dist/autoreply');

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'getlawb-secret';
const DID = process.env.GITLAWB_DID || 'did:key:z6MkrHBosLdDgewqRbZjK1VuEqWLeJAcEQ56Szrq3Lj7RLED';
const KEY_PATH = process.env.GITLAWB_KEY || '/root/.gitlawb/identity.pem';
const OWNER = process.env.GITLAWB_OWNER || DID.replace('did:key:', '');
const REPO = process.env.GITLAWB_REPO || 'getlawb';

if (!ANTHROPIC_API_KEY && !OLLAMA_BASE_URL) {
  console.error('Set ANTHROPIC_API_KEY (Anthropic) or OLLAMA_BASE_URL (e.g. http://localhost:11434)');
  process.exit(1);
}

const clientConfig = OLLAMA_BASE_URL
  ? { baseUrl: OLLAMA_BASE_URL }
  : { apiKey: ANTHROPIC_API_KEY };

const client = new GetlawbClient(clientConfig);
const integration = new GitlawbIntegration(client, { did: DID, keyPath: KEY_PATH });

// Webhook server — handles PR review on pull_request.opened
const server = new GitlawbWebhookServer(integration, {
  port: 3000,
  secret: WEBHOOK_SECRET,
  onAnalysis: (event, summary) => {
    console.log(`[${new Date().toISOString()}] PR review: ${summary}`);
  },
});

// Auto-reply — polls for new issues with legal keywords
const autoReply = new GitlawbAutoReply(client, integration);

server.start().then(async (port) => {
  const backend = OLLAMA_BASE_URL ? `Ollama (${OLLAMA_BASE_URL})` : 'Anthropic';
  console.log(`getlawb webhook server running on port ${port} [${backend}]`);
  console.log(`Watching ${OWNER}/${REPO} for issues...`);

  await autoReply.watch({
    owner: OWNER,
    repo: REPO,
    onReply: (issue, analysis) => {
      console.log(`[${new Date().toISOString()}] Issue ${issue.id.slice(0, 8)} replied: ${analysis.risk_level}`);
    },
  });
});
