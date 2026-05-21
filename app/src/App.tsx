import { useState, useRef, useEffect, useCallback } from 'react';
import { Message, QuickAction } from './types';
import { askLex } from './api';
import { ChatMessage } from './components/ChatMessage';
import { AnalysisCard } from './components/AnalysisCard';
import './App.css';

const QUICK_ACTIONS: QuickAction[] = [
  { icon: '📋', label: 'Contract Audit', prompt: 'Audit this Solidity contract for legal and regulatory issues:\n\n```solidity\n// paste your contract here\n```' },
  { icon: '⚖️', label: 'Token Airdrop', prompt: 'Is a token airdrop to 10,000 wallets compliant under US securities law?' },
  { icon: '🏛️', label: 'DAO Governance', prompt: 'What are the legal risks of a DAO treasury vote to distribute tokens to contributors?' },
  { icon: '🔍', label: 'DeFi Risk', prompt: 'What regulatory exposure does a DeFi lending protocol have under MiCA and US law?' },
  { icon: '🪙', label: 'Token Sale', prompt: 'Is launching a utility token sale without KYC legal in the EU?' },
  { icon: '📝', label: 'Custom Query', prompt: '' },
];

const WELCOME: Message = {
  id: 'welcome',
  role: 'lex',
  text: `Hi, I'm **Lex** — getlawb's AI legal front desk on the gitlawb network.\n\nI can help with smart contract audits, token regulations, DAO governance, and general Web3 legal questions.\n\nWhat's your legal question today?`,
  timestamp: new Date(),
};

function uid() {
  return Math.random().toString(36).slice(2);
}

export default function App() {
  const [messages, setMessages] = useState<Message[]>([WELCOME]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(async (question: string) => {
    const q = question.trim();
    if (!q || loading) return;

    const userMsg: Message = { id: uid(), role: 'user', text: q, timestamp: new Date() };
    const thinkingMsg: Message = { id: uid(), role: 'thinking', timestamp: new Date() };

    setMessages((m) => [...m, userMsg, thinkingMsg]);
    setInput('');
    setLoading(true);

    try {
      const analysis = await askLex(q);

      setMessages((m) => {
        const filtered = m.filter((x) => x.role !== 'thinking');
        const analysisMsg: Message = { id: uid(), role: 'analysis', analysis, timestamp: new Date() };
        const followup: Message = {
          id: uid(),
          role: 'lex',
          text: `Analysis complete. Risk level: **${analysis.risk_level}** · ${analysis.findings.length} finding${analysis.findings.length !== 1 ? 's' : ''}.\n\nDo you have any follow-up questions?`,
          timestamp: new Date(),
        };
        return [...filtered, analysisMsg, followup];
      });
    } catch (err) {
      setMessages((m) => {
        const filtered = m.filter((x) => x.role !== 'thinking');
        const errMsg: Message = {
          id: uid(),
          role: 'lex',
          text: `Sorry, I couldn't complete the analysis right now. Please try again in a moment.\n\n_Error: ${err instanceof Error ? err.message : String(err)}_`,
          timestamp: new Date(),
        };
        return [...filtered, errMsg];
      });
    } finally {
      setLoading(false);
    }
  }, [loading]);

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send(input);
    }
  };

  const handleQuickAction = (action: QuickAction) => {
    if (action.prompt) {
      setInput(action.prompt);
      textareaRef.current?.focus();
    } else {
      textareaRef.current?.focus();
    }
  };

  return (
    <div className="layout">
      {/* Sidebar */}
      <aside className="sidebar">
        <div className="logo">
          <span className="logo-icon">⚖️</span>
          <div>
            <div className="logo-name">getlawb</div>
            <div className="logo-sub">Legal Front Desk</div>
          </div>
        </div>

        <div className="sidebar-section-label">Quick Actions</div>
        <nav className="quick-actions">
          {QUICK_ACTIONS.map((a) => (
            <button key={a.label} className="quick-btn" onClick={() => handleQuickAction(a)}>
              <span className="quick-icon">{a.icon}</span>
              <span>{a.label}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="agent-badge">
            <span className="badge-dot" />
            <span>Lex is online</span>
          </div>
          <a className="powered-by" href="https://github.com/grxkun/getlawb" target="_blank" rel="noreferrer">
            powered by getlawb
          </a>
        </div>
      </aside>

      {/* Main */}
      <main className="chat-panel">
        <header className="chat-header">
          <div className="lex-avatar">L</div>
          <div>
            <div className="lex-name">Lex</div>
            <div className="lex-role">AI Legal Assistant · gitlawb network</div>
          </div>
          <div className="header-badge">🔒 Signed · Ed25519</div>
        </header>

        <div className="messages">
          {messages.map((msg) =>
            msg.role === 'analysis' && msg.analysis ? (
              <AnalysisCard key={msg.id} analysis={msg.analysis} />
            ) : (
              <ChatMessage key={msg.id} message={msg} />
            )
          )}
          <div ref={bottomRef} />
        </div>

        <div className="input-bar">
          <textarea
            ref={textareaRef}
            className="input-field"
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKey}
            placeholder="Ask a legal question… (Shift+Enter for new line)"
            disabled={loading}
          />
          <button
            className="send-btn"
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            aria-label="Send"
          >
            {loading ? <span className="spinner" /> : '↑'}
          </button>
        </div>
      </main>
    </div>
  );
}
