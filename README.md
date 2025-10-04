# CF AI Student Assistant

Live Deployed Link: https://cf-ai-student-assistant.paragdharadhar.workers.dev/

A sophisticated AI chat assistant built entirely on Cloudflare's free tier services. This project demonstrates the integration of Cloudflare Workers AI (Llama 3.3 70B), Durable Objects for state management, and WebSocket communication for real-time chat.

## 🚀 Features

- **🤖 Advanced AI**: Powered by Llama 3.3 70B Instruct (latest model)
- **💬 Real-time Chat**: WebSocket-based instant messaging
- **🧠 Persistent Memory**: Conversation history across sessions
- **📱 Mobile Responsive**: Works on all devices
- **⚡ Lightning Fast**: Global edge deployment
- **💰 100% Free**: No API keys or external services required

## 🏗️ Architecture

### Core Components

1. **Main Worker**: HTTP request routing and static content serving
2. **ChatMemory Durable Object**: Persistent conversation state management
3. **Workers AI Integration**: Llama 3.3 70B for natural language processing
4. **WebSocket Communication**: Real-time bidirectional messaging
5. **Responsive Frontend**: Modern HTML/CSS/JavaScript interface

### Data Flow

1. User connects via WebSocket to main Worker
2. Worker routes WebSocket connection to ChatMemory Durable Object
3. User message is processed and added to persistent conversation history
4. AI model (Llama 3.3) generates response based on conversation context
5. Response is sent back to user and stored in conversation history

## 🛠️ Technology Stack

- **Backend**: Cloudflare Workers (Serverless)
- **AI Model**: Cloudflare Workers AI - Llama 3.3 70B Instruct
- **Database**: Cloudflare Durable Objects (Persistent state)
- **Frontend**: Vanilla HTML, CSS, JavaScript
- **Communication**: WebSockets
- **Deployment**: Cloudflare Workers Platform

## 🚀 Local Development

### Prerequisites

- Node.js 18+ installed
- Cloudflare account (free)
- Wrangler CLI installed globally

### Setup Instructions

1. **Clone the repository**
   git clone url
   cd cf_ai_student_assistant

2. **Install dependencies**
   npm install

3. **Login to Cloudflare**
   wrangler login

4. **Start development server**
   wrangler dev

5. **Open your browser**
   Navigate to `http://localhost:8787`

## 🌐 Production Deployment

### Deploy to Cloudflare

Deploy your application
wrangler deploy

Your app will be available at:
https://cf-ai-student-assistant.paragdharadhar.workers.dev/

### Configuration

The application uses `wrangler.jsonc` for configuration:

{
"$schema": "node_modules/wrangler/config-schema.json",
"name": "cf-ai-student-assistant",
"main": "src/index.js",
"compatibility_date": "2025-10-04",

"ai": {
"binding": "AI"
},

"durable_objects": {
"bindings": [
{
"name": "CHAT_MEMORY",
"class_name": "ChatMemory"
}
]
},

"migrations": [
{
"tag": "v1",
"new_sqlite_classes": [
"MyDurableObject"
]
},
{
"tag": "v2",
"renamed_classes": [
{
"from": "MyDurableObject",
"to": "ChatMemory"
}
]
}
],

"observability": {
"enabled": true
}
}

### Key Configuration Elements

- **`ai.binding`**: Provides access to Cloudflare Workers AI (Llama 3.3 70B)
- **`durable_objects.bindings`**: Configures the ChatMemory class for persistent state
- **`migrations`**: Handles the Durable Object class evolution from template to final implementation
- **`observability`**: Enables logging and monitoring for debugging and analytics
- **`compatibility_date`**: Ensures compatibility with latest Workers runtime features

### Migration Strategy

The configuration includes a two-step migration:
1. **v1**: Establishes the initial `MyDurableObject` class from the template
2. **v2**: Renames to `ChatMemory` for the final AI assistant implementation

This approach ensures zero-downtime deployment and maintains any existing conversation data.


## 💡 Usage

1. **Start a Conversation**: Type any message in the chat interface
2. **Ask Questions**: The AI can help with various topics including:

   - General knowledge and explanations
   - Coding and technical questions
   - Creative writing and brainstorming
   - Analysis and problem-solving
   - Academic assistance

3. **Clear History**: Use the "Clear" button to reset conversation
4. **Mobile Access**: The interface is fully responsive and works on mobile devices

## 🔧 Technical Implementation Details

### AI Model Integration

- **Model**: `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- **Context Length**: Maintains last 8 messages for conversation context
- **Parameters**: Temperature: 0.7, Max Tokens: 500
- **Error Handling**: Graceful handling of quota limits and failures

### State Management

- **Storage**: Cloudflare Durable Objects SQL database
- **Persistence**: Conversations survive Worker restarts
- **Scope**: Session-based isolation between users
- **Capacity**: 5GB storage on free tier

## 📊 Free Tier Limits

- **Workers AI**: 10,000 neurons per day (~500-1000 messages)
- **Workers Requests**: 100,000 requests per day
- **Durable Objects**: 5GB storage, 5M reads/day, 100K writes/day
- **Bandwidth**: 10TB per month

### Getting Help

- [Cloudflare Workers Documentation](https://developers.cloudflare.com/workers/)
- [Cloudflare Workers AI Documentation](https://developers.cloudflare.com/workers-ai/)
- [Cloudflare Discord Community](https://discord.cloudflare.com/)

## 🎓 Educational Value

This project demonstrates:

- **Serverless Architecture**: Modern cloud application design
- **Real-time Communication**: WebSocket implementation
- **AI Integration**: Large Language Model usage
- **State Management**: Distributed system data persistence
- **Full-stack Development**: Frontend and backend integration
