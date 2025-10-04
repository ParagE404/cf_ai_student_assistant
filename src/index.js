/**
 * Cloudflare AI Chat Assistant
 * Built for CS assignment - integrates Workers AI with persistent chat memory
 * Author: Parag Dharadhar
 */

// TODO: Maybe add rate limiting per user session in the future
// FIXME: Consider optimizing conversation history storage for large conversations

/**
 * ChatMemory Durable Object - handles persistent conversation storage
 * Each instance manages chat state for a single user session
 */
export class ChatMemory {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    // Could add more initialization here later
  }

  async fetch(request) {
    const url = new URL(request.url);
    
    // Handle POST requests for chat operations
    if (url.pathname === '/chat' && request.method === 'POST') {
      try {
        const { message, action } = await request.json();
        
        if (action === 'clear') {
          return await this.clearConversation();
        } else if (message) {
          return await this.processMessage(message);
        } else {
          return Response.json({ error: 'Message required' }, { status: 400 });
        }
      } catch (error) {
        console.error('Error parsing request:', error);
        return Response.json({ 
          error: 'Invalid request format' 
        }, { status: 400 });
      }
    }
    
    // GET request for conversation history
    if (url.pathname === '/history' && request.method === 'GET') {
      try {
        const messages = await this.state.storage.get('messages') || [];
        // Only return last 10 messages to keep response size manageable
        return Response.json({ messages: messages.slice(-10) });
      } catch (error) {
        console.error('Failed to load history:', error);
        return Response.json({ messages: [] }); // fallback to empty array
      }
    }

    return new Response('Not found', { status: 404 });
  }

  async processMessage(userMessage) {
    try {
      // Load existing conversation from storage
      let conversationHistory = await this.state.storage.get('messages') || [];
      
      // Add the user's message to our conversation log
      const userMsgObj = {
        role: 'user',
        content: userMessage,
        timestamp: new Date().toISOString()
      };
      conversationHistory.push(userMsgObj);

      // Prepare messages for AI - include system prompt + recent context
      const messagesToSend = [
        {
          role: 'system',
          content: 'You are a helpful AI assistant built on Cloudflare Workers AI. You are knowledgeable, friendly, and concise in your responses. Help users with their questions and tasks. Format your responses with proper line breaks and structure for readability.'
        },
        // Include last 8 messages for context (to manage token usage)
        ...conversationHistory.slice(-8).map(msg => ({
          role: msg.role,
          content: msg.content
        }))
      ];

      // Call Cloudflare Workers AI - using the free Llama 3.3 model
      const aiResponse = await this.env.AI.run('@cf/meta/llama-3.3-70b-instruct-fp8-fast', {
        messages: messagesToSend,
        max_tokens: 500,  // Keep responses concise
        temperature: 0.7  // Bit of creativity but not too random
      });

      // Create response object and add to history
      const assistantMsgObj = {
        role: 'assistant',
        content: aiResponse.response,
        timestamp: new Date().toISOString()
      };

      conversationHistory.push(assistantMsgObj);
      
      // Save the updated conversation back to storage
      await this.state.storage.put('messages', conversationHistory);

      // Return success response
      return Response.json({
        success: true,
        response: aiResponse.response,
        timestamp: assistantMsgObj.timestamp
      });

    } catch (error) {
      console.error('AI processing error:', error);
      
      // Handle different error types
      let errorMessage = 'Sorry, I encountered an error. Please try again.';
      
      if (error.message && error.message.includes('quota')) {
        errorMessage = 'Daily AI usage limit reached. Please try again tomorrow or consider the student plan for higher limits.';
      } else if (error.message && error.message.includes('timeout')) {
        errorMessage = 'Request timed out. Please try again.';
      }
      
      return Response.json({
        success: false,
        error: errorMessage
      }, { status: 500 });
    }
  }

  async clearConversation() {
    try {
      // Reset conversation history
      await this.state.storage.put('messages', []);
      
      return Response.json({
        success: true,
        message: 'Conversation history cleared!'
      });
    } catch (error) {
      console.error('Error clearing conversation:', error);
      return Response.json({
        success: false,
        error: 'Failed to clear conversation'
      }, { status: 500 });
    }
  }
}

