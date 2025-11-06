import 'dotenv/config';
import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket as WSClient } from 'ws';
import OpenAI from 'openai';
import { mulaw } from 'alawmulaw';

// Create Express app and underlying HTTP server
const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Service version
const VERSION = '3.0.0';

// Verify required environment variables up front
const SHARED = process.env.STREAM_SHARED_SECRET;
if (!SHARED) {
  console.error('❌ STREAM_SHARED_SECRET environment variable is required');
  process.exit(1);
}

// Initialize OpenAI client; fail fast if the key is missing
let openai;
try {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY environment variable is required');
  }
  openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
} catch (error) {
  console.error('❌ Failed to initialize OpenAI:', error.message);
  process.exit(1);
}

// Retrieve configuration values with sensible defaults
const MODEL = process.env.OPENAI_MODEL_REALTIME || 'gpt-4o-realtime-preview';
const BOOKING_URL = process.env.BOOKING_LINK_URL || 'https://www.hypercleantx.com/#services';

// Parse JSON bodies for potential future endpoints
app.use(express.json());

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ ok: true, version: VERSION });
});

// Root endpoint returns basic service information
app.get('/', (req, res) => {
  res.json({
    service: 'HyperClean Voice Agent',
    version: VERSION,
    status: 'operational',
    endpoints: {
      health: '/health',
      stream: '/stream',
      streamSales: '/stream-sales',
      streamService: '/stream-service'
    },
    documentation: 'See README.md for usage instructions'
  });
});

/**
 * systemPrompt generates the instruction block for a given endpoint.
 * Each persona is tuned to a specific part of the customer journey.
 *
 * @param {string} path The WebSocket endpoint path
 * @returns {string} The system prompt instructions for the AI
 */
function systemPrompt(path) {
  switch (path) {
    case '/stream-sales':
      return `You are an energetic, persuasive bilingual sales representative for HyperClean TX. You automatically detect and respond in the caller's language (English or Spanish).\n\nYour Mission:\n- Convert inquiries into bookings\n- Highlight value propositions and competitive advantages\n- Create urgency with same-day availability\n- Overcome objections with confidence\n- Close the sale by directing to ${BOOKING_URL}\n\nValue Props to Emphasize:\n- Professional, background-checked cleaners\n- Flexible scheduling with same-day options\n- Quality guarantee: "We'll Make It Right"\n- Bilingual support\n- Serving Houston and Dallas metros\n\nSales Techniques:\n- Build rapport quickly\n- Ask qualifying questions to understand pain points\n- Position HyperClean as the solution\n- Handle price objections by emphasizing quality and reliability\n- Use assumptive close: "When would you like us to come?"\n\nAlways guide towards booking at ${BOOKING_URL}. Be enthusiastic but not pushy.`;
    case '/stream-service':
      return `You are a calm, empathetic bilingual customer service specialist for HyperClean TX. You automatically detect and respond in the caller's language (English or Spanish).\n\nYour Focus:\n- Resolve service issues with care\n- Address complaints professionally\n- Coordinate rescheduling and special requests\n- Ensure customer satisfaction\n- Maintain HyperClean's reputation\n\nIssue Resolution:\n- Listen actively to understand the full situation\n- Apologize sincerely when appropriate\n- Offer solutions immediately\n- Follow up with specific action items\n- Escalate complex issues when needed\n\nQuality Guarantee:\n- "We'll Make It Right" – emphasize commitment\n- Same-day resolution when possible\n- No-cost re-cleans if standards not met\n- Full satisfaction or money back\n\nCommunication Style:\n- Patient, understanding, and solution-focused\n- Avoid being defensive\n- Take ownership of issues\n- Provide clear timelines for resolution\n- End calls with confirmation of next steps\n\nFor booking changes or new service requests, direct callers to ${BOOKING_URL}.`;
    default:
      return `You are a friendly, professional bilingual customer service representative for HyperClean TX, a residential and Airbnb cleaning service in Houston and Dallas. You automatically detect and respond in the caller's language (English or Spanish).\n\nKey Information:\n- Services: Standard cleaning, deep cleaning, move-in/move-out, Airbnb turnovers\n- Coverage: Houston and Dallas metro areas\n- Booking: Direct callers to ${BOOKING_URL}\n- Response time: Same-day or next-day service available\n- Quality guarantee: "We'll Make It Right" policy\n\nYour Role:\n- Answer questions about services, pricing, and availability\n- Qualify leads and gather property details (size, cleaning type, frequency)\n- Provide clear next steps for booking\n- Handle objections professionally\n- Switch seamlessly between English and Spanish\n\nCommunication Style:\n- Warm, professional, and solution-oriented\n- Ask clarifying questions to understand needs\n- Be concise but thorough\n- Always end with a clear call-to-action\n\nIf a caller asks to book, provide the booking link and offer to help with any questions about the process.`;
  }
}

// Persona configuration for each endpoint
const PERSONAS = {
  '/stream': { voice: 'alloy' },
  '/stream-sales': { voice: 'alloy' },
  '/stream-service': { voice: 'verse' }
};

