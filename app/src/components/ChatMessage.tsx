import { Message } from '../types';
import './ChatMessage.css';

function renderMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>')
    .replace(/\n/g, '<br/>');
}

export function ChatMessage({ message }: { message: Message }) {
  if (message.role === 'thinking') {
    return (
      <div className="msg msg-lex">
        <div className="msg-avatar">L</div>
        <div className="msg-bubble msg-bubble-lex thinking-bubble">
          <span className="dot" /><span className="dot" /><span className="dot" />
        </div>
      </div>
    );
  }

  const isLex = message.role === 'lex';
  return (
    <div className={`msg ${isLex ? 'msg-lex' : 'msg-user'}`}>
      {isLex && <div className="msg-avatar">L</div>}
      <div className={`msg-bubble ${isLex ? 'msg-bubble-lex' : 'msg-bubble-user'}`}>
        <span dangerouslySetInnerHTML={{ __html: renderMarkdown(message.text ?? '') }} />
      </div>
      {!isLex && <div className="msg-avatar msg-avatar-user">U</div>}
    </div>
  );
}