/**
 * Main Worker - handles routing and serves the chat interface
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Serve the main chat page
    if (url.pathname === '/' || url.pathname === '/index.html') {
      return new Response(getChatHTML(), {
        headers: { 
          'Content-Type': 'text/html',
          'Cache-Control': 'public, max-age=3600' // Cache for 1 hour
        }
      });
    }

    // Route API requests to the appropriate Durable Object
    if (url.pathname === '/api/chat' || url.pathname === '/api/history') {
      // Extract session ID from query params, default to 'default' if none provided
      const sessionId = url.searchParams.get('session') || 'default';
      
      // Get the Durable Object instance for this session
      const durableObjectId = env.CHAT_MEMORY.idFromName(sessionId);
      const durableObject = env.CHAT_MEMORY.get(durableObjectId);
      
      // Forward the request to the Durable Object with the correct path
      const newUrl = new URL(request.url);
      newUrl.pathname = url.pathname === '/api/chat' ? '/chat' : '/history';
      
      const forwardedRequest = new Request(newUrl.toString(), {
        method: request.method,
        headers: request.headers,
        body: request.body
      });
      
      return durableObject.fetch(forwardedRequest);
    }

    // Simple health check endpoint
    if (url.pathname === '/api/health') {
      return Response.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'Cloudflare AI Assistant',
        components: {
          ai: 'operational',
          durableObjects: 'operational',
          memory: 'operational'
        }
      });
    }

    // 404 for everything else
    return new Response('Not Found', { 
      status: 404,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
};

/**
 * Returns the HTML for our chat interface
 * Kept inline to avoid extra file management - could be externalized later
 */
