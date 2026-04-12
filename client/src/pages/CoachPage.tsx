// client/src/pages/CoachPage.tsx
import { useState, useRef, useEffect } from 'react';
import { api } from '../lib/api';
import { Send, Bot, User, Loader2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface ChatMessage {
  id: string;
  role: 'user' | 'coach';
  text: string;
}

export function CoachPage() {
  const [messages, setMessages] = useState<ChatMessage[]>([{
    id: 'intro',
    role: 'coach',
    text: "Hey! I'm your VitalSync AI Coach. I have live access to your dashboard data. What's on your mind today?"
  }]);
  
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the bottom whenever messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    const userText = input.trim();
    setInput('');
    
    // Add user's message immediately to the UI
    setMessages(prev => [...prev, { id: Date.now().toString(), role: 'user', text: userText }]);
    setIsLoading(true);

    try {
      // Call the brand new /api/ai/chat route!
      // Our api.ts interceptor automatically attaches your JWT token.
      const res = await api.post('/ai/chat', { message: userText });
      
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
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-64px)] w-full">
      {/* Header */}
      <div className="p-4 border-b border-border bg-bg-primary/80 backdrop-blur-md sticky top-0 z-10 flex items-center gap-3">
        <div className="bg-accent/20 p-2 rounded-xl">
          <Bot className="w-6 h-6 text-accent" />
        </div>
        <div>
          <h1 className="font-bold text-lg leading-tight">AI Coach</h1>
          <p className="text-xs text-text-muted">Live Dashboard Analysis</p>
        </div>
      </div>

      {/* Chat History Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 pb-24">
        {messages.map((msg) => (
          <div 
            key={msg.id} 
            className={`flex w-full ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div className={`flex gap-3 max-w-[85%] ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}>
              
              {/* Avatar */}
              <div className="flex-shrink-0 mt-auto">
                {msg.role === 'coach' ? (
                  <div className="bg-white/10 p-1.5 rounded-full">
                    <Bot className="w-4 h-4 text-accent" />
                  </div>
                ) : (
                  <div className="bg-accent text-white p-1.5 rounded-full">
                    <User className="w-4 h-4" />
                  </div>
                )}
              </div>

              {/* Message Bubble */}
              <div
                className={`p-3 rounded-2xl ${
                  msg.role === 'user'
                    ? 'bg-accent text-white rounded-br-sm'
                    : 'glass border border-border text-text-primary rounded-bl-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  <p className="text-sm leading-relaxed">{msg.text}</p>
                ) : (
                  <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none prose-p:my-1 prose-ul:my-1 prose-li:my-0 prose-headings:my-1">
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
             <div className="glass border border-border p-3 rounded-2xl rounded-bl-sm flex gap-2 items-center">
                 <Loader2 className="w-4 h-4 animate-spin text-accent" />
                 <span className="text-sm text-text-muted">Analyzing dashboard...</span>
             </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="fixed bottom-[64px] left-0 right-0 p-3 bg-bg-primary/95 border-t border-border backdrop-blur-md">
        <form onSubmit={sendMessage} className="max-w-md mx-auto relative flex items-center">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            disabled={isLoading}
            placeholder="Ask about your diet or workouts..."
            className="w-full bg-white/5 border border-border rounded-full pl-4 pr-12 py-3 text-sm focus:outline-none focus:border-accent transition-colors disabled:opacity-50"
          />
          <button 
            type="submit"
            disabled={!input.trim() || isLoading}
            className="absolute right-2 p-2 bg-accent hover:bg-accent/80 text-white rounded-full transition-colors disabled:opacity-50 disabled:hover:bg-accent"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>
    </div>
  );
}
