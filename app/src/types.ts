export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface Finding {
  type: string;
  severity: RiskLevel;
  description: string;
  remediation?: string;
  reference?: string;
}

export interface Analysis {
  risk_level: RiskLevel;
  confidence: number;
  audit_hash: string;
  query_type: string;
  findings: Finding[];
}

export type MessageRole = 'lex' | 'user' | 'analysis' | 'thinking';

export interface Message {
  id: string;
  role: MessageRole;
  text?: string;
  analysis?: Analysis;
  timestamp: Date;
}

export type QuickAction = {
  label: string;
  icon: string;
  prompt: string;
};