function getChatHTML() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>CF AI Assistant</title>
    <meta name="description" content="AI-powered assistant built on Cloudflare Workers AI">
    <style>
        /* Apple Liquid Glass Design System (iOS 26 / WWDC 2025) */
        
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
            background: radial-gradient(ellipse 80% 50% at 50% -20%, rgba(120, 119, 198, 0.3), transparent),
                        radial-gradient(ellipse 80% 80% at 80% 80%, rgba(255, 119, 198, 0.15), transparent),
                        radial-gradient(ellipse 80% 100% at 20% 30%, rgba(120, 200, 255, 0.2), transparent),
                        linear-gradient(135deg, #f5f7fa 0%, #c3cfe2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
            overflow: hidden;
            position: relative;
            -webkit-font-smoothing: antialiased;
            text-rendering: optimizeLegibility;
        }
        
        /* Liquid Glass Environment Effects */
        body::before {
            content: '';
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: 
                radial-gradient(600px circle at var(--mouse-x, 50%) var(--mouse-y, 50%), rgba(255, 255, 255, 0.06), transparent 40%);
            pointer-events: none;
            transition: opacity 0.3s ease;
            z-index: 1;
        }
        
        /* Liquid Glass Container */
        .chat-container {
		    border: 0px !important;
            width: 100%;
            max-width: 900px;
            height: 85vh;
            min-height: 600px;
            position: relative;
            z-index: 10;
            
            /* Authentic Liquid Glass Material */
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.1), rgba(255, 255, 255, 0.05)),
                linear-gradient(135deg, rgba(255, 255, 255, 0.8), rgba(255, 255, 255, 0.4));
            backdrop-filter: blur(40px) saturate(200%) contrast(120%) brightness(130%);
            -webkit-backdrop-filter: blur(40px) saturate(200%) contrast(120%) brightness(130%);
            
            /* Liquid Glass Border and Shadow System */
            border: 1px solid transparent;
            border-image: linear-gradient(135deg, 
                rgba(255, 255, 255, 0.4) 0%, 
                rgba(255, 255, 255, 0.1) 50%, 
                rgba(255, 255, 255, 0.4) 100%) 1;
                
            border-radius: 32px;
            box-shadow: 
                /* Primary depth shadow */
                0 25px 50px -12px rgba(0, 0, 0, 0.25),
                /* Liquid glass highlight */
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                inset 0 -1px 0 rgba(255, 255, 255, 0.1),
                /* Ambient glow */
                0 0 0 1px rgba(255, 255, 255, 0.05);
                
            display: flex;
            flex-direction: column;
            overflow: hidden;
            
            /* Liquid Glass Refraction Animation */
            animation: liquidGlassFloat 8s ease-in-out infinite;
            transform-style: preserve-3d;
        }
        
        @keyframes liquidGlassFloat {
            0%, 100% { 
                transform: translateY(0px) rotateX(0deg);
                box-shadow: 
                    0 25px 50px -12px rgba(0, 0, 0, 0.25),
                    inset 0 1px 0 rgba(255, 255, 255, 0.4),
                    0 0 0 1px rgba(255, 255, 255, 0.05);
            }
            50% { 
                transform: translateY(-3px) rotateX(0.5deg);
                box-shadow: 
                    0 35px 70px -12px rgba(0, 0, 0, 0.3),
                    inset 0 1px 0 rgba(255, 255, 255, 0.6),
                    0 0 0 1px rgba(255, 255, 255, 0.1);
            }
        }
        
        /* Liquid Glass Header */
        .chat-header {
            background: linear-gradient(135deg, 
                rgba(255, 255, 255, 0.3) 0%,
                rgba(255, 255, 255, 0.1) 100%);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            
            border-bottom: 1px solid rgba(255, 255, 255, 0.2);
            padding: 28px 24px;
            text-align: center;
            position: relative;
            
            /* Glass-like refraction highlight */
            background-image: 
                linear-gradient(135deg, transparent 0%, rgba(255, 255, 255, 0.1) 50%, transparent 100%);
        }
        
        .chat-header::before {
            content: '';
            position: absolute;
            top: 0;
            left: 20%;
            right: 20%;
            height: 1px;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.6), transparent);
        }
        
        .chat-header h1 {
            font-size: 1.75rem;
            font-weight: 700;
            color: #1d1d1f;
            margin-bottom: 6px;
            
            /* Liquid Glass Text Refraction */
            background: linear-gradient(135deg, #1d1d1f 0%, #424245 100%);
            -webkit-background-clip: text;
            background-clip: text;
            text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
        }
        
        .chat-header p {
            font-size: 0.875rem;
            font-weight: 500;
            color: rgba(29, 29, 31, 0.7);
            letter-spacing: -0.005em;
        }
        
        .status-indicator {
            position: absolute;
            top: 20px;
            right: 24px;
            padding: 6px 12px;
            
            /* Status Liquid Glass Material */
            background: rgba(52, 199, 89, 0.15);
            backdrop-filter: blur(10px) saturate(150%);
            border: 1px solid rgba(52, 199, 89, 0.3);
            border-radius: 20px;
            
            font-size: 0.75rem;
            font-weight: 600;
            color: #34c759;
            letter-spacing: 0.02em;
            
            box-shadow: 
                inset 0 1px 0 rgba(255, 255, 255, 0.3),
                0 1px 3px rgba(52, 199, 89, 0.2);
        }
        
        /* Messages Container with Liquid Glass Environment */
        .messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            
            /* Subtle inner gradient for depth */
            background: 
                radial-gradient(ellipse 50% 80% at 50% 0%, rgba(255, 255, 255, 0.05), transparent),
                linear-gradient(to bottom, rgba(255, 255, 255, 0.02), rgba(255, 255, 255, 0.1));
        }
        
        .messages-container::-webkit-scrollbar {
            width: 3px;
        }
        
        .messages-container::-webkit-scrollbar-track {
            background: transparent;
        }
        
        .messages-container::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.2);
            border-radius: 3px;
        }
        
        /* Liquid Glass Message Bubbles */
        .message {
            max-width: 320px;
            padding: 14px 18px;
            font-size: 16px;
            line-height: 1.4;
            font-weight: 400;
            position: relative;
            white-space: pre-wrap; /* Preserve line breaks */
            word-wrap: break-word;
            
            animation: liquidMessageAppear 0.6s cubic-bezier(0.23, 1, 0.32, 1);
            transform-origin: center bottom;
        }
        
        @keyframes liquidMessageAppear {
            0% { 
                opacity: 0; 
                transform: scale(0.8) translateY(20px);
                filter: blur(4px);
            }
            60% {
                transform: scale(1.02) translateY(-2px);
            }
            100% { 
                opacity: 1; 
                transform: scale(1) translateY(0);
                filter: blur(0px);
            }
        }
        
        .user-message {
            margin-left: auto;
            background: linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%);
            color: white;
            border-radius: 20px 20px 4px 20px;
            
            /* Liquid Glass Message Depth */
            box-shadow: 
                0 4px 16px rgba(0, 122, 255, 0.3),
                inset 0 1px 0 rgba(255, 255, 255, 0.3),
                0 1px 3px rgba(0, 0, 0, 0.1);
                
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .assistant-message {
            margin-right: auto;
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.7) 100%);
            backdrop-filter: blur(20px) saturate(180%) contrast(120%);
            -webkit-backdrop-filter: blur(20px) saturate(180%) contrast(120%);
            
            color: #1d1d1f;
            border-radius: 20px 20px 20px 4px;
            
            /* Assistant Message Liquid Glass Effect */
            border: 1px solid rgba(255, 255, 255, 0.4);
            box-shadow: 
                0 8px 32px rgba(0, 0, 0, 0.12),
                inset 0 1px 0 rgba(255, 255, 255, 0.8),
                inset 0 -1px 0 rgba(0, 0, 0, 0.05),
                0 0 0 1px rgba(255, 255, 255, 0.1);
        }
        
        .system-message {
            background: rgba(142, 142, 147, 0.15);
            backdrop-filter: blur(10px);
            color: rgba(60, 60, 67, 0.8);
            text-align: center;
            border-radius: 16px;
            font-size: 0.875rem;
            font-weight: 500;
            align-self: center;
            max-width: 85%;
            padding: 10px 16px;
            
            border: 1px solid rgba(142, 142, 147, 0.2);
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }
        
        .loading-indicator {
            margin-right: auto;
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.8) 0%, rgba(255, 255, 255, 0.6) 100%);
            backdrop-filter: blur(15px) saturate(150%);
            color: rgba(60, 60, 67, 0.8);
            border-radius: 20px 20px 20px 4px;
            font-style: normal;
            font-size: 0.875rem;
            font-weight: 500;
            display: none;
            position: relative;
            
            border: 1px solid rgba(255, 255, 255, 0.3);
            box-shadow: 
                0 4px 16px rgba(0, 0, 0, 0.1),
                inset 0 1px 0 rgba(255, 255, 255, 0.7);
        }
        
        /* Liquid Glass Input Section */
        .input-section {
            padding: 20px 24px 24px;
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.4) 0%, rgba(255, 255, 255, 0.2) 100%);
            backdrop-filter: blur(40px) saturate(200%);
            -webkit-backdrop-filter: blur(40px) saturate(200%);
            
            border-top: 1px solid rgba(255, 255, 255, 0.3);
            display: flex;
            gap: 12px;
            align-items: flex-end;
            
            /* Input section glass highlight */
            background-image: 
                radial-gradient(600px circle at 50% 0%, rgba(255, 255, 255, 0.1), transparent 50%);
        }
        
        .input-group {
            flex: 1;
            position: relative;
        }
        
        .message-input {
            width: 100%;
            padding: 14px 18px;
            
            /* Input Liquid Glass Material */
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.9) 0%, rgba(255, 255, 255, 0.8) 100%);
            backdrop-filter: blur(20px) saturate(180%);
            -webkit-backdrop-filter: blur(20px) saturate(180%);
            
            border: 1px solid rgba(255, 255, 255, 0.4);
            border-radius: 24px;
            outline: none;
            
            font-size: 16px;
            font-family: inherit;
            font-weight: 400;
            color: #1d1d1f;
            resize: none;
            min-height: 48px;
            max-height: 120px;
            
            transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            line-height: 1.4;
            
            box-shadow: 
                inset 0 2px 4px rgba(0, 0, 0, 0.06),
                inset 0 1px 0 rgba(255, 255, 255, 0.7),
                0 1px 3px rgba(0, 0, 0, 0.1);
        }
        
        .message-input::placeholder {
            color: rgba(60, 60, 67, 0.6);
        }
        
        .message-input:focus {
            border-color: rgba(0, 122, 255, 0.6);
            box-shadow: 
                0 0 0 4px rgba(0, 122, 255, 0.1),
                inset 0 2px 4px rgba(0, 0, 0, 0.06),
                inset 0 1px 0 rgba(255, 255, 255, 0.8),
                0 4px 16px rgba(0, 122, 255, 0.2);
                
            background: 
                linear-gradient(135deg, rgba(255, 255, 255, 0.95) 0%, rgba(255, 255, 255, 0.85) 100%);
        }
        
        /* Liquid Glass Buttons */
        .btn {
            padding: 14px 20px;
            border: none;
            border-radius: 24px;
            cursor: pointer;
            font-weight: 600;
            font-size: 16px;
            min-width: 80px;
            height: 48px;
            
            display: flex;
            align-items: center;
            justify-content: center;
            
            transition: all 0.3s cubic-bezier(0.25, 0.46, 0.45, 0.94);
            position: relative;
            overflow: hidden;
            
            /* Button Liquid Glass Depth */
            box-shadow: 
                0 4px 16px rgba(0, 0, 0, 0.12),
                inset 0 1px 0 rgba(255, 255, 255, 0.4);
        }
        
        .btn::before {
            content: '';
            position: absolute;
            top: 0;
            left: -100%;
            width: 100%;
            height: 100%;
            background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.3), transparent);
            transition: left 0.5s ease;
        }
        
        .btn:hover::before {
            left: 100%;
        }
        
        .send-button {
            background: linear-gradient(135deg, #007AFF 0%, #5AC8FA 100%);
            color: white;
            border: 1px solid rgba(255, 255, 255, 0.2);
        }
        
        .send-button:hover:not(:disabled) {
            transform: translateY(-2px);
            box-shadow: 
                0 8px 24px rgba(0, 122, 255, 0.4),
                inset 0 1px 0 rgba(255, 255, 255, 0.5);
                
            background: linear-gradient(135deg, #0051D5 0%, #4A9FFF 100%);
        }
        
        .send-button:active:not(:disabled) {
            transform: translateY(0);
        }
        
        .send-button:disabled {
            background: rgba(142, 142, 147, 0.3);
            color: rgba(60, 60, 67, 0.6);
            cursor: not-allowed;
            transform: none;
            box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.3);
        }
        
        .clear-button {
            background: 
                linear-gradient(135deg, rgba(142, 142, 147, 0.2) 0%, rgba(142, 142, 147, 0.1) 100%);
            backdrop-filter: blur(10px);
            color: #1d1d1f;
            border: 1px solid rgba(255, 255, 255, 0.3);
        }
        
        .clear-button:hover {
            background: 
                linear-gradient(135deg, rgba(142, 142, 147, 0.3) 0%, rgba(142, 142, 147, 0.2) 100%);
            transform: translateY(-2px);
            box-shadow: 
                0 8px 24px rgba(0, 0, 0, 0.15),
                inset 0 1px 0 rgba(255, 255, 255, 0.5);
        }
        
        /* Welcome Message with Liquid Glass */
        .welcome-message {
            text-align: center;
            padding: 48px 24px;
            
            background: rgba(255, 255, 255, 0.1);
            backdrop-filter: blur(15px) saturate(150%);
            border: 1px solid rgba(255, 255, 255, 0.2);
            border-radius: 24px;
            margin: 0 8px;
            
            box-shadow: 
                inset 0 1px 0 rgba(255, 255, 255, 0.4),
                0 8px 32px rgba(0, 0, 0, 0.1);
        }
        
        .welcome-message h2 {
            font-size: 1.5rem;
            font-weight: 700;
            color: #1d1d1f;
            margin-bottom: 16px;
        }
        
        .welcome-message p {
            color: rgba(60, 60, 67, 0.8);
            margin-bottom: 12px;
            line-height: 1.5;
            font-size: 0.9rem;
        }
        
        /* Responsive Design */
        @media (max-width: 768px) {
            body { padding: 8px; }
            .chat-container { 
                height: 95vh; 
                border-radius: 24px;
                max-width: 100%;
            }
            .chat-header { padding: 20px; }
            .messages-container { padding: 16px; gap: 12px; }
            .message { 
                max-width: 85%; 
                font-size: 15px;
                padding: 12px 16px;
            }
            .input-section { padding: 16px; }
            .status-indicator { 
                position: static; 
                display: inline-block; 
                margin-top: 12px;
            }
            .welcome-message {
                margin: 0 4px;
                padding: 32px 20px;
            }
        }
        
        /* Mouse tracking for liquid glass effects */
        @media (hover: hover) {
            .chat-container:hover {
                animation-play-state: paused;
            }
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="chat-header">
            <div class="status-indicator">✓ Ready</div>
            <h1>AI Assistant</h1>
            <p>Powered by Cloudflare Workers AI (Llama 3.3 70B)</p>
        </div>
        
        <div class="messages-container" id="messagesContainer">
            <div class="welcome-message" id="welcomeMessage">
                <h2>Welcome to Your AI Assistant</h2>
                <p>Ask me anything - I can help with questions, coding, creative writing, analysis, and more!</p>
                </div>
        </div>
        
        <div class="input-section">
            <div class="input-group">
                <textarea 
                    id="messageInput" 
                    class="message-input" 
                    placeholder="Message"
                    rows="1"
                ></textarea>
            </div>
            <button id="sendButton" class="btn send-button">Send</button>
            <button id="clearButton" class="btn clear-button">Clear</button>
        </div>
    </div>

    <script>
        // Helper function to format text with basic markdown-like rendering
        function formatMessageContent(content) {
            if (typeof content !== 'string') return content;
            
            // Convert numbered lists (1. 2. 3.) - keep simple
            content = content.replace(/^(\\d+\\.)\\s+/gm, '$1 ');
            
            // Convert asterisk lists to bullet points
            content = content.replace(/^\\*\\s+(.+)$/gm, '• $1');
            
            // Remove double asterisks (markdown bold)
            content = content.replace(/\\*\\*([^*]+)\\*\\*/g, '$1');
            
            return content;
        }
        
        // Main chat application class
        class ChatApplication {
            constructor() {
                // Get DOM elements
                this.messagesContainer = document.getElementById('messagesContainer');
                this.messageInput = document.getElementById('messageInput');
                this.sendButton = document.getElementById('sendButton');
                this.clearButton = document.getElementById('clearButton');
                this.welcomeMessage = document.getElementById('welcomeMessage');
                
                // Create loading indicator element (not in HTML initially)
                this.loadingIndicator = null;
                
                // Generate a unique session ID for this browser session
                this.sessionId = 'session-' + Math.random().toString(36).substr(2, 9);
                
                // Debug logging
                console.log('ChatApplication initialized');
                console.log('Elements found:', {
                    messagesContainer: !!this.messagesContainer,
                    messageInput: !!this.messageInput,
                    sendButton: !!this.sendButton,
                    clearButton: !!this.clearButton
                });
                
                this.init();
            }
            
            init() {
                console.log('Initializing chat application...');
                this.createLoadingIndicator();
                this.loadConversationHistory();
                this.setupEventListeners();
                this.setupAutoResize();
                this.setupMouseTracking();
            }
            
            // Create loading indicator element dynamically
            createLoadingIndicator() {
                this.loadingIndicator = document.createElement('div');
                this.loadingIndicator.className = 'message loading-indicator';
                this.loadingIndicator.textContent = 'Thinking...';
                this.loadingIndicator.style.display = 'none';
            }
            
            // Track mouse for liquid glass effects
            setupMouseTracking() {
                if (window.matchMedia('(hover: hover)').matches) {
                    document.addEventListener('mousemove', (e) => {
                        const x = (e.clientX / window.innerWidth) * 100;
                        const y = (e.clientY / window.innerHeight) * 100;
                        document.documentElement.style.setProperty('--mouse-x', x + '%');
                        document.documentElement.style.setProperty('--mouse-y', y + '%');
                    });
                }
            }
            
            setupAutoResize() {
                if (this.messageInput) {
                    this.messageInput.addEventListener('input', () => {
                        this.messageInput.style.height = 'auto';
                        this.messageInput.style.height = Math.min(this.messageInput.scrollHeight, 120) + 'px';
                    });
                }
            }
            
            // Load any existing conversation when page loads
            async loadConversationHistory() {
                try {
                    const response = await fetch(\`/api/history?session=\${this.sessionId}\`);
                    const data = await response.json();
                    
                    if (data.messages && data.messages.length > 0) {
                        // Hide welcome message if we have existing conversation
                        this.welcomeMessage.style.display = 'none';
                        
                        // Display each message
                        data.messages.forEach(msg => {
                            this.displayMessage(msg.content, msg.role);
                        });
                    }
                } catch (error) {
                    console.error('Failed to load conversation history:', error);
                    // Don't show error to user for this - just continue with empty state
                }
            }
            
            setupEventListeners() {
                console.log('Setting up event listeners...');
                
                // Send button click
                if (this.sendButton) {
                    this.sendButton.addEventListener('click', (e) => {
                        console.log('Send button clicked');
                        e.preventDefault();
                        this.sendMessage();
                    });
                }
                
                // Clear button click
                if (this.clearButton) {
                    this.clearButton.addEventListener('click', (e) => {
                        console.log('Clear button clicked');
                        e.preventDefault();
                        this.clearConversation();
                    });
                }
                
                // Enter key in textarea (but allow Shift+Enter for new lines)
                if (this.messageInput) {
                    this.messageInput.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            console.log('Enter key pressed');
                            e.preventDefault();
                            this.sendMessage();
                        }
                    });
                }
                
                console.log('Event listeners set up successfully');
            }
            
            async sendMessage() {
                console.log('sendMessage called');
                
                if (!this.messageInput) {
                    console.error('Message input not found');
                    return;
                }
                
                const message = this.messageInput.value.trim();
                console.log('Message content:', message);
                
                if (!message) {
                    console.log('Empty message, returning');
                    return; // Don't send empty messages
                }
                
                // Hide welcome message if it's still visible
                if (this.welcomeMessage) {
                    this.welcomeMessage.style.display = 'none';
                }
                
                // Show user message immediately
                this.displayMessage(message, 'user');
                this.messageInput.value = ''; // Clear input
                this.messageInput.style.height = 'auto'; // Reset height
                
                // Show loading state AFTER user message
                this.setLoadingState(true);
                this.toggleInputState(false);
                
                try {
                    console.log('Sending request to API...');
                    const response = await fetch(\`/api/chat?session=\${this.sessionId}\`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ message: message })
                    });
                    
                    console.log('API response status:', response.status);
                    const data = await response.json();
                    console.log('API response data:', data);
                    
                    if (data.success) {
                        this.displayMessage(data.response, 'assistant');
                    } else {
                        this.displaySystemMessage('❌ ' + (data.error || 'An error occurred'));
                    }
                    
                } catch (error) {
                    console.error('Error sending message:', error);
                    this.displaySystemMessage('❌ Network error. Please try again.');
                } finally {
                    this.setLoadingState(false);
                    this.toggleInputState(true);
                }
            }
            
            async clearConversation() {
                console.log('clearConversation called');
                
                try {
                    const response = await fetch(\`/api/chat?session=\${this.sessionId}\`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ action: 'clear' })
                    });
                    
                    const data = await response.json();
                    
                    if (data.success) {
                        this.clearAllMessages();
                        this.displaySystemMessage(data.message);
                    } else {
                        this.displaySystemMessage('❌ Failed to clear conversation');
                    }
                    
                } catch (error) {
                    console.error('Error clearing conversation:', error);
                    this.displaySystemMessage('❌ Failed to clear conversation');
                }
            }
            
            // Display a message in the chat with proper formatting
            displayMessage(content, type) {
                console.log('Displaying message:', type, content);
                
                if (!this.messagesContainer) {
                    console.error('Messages container not found');
                    return;
                }
                
                const messageDiv = document.createElement('div');
                messageDiv.className = \`message \${type}-message\`;
                
                // Format assistant messages for better readability
                if (type === 'assistant') {
                    const formattedContent = formatMessageContent(content);
                    messageDiv.textContent = formattedContent;
                } else {
                    messageDiv.textContent = content;
                }
                
                this.messagesContainer.appendChild(messageDiv);
                this.scrollToLatestMessage();
            }
            
            // Display system messages (errors, status updates, etc.)
            displaySystemMessage(content) {
                console.log('Displaying system message:', content);
                
                if (!this.messagesContainer) {
                    console.error('Messages container not found');
                    return;
                }
                
                const messageDiv = document.createElement('div');
                messageDiv.className = 'message system-message';
                messageDiv.textContent = content;
                this.messagesContainer.appendChild(messageDiv);
                this.scrollToLatestMessage();
            }
            
            // Clear all messages from the display
            clearAllMessages() {
                if (!this.messagesContainer) return;
                
                this.messagesContainer.innerHTML = '';
            }
            
            // Show/hide loading indicator - append to end of messages
            setLoadingState(isLoading) {
                if (!this.loadingIndicator || !this.messagesContainer) return;
                
                if (isLoading) {
                    // Remove from current position if present
                    if (this.loadingIndicator.parentNode) {
                        this.loadingIndicator.parentNode.removeChild(this.loadingIndicator);
                    }
                    // Append to end of messages container
                    this.messagesContainer.appendChild(this.loadingIndicator);
                    this.loadingIndicator.style.display = 'block';
                    this.scrollToLatestMessage();
                } else {
                    this.loadingIndicator.style.display = 'none';
                    if (this.loadingIndicator.parentNode) {
                        this.loadingIndicator.parentNode.removeChild(this.loadingIndicator);
                    }
                }
            }
            
            // Enable/disable input controls
            toggleInputState(enabled) {
                if (this.messageInput) {
                    this.messageInput.disabled = !enabled;
                }
                
                if (this.sendButton) {
                    this.sendButton.disabled = !enabled;
                    this.sendButton.textContent = enabled ? 'Send' : 'Sending...';
                }
                
                if (enabled && this.messageInput) {
                    this.messageInput.focus(); // Return focus to input when re-enabled
                }
            }
            
            // Scroll to bottom to show latest messages
            scrollToLatestMessage() {
                if (!this.messagesContainer) return;
                
                setTimeout(() => {
                    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
                }, 100);
            }
        }
        
        // Initialize the app when DOM is ready
        document.addEventListener('DOMContentLoaded', () => {
            console.log('DOM loaded, initializing chat application');
            try {
                new ChatApplication();
                console.log('Chat application initialized successfully');
            } catch (error) {
                console.error('Failed to initialize chat application:', error);
            }
        });
        
        // Also try to initialize immediately in case DOMContentLoaded already fired
        if (document.readyState === 'loading') {
            // Do nothing, wait for DOMContentLoaded
        } else {
            console.log('DOM already loaded, initializing chat application immediately');
            try {
                new ChatApplication();
                console.log('Chat application initialized successfully');
            } catch (error) {
                console.error('Failed to initialize chat application:', error);
            }
        }
    </script>
</body>
</html>`;
}
