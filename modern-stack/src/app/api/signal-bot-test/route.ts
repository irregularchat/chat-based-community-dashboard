import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const text = await request.text();
    console.log('Received raw text:', text);
    
    let body;
    try {
      body = JSON.parse(text);
    } catch (e) {
      console.log('JSON parse error:', e);
      return NextResponse.json({ 
        success: false, 
        error: 'Invalid JSON' 
      }, { status: 400 });
    }
    
    const { message } = body;
    console.log('Parsed message:', message);
    
    if (!message) {
      return NextResponse.json({ 
        success: false, 
        error: 'Message is required',
        receivedBody: body
      }, { status: 400 });
    }

    // Simulate signal bot message processing
    let response = '';
    const messageText = message.toLowerCase().trim();

    if (messageText.startsWith('!help') || messageText.startsWith('!phelp')) {
      response = `🤖 **Community Bot Help**

Available commands:
• !help or !phelp - Show this help message
• !ai <question> - Ask me anything using AI
• !commands - List all available commands
• !status - Check bot status
• !ping - Test if bot is responding

**AI Commands:**
• !ai hello - Get a greeting
• !ai how do I join a room? - Ask questions
• !ai what can you help me with? - Learn about capabilities

**Community Commands:**  
• !rooms - List available Matrix rooms
• !join <room> - Request to join a room
• !leave <room> - Leave a room
• !whoami - Show your user info

Type !ai <question> to ask me anything!

If you need more help, please contact an administrator.`;

    } else if (messageText.startsWith('!ai ')) {
      const question = message.replace(/^!ai\s+/i, '').trim();
      if (!question) {
        response = "Please provide a question after !ai. Example: !ai How do I join a room?";
      } else {
        // Check if OpenAI is configured
        const openAiApiKey = process.env.OPENAI_API_KEY;
        if (!openAiApiKey) {
          response = "AI is enabled but OpenAI API key is not configured. Please contact an administrator.";
        } else {
          try {
            const { OpenAI } = await import('openai');
            const openai = new OpenAI({ apiKey: openAiApiKey });

            const completion = await openai.chat.completions.create({
              model: 'gpt-3.5-turbo', // Using a working model
              messages: [
                {
                  role: 'system',
                  content: 'You are a helpful community bot assistant. Be friendly, concise, and helpful. Keep responses under 200 words.'
                },
                {
                  role: 'user',
                  content: question
                }
              ],
              max_tokens: 300,
              temperature: 0.7,
            });

            response = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
          } catch (error) {
            console.error('OpenAI API error:', error);
            response = 'Sorry, I encountered an error while processing your question. Please try again later.';
          }
        }
      }

    } else if (messageText.startsWith('!commands')) {
      response = `📋 **Available Commands:**

**Basic:**
• !help, !phelp - Show help message
• !ping - Test bot response
• !status - Bot status

**AI:**
• !ai <question> - Ask AI anything

**Community:**
• !rooms - List rooms
• !join <room> - Join room request
• !leave <room> - Leave room
• !whoami - User info

Type any command to try it!`;

    } else if (messageText.startsWith('!ping')) {
      response = '🏓 Pong! Signal bot is working correctly.';

    } else if (messageText.startsWith('!status')) {
      response = '✅ Signal bot is running and responding to commands.';

    } else if (messageText.startsWith('!whoami')) {
      response = '👤 You are testing the Signal bot commands via the API test endpoint.';

    } else if (messageText.startsWith('!rooms')) {
      response = '🏠 **Available Rooms:** (This would show Matrix rooms if configured)';

    } else if (messageText.startsWith('!join')) {
      const roomName = message.replace(/^!join\s+/i, '').trim();
      response = roomName ? 
        `📩 Join request submitted for room: ${roomName}` : 
        'Please specify a room name. Example: !join general';

    } else if (messageText.startsWith('!leave')) {
      const roomName = message.replace(/^!leave\s+/i, '').trim();
      response = roomName ? 
        `👋 Left room: ${roomName}` : 
        'Please specify a room name. Example: !leave general';

    } else if (messageText.startsWith('!')) {
      response = `❓ Unknown command: "${messageText}"

Type !help to see available commands.`;
    } else {
      response = '👋 Hello! I\'m the community bot. Type !help to see what I can do!';
    }

    return NextResponse.json({
      success: true,
      originalMessage: message,
      botResponse: response,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Signal bot test error:', error);
    return NextResponse.json({ 
      success: false, 
      error: 'Internal server error' 
    }, { status: 500 });
  }
}