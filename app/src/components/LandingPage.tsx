import { useEffect, useRef, useState } from 'react';
import './LandingPage.css';

const LEX_INTRO =
  "Hello! I'm Lex, your AI legal front desk assistant on the gitlawb network. " +
  "I help Web3 teams with smart contract audits, token regulatory checks, DAO governance validation, and DeFi compliance. " +
  "Just click Talk to Lex to get started — I'm here whenever you need legal guidance.";

function useLexVoice() {
  const [speaking, setSpeaking] = useState(false);
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);

  const speak = () => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(LEX_INTRO);
    u.rate = 0.92;
    u.pitch = 1.05;
    u.volume = 1;
    // Prefer a natural English voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.lang.startsWith('en') && (v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Samantha'))
    ) ?? voices.find((v) => v.lang.startsWith('en'));
    if (preferred) u.voice = preferred;
    u.onstart = () => setSpeaking(true);
    u.onend = () => setSpeaking(false);
    u.onerror = () => setSpeaking(false);
    utteranceRef.current = u;
    window.speechSynthesis.speak(u);
  };

  const stop = () => {
    window.speechSynthesis?.cancel();
    setSpeaking(false);
  };

  // Auto-play on mount (works without gesture in most browsers for speech synthesis)
  useEffect(() => {
    const timer = setTimeout(speak, 800);
    return () => {
      clearTimeout(timer);
      window.speechSynthesis?.cancel();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { speaking, speak, stop };
}

const FEATURES = [
  { icon: '📋', title: 'Contract Audit', desc: 'Instant regulatory review of Solidity smart contracts. Flags liability gaps before deployment.' },
  { icon: '⚖️', title: 'Regulatory Check', desc: 'Token sales, airdrops, ICOs — know your exposure under SEC, MiCA, and global frameworks.' },
  { icon: '🏛️', title: 'DAO Governance', desc: 'Validate proposals and treasury actions against legal risk before the vote goes live.' },
  { icon: '🔍', title: 'Risk Assessment', desc: 'Open-ended legal questions answered with structured findings and remediation steps.' },
];

const STATS = [
  { value: 'Ed25519', label: 'Signed responses' },
  { value: 'On-chain', label: 'Audit hash' },
  { value: 'Free', label: 'Powered by Ollama' },
  { value: 'gitlawb', label: 'Native network' },
];

export function LandingPage({ onEnter }: { onEnter: () => void }) {
  const { speaking, speak, stop } = useLexVoice();

  return (
    <div className="landing">
      {/* Nav */}
      <nav className="lnav">
        <div className="lnav-logo">
          <span className="lnav-icon">⚖️</span>
          <span className="lnav-name">getlawb</span>
        </div>
        <a
          className="lnav-link"
          href="https://github.com/grxkun/getlawb"
          target="_blank"
          rel="noreferrer"
        >
          GitHub ↗
        </a>
      </nav>

      {/* Hero */}
      <section className="hero">
        <div className="hero-badge-row">
          <div className="hero-badge">
            <span className="badge-pulse" />
            Lex is online · gitlawb network
          </div>
          <button
            className={`voice-btn ${speaking ? 'voice-btn-active' : ''}`}
            onClick={speaking ? stop : speak}
            title={speaking ? 'Stop' : 'Hear Lex introduce herself'}
          >
            {speaking ? (
              <>
                <span className="voice-wave"><span/><span/><span/><span/></span>
                Stop
              </>
            ) : (
              <>🔊 Hear Lex</>
            )}
          </button>
        </div>

        <h1 className="hero-title">
          Your AI Legal<br />
          <span className="hero-accent">Front Desk</span><br />
          for Web3
        </h1>

        <p className="hero-sub">
          Instant smart contract audits, token regulatory checks, and DAO governance validation —
          powered by getlawb, running natively on the gitlawb network.
        </p>

        <div className="hero-actions">
          <button className="btn-primary" onClick={onEnter}>
            Talk to Lex →
          </button>
          <a
            className="btn-ghost"
            href="https://gitlawb.com/node/repos/z6MkrHBosLdDgewqRbZjK1VuEqWLeJAcEQ56Szrq3Lj7RLED/getlawb"
            target="_blank"
            rel="noreferrer"
          >
            View on gitlawb
          </a>
        </div>

        <div className="hero-preview">
          <div className="preview-bar">
            <span className="preview-dot r" /><span className="preview-dot y" /><span className="preview-dot g" />
            <span className="preview-title">lex — getlawb front desk</span>
          </div>
          <div className="preview-body">
            <div className="preview-msg preview-lex">
              <span className="preview-avatar">L</span>
              <div className="preview-bubble">
                Hi! I'm <strong>Lex</strong>, getlawb's AI legal assistant. What's your Web3 legal question?
              </div>
            </div>
            <div className="preview-msg preview-user">
              <div className="preview-bubble preview-bubble-user">
                Is our token airdrop compliant under US securities law?
              </div>
              <span className="preview-avatar preview-avatar-user">U</span>
            </div>
            <div className="preview-msg preview-lex">
              <span className="preview-avatar">L</span>
              <div className="preview-bubble preview-analysis">
                <div className="pa-header">
                  <span>getlawb Legal Analysis</span>
                  <span className="pa-badge pa-medium">🟡 MEDIUM</span>
                </div>
                <div className="pa-row"><span>Confidence</span><span>80%</span></div>
                <div className="pa-row"><span>Findings</span><span>2 issues detected</span></div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Stats */}
      <section className="stats">
        {STATS.map((s) => (
          <div key={s.label} className="stat">
            <div className="stat-value">{s.value}</div>
            <div className="stat-label">{s.label}</div>
          </div>
        ))}
      </section>

      {/* Features */}
      <section className="features">
        <h2 className="section-title">What Lex can do</h2>
        <div className="feature-grid">
          {FEATURES.map((f) => (
            <div key={f.title} className="feature-card">
              <span className="feature-icon">{f.icon}</span>
              <h3 className="feature-title">{f.title}</h3>
              <p className="feature-desc">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="how">
        <h2 className="section-title">How it works</h2>
        <div className="steps">
          <div className="step">
            <div className="step-num">1</div>
            <div>
              <div className="step-title">Ask a question</div>
              <div className="step-desc">Type your legal question or paste a Solidity contract.</div>
            </div>
          </div>
          <div className="step-arrow">→</div>
          <div className="step">
            <div className="step-num">2</div>
            <div>
              <div className="step-title">Lex analyzes</div>
              <div className="step-desc">getlawb routes to the right query type and runs AI analysis via Ollama.</div>
            </div>
          </div>
          <div className="step-arrow">→</div>
          <div className="step">
            <div className="step-num">3</div>
            <div>
              <div className="step-title">Signed findings</div>
              <div className="step-desc">Results are returned with an Ed25519-signed audit hash for tamper detection.</div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="cta">
        <h2 className="cta-title">Ready to talk to Lex?</h2>
        <p className="cta-sub">Free, no signup, running on the gitlawb network.</p>
        <button className="btn-primary btn-lg" onClick={onEnter}>
          Open Front Desk →
        </button>
      </section>

      {/* Footer */}
      <footer className="footer">
        <span>
          Built on{' '}
          <a href="https://gitlawb.com" target="_blank" rel="noreferrer">gitlawb</a>
          {' '}·{' '}
          <a href="https://github.com/grxkun/getlawb" target="_blank" rel="noreferrer">getlawb</a>
          {' '}· Not legal advice
        </span>
      </footer>
    </div>
  );
}
