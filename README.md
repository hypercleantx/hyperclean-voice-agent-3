# HyperClean Voice Agent v3

HyperClean Voice Agent v3 is a bilingual (English/Spanish) voice AI agent for the HyperClean TX cleaning service.  
The service leverages the **OpenAI Realtime API** together with **Twilio Media Streams** to provide natural, real‑time conversational experiences over the phone.  
This repository contains all of the code and configuration required to deploy the agent on [Render](https://render.com/).

## Features

- **Realtime streaming:** Uses WebSockets to connect callers via Twilio to OpenAI’s realtime model.
- **Bilingual support:** Automatically detects and responds in English or Spanish based on caller input.
- **Endpoint routing:** Provides three WebSocket endpoints (`/stream`, `/stream-sales`, and `/stream-service`) for general inquiries, sales calls and service/support calls, respectively.
- **Audio conversion:** Transparently converts audio between μ‑law (u‑law) and 16‑bit PCM using the `alawmulaw` library.
- **Persona‑driven prompts:** Each endpoint uses a tailored system prompt to steer the conversation toward the appropriate goal (general information, sales conversion or customer support).
- **Health check:** A lightweight HTTP endpoint (`/health`) returns `{"ok": true, "version": "3.0.0"}` to indicate service status.
- **Graceful shutdown:** Handles `SIGTERM` and `SIGINT` signals to close open connections before exiting.

## Prerequisites

- **Node.js 18 or newer** – Render will automatically use an appropriate version defined in `package.json` via the `engines` field.  
- A valid **OpenAI API key** with access to the realtime model (`gpt‑4o‑realtime‑preview`).  
- A **Twilio** account configured for Media Streams (not included in this repository).  
- A Render account with access to create web services.

## Configuration

All configuration is done through environment variables.  Copy the example `.env` file to configure the service locally or set the variables directly in Render’s dashboard.

### Environment variables

| Variable                 | Description                                                       | Required | Example value                                  |
|-------------------------|-------------------------------------------------------------------|---------:|------------------------------------------------|
| `OPENAI_API_KEY`        | OpenAI secret key for realtime streaming                          |    **Yes** | `sk-proj-…`                                    |
| `OPENAI_MODEL_REALTIME` | OpenAI realtime model to use (default: `gpt-4o-realtime-preview`) |      No | `gpt-4o-realtime-preview`                      |
| `STREAM_SHARED_SECRET`  | Shared token for authenticating WebSocket connections             |    **Yes** | (any long, random string)                      |
| `BOOKING_LINK_URL`      | URL for directing callers to book cleaning services               |      No | `https://www.hypercleantx.com/#services`       |
| `NODE_ENV`              | Set to `production` in Render                                    |      No | `production`                                  |
| `LOG_LEVEL`             | Logging level (e.g. `info`)                                       |      No | `info`                                        |

### `.env.example`

This repository includes a `.env.example` file listing all environment variables.  Copy it to `.env` and fill in your own values when running locally:

```bash
cp server/.env.example server/.env
# then edit server/.env with your own keys
```

> **Important:** Never commit real API keys or secrets to version control.

## Running locally

1. Install dependencies:
   ```bash
   npm ci
   ```
2. Copy the example environment file and set your variables:
   ```bash
   cp server/.env.example server/.env
   # edit server/.env
   ```
3. Start the server:
   ```bash
   npm start
   ```
4. Connect via WebSocket to one of the endpoints, passing the shared secret as a query parameter.  For example:
   ```
   wss://your-host/stream?token=<STREAM_SHARED_SECRET>
   ```

## Deployment on Render

This repository contains a `render.yaml` file that defines the Render web service.  After pushing the code to GitHub:

1. **Create a new Render web service** using the `hyperclean-voice-agent-3` repository.  Render will auto‑detect the `render.yaml` file and prefill the build and start commands.
2. **Add environment variables** in the Render dashboard: 
   - `OPENAI_API_KEY` – mark this as **secret**.  
   - `STREAM_SHARED_SECRET` – either generate one in Render or set your own.  
   - Other variables are prefilled by the `render.yaml` file but can be edited if needed.
3. **Deploy** the service.  Render will install dependencies with `npm ci --production` and start the app with `npm start`.
4. Once deployed, verify that `https://your-service.onrender.com/health` returns `{"ok":true,"version":"3.0.0"}`.

## Security

All WebSocket connections must include a `token` query parameter matching the `STREAM_SHARED_SECRET` environment variable.  Requests without a valid token will be rejected with a `401 Unauthorized` response during the WebSocket upgrade handshake.

## License

This project is proprietary to HyperClean TX and is not licensed for public distribution.
