import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { Send, Bot, User, Loader2, ChevronDown } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
}

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
}

export function ChatDrawer({ isOpen, onClose }: ChatDrawerProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'intro',
    role: 'coach',
    text: "Hey! I'm your VitalSync AI Coach. I have live access to your dashboard data. What's on your mind today?"
  }]);

  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to bottom only when new messages are added and we actually overflow
  useEffect(() => {
    if (isOpen) {
      setTimeout(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        inputRef.current?.focus(); // autofocus when opened!
      }, 150);
    }
  }, [messages, isLoading, isOpen]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');

    // Add user's message immediately to the UI
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      const validHistory = messages.filter(m => m.id !== 'intro' && !m.text.includes("❌"));
      const windowedHistory = validHistory.slice(-10).map(m => ({
        role: m.role == 'coach' ? 'model' : 'user',
        parts: [{ text: m.text }]
      }))

      const res = await api.post('/ai/chat', { message: userText, history: windowedHistory });

      // Add the AI's reply to the UI
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(),
        role: 'coach',
        text: res.data.reply
      }]);
    } catch (error) {
      setMessages(prev => [...prev, {
        id: Date.now().toString(),
        role: 'coach',
        text: "❌ Sorry, I had trouble connecting to the 'brain'. Check your server logs!"
      }]);
    } finally {
      setIsLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50); // Refocus after response
    }
  };

  return (
    <>
      {/* Invisible backdrop when open to catch clicks outside to close */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/20 backdrop-blur-sm transition-opacity"
          onClick={onClose}
        />
      )}

      {/* The Bottom Sheet Drawer */}
      <div
        className={`fixed bottom-[64px] left-0 right-0 max-w-md mx-auto bg-[#17171C]/95 backdrop-blur-xl border-x border-t border-border rounded-t-3xl shadow-[0_-10px_40px_rgba(0,0,0,0.5)] z-50 flex flex-col transition-all duration-400 ease-[cubic-bezier(0.32,0.72,0,1)] ${isOpen ? 'translate-y-0 opacity-100' : 'translate-y-full opacity-0 pointer-events-none'
          }`}
        style={{
          maxHeight: 'calc(100vh - 120px)', // doesn't cover top header
          height: messages.length < 3 ? 'auto' : '85vh' // grows to 85% of screen natively
        }}
      >
        {/* Header with drag handle/close button */}
        <div className="flex-none flex flex-col items-center pt-3 pb-2 px-4 border-b border-white/5 relative bg-white/5 rounded-t-3xl cursor-pointer" onClick={onClose}>
          <div className="w-12 h-1.5 bg-white/20 rounded-full mb-3" />
          <div className="w-full flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="bg-accent/20 p-1.5 rounded-xl">
                <Bot className="w-5 h-5 text-accent" />
              </div>
              <div>
                <h1 className="font-bold text-sm leading-tight">AI Coach</h1>
                <p className="text-[10px] text-text-muted">Live Context Linked</p>
              </div>
            </div>
            <button onClick={(e) => { e.stopPropagation(); onClose(); }} className="text-text-muted hover:text-white bg-white/5 rounded-full p-1.5">
              <ChevronDown className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chat History Area (allows scrolling) */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-4">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`flex gap-2 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>

                {/* Avatar */}
                <div className="flex-shrink-0 mt-auto">
                  {msg.role === 'coach' ? (
                    <div className="bg-white/10 p-1.5 rounded-full">
                      <Bot className="w-3.5 h-3.5 text-accent" />
                    </div>
                  ) : (
                    <div className="bg-accent text-white p-1.5 rounded-full">
                      <User className="w-3.5 h-3.5" />
                    </div>
                  )}
                </div>

                {/* Message Bubble */}
                <div
                  className={`p-3 rounded-2xl ${msg.role === 'user'
                      ? 'bg-accent text-white rounded-br-sm'
                      : 'bg-white/5 border border-white/10 text-text-primary rounded-bl-sm'
                    }`}
                >
                  {msg.role === 'user' ? (
                    <p className="text-[13px] leading-relaxed">{msg.text}</p>
                  ) : (
                    <div className="text-[13px] leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1">
                      <ReactMarkdown>{msg.text}</ReactMarkdown>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Loading Indicator */}
          {isLoading && (
            <div className="flex justify-start">
              <div className="bg-white/5 border border-white/10 p-3 rounded-2xl rounded-bl-sm flex gap-2 items-center">
                <Loader2 className="w-3.5 h-3.5 animate-spin text-accent" />
                <span className="text-[13px] text-text-muted">Analyzing dashboard...</span>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} className="h-1" />
        </div>

        {/* Dedicated Input Area Inside Drawer */}
        <div className="flex-none p-3 border-t border-border bg-bg-primary/95 backdrop-blur-3xl rounded-none pb-safe">
          <form onSubmit={sendMessage} className="relative flex items-center">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              disabled={isLoading}
              placeholder="Ask about your diet or workouts..."
              className="w-full bg-black/40 border border-white/10 rounded-full pl-4 pr-12 py-3.5 text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={!input.trim() || isLoading}
              className="absolute right-1.5 p-2 bg-accent hover:bg-accent/80 text-white rounded-full transition-colors disabled:opacity-50 disabled:hover:bg-accent"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>
    </>
  );
}