// Upgrade HTTP requests to WebSocket connections with token validation
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const token = url.searchParams.get('token');
  const path = url.pathname;

  // Deny requests without a valid token
  if (token !== SHARED) {
    socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
    socket.destroy();
    return;
  }

  // Only allow known endpoints
  if (!['/stream', '/stream-sales', '/stream-service'].includes(path)) {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

// WebSocket connection handler
wss.on('connection', async (twilioWS, req) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;
  const persona = PERSONAS[path] || PERSONAS['/stream'];

  console.log(`📞 New connection on ${path} (${persona.voice} voice)`);

  let streamSid = null;
  let upstream = null;

  try {
    // Connect to OpenAI realtime WebSocket
    const upstreamURL = `wss://api.openai.com/v1/realtime?model=${MODEL}`;
    upstream = new WSClient(upstreamURL, {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    // Wait for the connection to open
    await new Promise((resolve, reject) => {
      upstream.once('open', resolve);
      upstream.once('error', reject);
    });

    console.log('✅ OpenAI Realtime connection established');

    // Update session settings for the conversation
    upstream.send(JSON.stringify({
      type: 'session.update',
      session: {
        turn_detection: { type: 'server_vad' },
        input_audio_format: 'pcm16',
        output_audio_format: 'pcm16',
        voice: persona.voice,
        instructions: systemPrompt(path),
        modalities: ['text', 'audio'],
        temperature: 0.8
      }
    }));

    // Handle messages from OpenAI and forward audio back to Twilio
    upstream.on('message', data => {
      try {
        const event = JSON.parse(data.toString());
        
        if (event.type === 'response.audio.delta' && event.delta && twilioWS.readyState === 1) {
          // Convert PCM16 (Int16Array) to μ‑law 8‑bit
          const pcmBuffer = Buffer.from(event.delta, 'base64');
          const pcmArray = new Int16Array(pcmBuffer.buffer, pcmBuffer.byteOffset, pcmBuffer.length / 2);
          const mulawArray = mulaw.encode(pcmArray);
          const mulawBase64 = Buffer.from(mulawArray).toString('base64');

          twilioWS.send(JSON.stringify({
            event: 'media',
            streamSid,
            media: { payload: mulawBase64 }
          }));
        }

        if (event.type === 'response.done') {
          // Signal end of a turn
          twilioWS.send(JSON.stringify({
            event: 'mark',
            streamSid,
            mark: { name: `response_${Date.now()}` }
          }));
        }
      } catch (error) {
        console.error('❌ Error processing OpenAI message:', error);
      }
    });

    upstream.on('error', (error) => {
      console.error('❌ OpenAI WebSocket error:', error);
      closeBoth();
    });
    upstream.on('close', () => {
      console.log('🔌 OpenAI connection closed');
      closeBoth();
    });
  } catch (error) {
    console.error('❌ Failed to establish OpenAI connection:', error);
    twilioWS.close();
    return;
  }

  // Handle incoming messages from Twilio
  twilioWS.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      switch (msg.event) {
        case 'start':
          streamSid = msg.start?.streamSid;
          console.log('📞 Stream started:', streamSid);
          break;
        case 'media':
          if (msg.media?.payload && upstream?.readyState === 1) {
            // Decode μ‑law audio from Twilio to PCM16 for OpenAI
            const mulawBuffer = Buffer.from(msg.media.payload, 'base64');
            const mulawArray = new Uint8Array(mulawBuffer);
            const pcmArray = mulaw.decode(mulawArray);
            const pcmBuffer = Buffer.from(pcmArray.buffer);

            upstream.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: pcmBuffer.toString('base64')
            }));
          }
          break;
        case 'stop':
          console.log('🛑 Stream stopped');
          if (upstream?.readyState === 1) {
            // Commit any remaining audio
            upstream.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
          }
          closeBoth();
          break;
      }
    } catch (error) {
      console.error('❌ Error processing Twilio message:', error);
    }
  });

  // Close helper function to avoid duplicate closures
  const closeBoth = () => {
    try { twilioWS.close(); } catch {}
    try { upstream?.close(); } catch {}
  };

  twilioWS.on('close', () => {
    console.log('🔌 Twilio connection closed');
    closeBoth();
  });
  twilioWS.on('error', (error) => {
    console.error('❌ Twilio WebSocket error:', error);
    closeBoth();
  });
});

// Start the HTTP server.  Render will inject its own PORT environment variable.
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`✅ HyperClean Voice Agent v${VERSION} listening on port ${PORT}`);
  console.log(`📡 WebSocket endpoints: /stream, /stream-sales, /stream-service`);
  console.log(`🤖 Using OpenAI model: ${MODEL}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
});

// Graceful shutdown handlers
const shutdown = (signal) => {
  console.log(`⚠️  ${signal} received, closing server...`);
  server.close(() => {
    console.log('✅ Server closed gracefully');
    process.exit(0);
  });
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
