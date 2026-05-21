import { GetlawbClient, GitlawbIntegration, GitlawbWebhookServer } from './src/index';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'getlawb-secret';
const DID = 'did:key:z6MkrHBosLdDgewqRbZjK1VuEqWLeJAcEQ56Szrq3Lj7RLED';
const KEY_PATH = '/home/codespace/.gitlawb/identity.pem';

if (!ANTHROPIC_API_KEY) {
  console.error('ANTHROPIC_API_KEY is required');
  process.exit(1);
}

const client = new GetlawbClient(ANTHROPIC_API_KEY);
const integration = new GitlawbIntegration(client, { did: DID, keyPath: KEY_PATH });
const server = new GitlawbWebhookServer(integration, {
  port: 3000,
  secret: WEBHOOK_SECRET,
  onAnalysis: (event, summary) => {
    console.log(`[${new Date().toISOString()}] ${summary}`);
  },
});

server.start().then((port) => {
  console.log(`getlawb webhook server running on port ${port}`);
  console.log(`Public URL: https://opulent-winner-579xpg4gx76hv67w-${port}.app.github.dev`);
});
