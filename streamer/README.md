# ralphTV Streamer (Restream)

Pushes the scheduled playlist to Restream (and onward to YouTube Live).

## Config

Create `.env` with:

- `API_BASE_URL` — backend URL (e.g., https://ralphtv-backend.up.railway.app)
- `API_AUTH_TOKEN` — token for backend (service token or JWT)
- `CHANNEL` — e.g., `default`
- `WEEK` — e.g., `current`
- `RTMP_TARGET` — e.g., `rtmp://live.restream.io/live/re_10688940_d147f36f382cd7a725ea`
- Optional quality knobs:
  - `VIDEO_BITRATE=4500k`
  - `AUDIO_BITRATE=160k`
  - `FPS=30`
  - `GOP=60`
  - `RESOLUTION=1920x1080`
  - `PRESET=veryfast`

## Run

Requires FFmpeg installed and in PATH.

```
cd streamer
npm i
npm start
```

The streamer fetches the playlist and pointer, downloads each item via presigned GET and re-encodes to RTMP.

Notes:
- For Play-through days, the stream stops at the end (or loops a slate if you add one).
- For Looping, it wraps around endlessly.
- Audio-only files may produce only audio; for a video slate during audio, extend the FFmpeg filter chain.

