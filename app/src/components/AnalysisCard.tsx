import { Analysis, RiskLevel } from '../types';
import './AnalysisCard.css';

const RISK_EMOJI: Record<RiskLevel, string> = {
  LOW: '🟢', MEDIUM: '🟡', HIGH: '🟠', CRITICAL: '🔴',
};

const RISK_CLASS: Record<RiskLevel, string> = {
  LOW: 'risk-low', MEDIUM: 'risk-medium', HIGH: 'risk-high', CRITICAL: 'risk-critical',
};

export function AnalysisCard({ analysis }: { analysis: Analysis }) {
  return (
    <div className="analysis-card">
      <div className="card-header">
        <span className="card-title">getlawb Legal Analysis</span>
        <span className={`risk-badge ${RISK_CLASS[analysis.risk_level]}`}>
          {RISK_EMOJI[analysis.risk_level]} {analysis.risk_level}
        </span>
      </div>

      <div className="card-meta">
        <div className="meta-item">
          <span className="meta-label">Confidence</span>
          <span className="meta-value">{Math.round(analysis.confidence * 100)}%</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Query Type</span>
          <span className="meta-value">{analysis.query_type.replace('_', ' ')}</span>
        </div>
        <div className="meta-item">
          <span className="meta-label">Audit Hash</span>
          <span className="meta-value mono">{analysis.audit_hash.slice(0, 12)}…</span>
        </div>
      </div>

      {analysis.findings.length === 0 ? (
        <div className="no-findings">✅ No legal issues detected.</div>
      ) : (
        <div className="findings">
          <div className="findings-label">Findings ({analysis.findings.length})</div>
          {analysis.findings.map((f, i) => (
            <div key={i} className={`finding finding-${f.severity.toLowerCase()}`}>
              <div className="finding-header">
                <span className="finding-sev">{RISK_EMOJI[f.severity]}</span>
                <span className="finding-type">{f.type}</span>
                <span className="finding-badge">{f.severity}</span>
              </div>
              <p className="finding-desc">{f.description}</p>
              {f.remediation && (
                <p className="finding-fix">💡 {f.remediation}</p>
              )}
              {f.reference && (
                <p className="finding-ref">📎 {f.reference}</p>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="card-footer">
        Powered by{' '}
        <a href="https://github.com/grxkun/getlawb" target="_blank" rel="noreferrer">
          getlawb
        </a>{' '}
        on gitlawb · not legal advice
      </div>
    </div>
  );
}
