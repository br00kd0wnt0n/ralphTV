# Troubleshooting Guide

## YouTube Not Connecting

If YouTube is not receiving the stream while the standalone HLS player works:

### Check Stream Key

1. Verify your YouTube stream key is correct in Railway environment variables
2. Go to YouTube Studio → Go Live → Stream Settings
3. Copy the **Stream Key** (not the URL)
4. In Railway relay service, set: `RELAY_PUSH_1=rtmp://a.rtmp.youtube.com/live2/{YOUR_STREAM_KEY}`

### Check YouTube Live Dashboard

1. Go to YouTube Studio → Go Live
2. Check the stream status indicator
3. Common errors:
   - **"Waiting for stream"** - Stream key might be wrong or RTMP not connecting
   - **"Stream health: Poor"** - Bitrate or resolution issues
   - **"Stream offline"** - RTMP push is not active

### Verify RTMP Push Configuration

Check the relay service logs:
```bash
railway logs --service relay
```

Look for:
- `push rtmp://a.rtmp.youtube.com/live2/...` in nginx config
- Any RTMP connection errors
- Whether the push target is being used

### Test RTMP Push Manually

You can test if the RTMP push URL is correct:
```bash
ffmpeg -re -i test.mp4 \
  -c:v libx264 -c:a aac \
  -f flv rtmp://a.rtmp.youtube.com/live2/{YOUR_STREAM_KEY}
```

### Common Issues

1. **RTMP Handshake Failure - "digest not found"**
   - **Error Pattern in Relay Logs**:
     ```
     relay: create push url='a.rtmp.youtube.com/live2/xxxx-xxxx-xxxx'
     handshake: digest not found
     deleteStream
     disconnect
     ```
   - **What it means**: YouTube is rejecting the RTMP authentication handshake
   - **Causes**:
     - Invalid or expired stream key
     - Stream key copied incorrectly (extra spaces, missing characters)
     - YouTube Live stream not in "Ready to stream" state
     - Stream key regenerated in YouTube Studio but not updated in Railway
   - **Fix**:
     1. Go to YouTube Studio → Go Live → Stream Settings
     2. Verify the Stream Key matches exactly what's in `RELAY_PUSH_1`
     3. If unsure, regenerate the stream key and update Railway variable
     4. Ensure YouTube Live stream status is "Ready to stream" not "Offline"
     5. Restart relay service after updating stream key

2. **Invalid Stream Key**
   - Error: Immediate disconnect or "Stream offline"
   - Fix: Double-check stream key in YouTube Studio

3. **YouTube Server Issues**
   - Error: Connection timeout or refused
   - Fix: Try different YouTube ingest server (a, b, c, or d):
     - `rtmp://a.rtmp.youtube.com/live2/...`
     - `rtmp://b.rtmp.youtube.com/live2/...`

4. **Bitrate Too High**
   - Error: "Poor stream health" or frequent buffering
   - Fix: Reduce VIDEO_BITRATE in streamer service (try 2500k or 2000k)

5. **Resolution Not Supported**
   - Error: Stream rejected or poor health
   - Fix: Ensure RESOLUTION is 1920x1080 or 1280x720

### Railway Environment Variables

Check these are set correctly:

**Relay Service:**
```
RELAY_PUSH_1=rtmp://a.rtmp.youtube.com/live2/{YOUR_STREAM_KEY}
RELAY_HTTP_PORT=8080
RELAY_RTMP_PORT=1935
```

**Streamer Service:**
```
RTMP_TARGET=rtmp://relay-production-xxxx.up.railway.app:1935/live/stream
VIDEO_BITRATE=3000k
AUDIO_BITRATE=128k
RESOLUTION=1920x1080
FPS=30
```

## HLS Player Issues

### Buffering on Startup

- **Normal**: 1-5 seconds of initial buffering
- **Abnormal**: 20-30 seconds of buffering

If excessive buffering occurs:
1. Check HLS segment generation (should be 1s fragments)
2. Verify relay service is healthy
3. Check network latency between services

### Player Stuck on First Frame

Fixed in latest version with HLS availability check. If still occurring:
1. Check browser console for errors
2. Verify stream.m3u8 is accessible: `curl https://relay-xxx.up.railway.app/hls/stream.m3u8`
3. Check relay monitor-stream.sh is updating status.json

### 404 Errors on stream.m3u8

Fixed in latest version (Nov 2025). Player now uses GET request with content verification.

**Symptom**: Console shows "HLS manifest available after 0ms" followed by repeated 404 errors

**Cause**: HEAD request returned 200 OK even when manifest didn't exist yet, causing premature player initialization

**Pattern**:
- YouTube streaming works ✓
- Standalone HLS works ✓
- Dashboard livestream fails ✗

**Fix Applied**: Changed availability check from HEAD to GET request with `#EXTM3U` content verification

If still occurring after latest update:
1. Clear browser cache and hard refresh (Cmd+Shift+R / Ctrl+Shift+F5)
2. Check browser console for error details
3. Verify relay service is running: `curl https://relay-xxx.up.railway.app/healthz`
4. Check /tmp/hls directory has write permissions
5. Verify nginx RTMP module is loaded

## Relay Service Issues

### Check Relay Health

```bash
curl https://relay-production-xxxx.up.railway.app/healthz
# Should return: ok

curl https://relay-production-xxxx.up.railway.app/api/status
# Should return: {"streaming":true,"lastUpdated":"..."}
```

### Check HLS Segments

```bash
curl https://relay-production-xxxx.up.railway.app/hls/stream.m3u8
# Should return the HLS playlist
```

### Relay Not Receiving RTMP

Check streamer is pointing to correct relay URL:
```
RTMP_TARGET=rtmp://{RELAY_RAILWAY_URL}:1935/live/stream
```

## Streamer Service Issues

### Streamer Not Starting

Check logs:
```bash
railway logs --service streamer
```

Common issues:
- Missing API_BASE_URL
- Missing RTMP_TARGET
- Invalid AWS credentials for S3

### Stream Stops After Each Video

Check:
- Videos are normalized (have audio tracks)
- STREAMER_FORCE_ENCODE is set if videos are mixed format
- RTMP connection is stable

### Audio Missing on YouTube

1. Verify source videos have audio tracks
2. Check transcoder added silent audio for videos without audio
3. Enable STREAMER_FORCE_ENCODE mode
4. Check ffmpeg logs for audio stream mapping

## Backend API Issues

### 401 Unauthorized Errors

Fixed in latest version with auto-logout on token expiration.

If still occurring:
1. Clear browser localStorage
2. Log in again
3. Check JWT_SECRET is set in backend
4. Verify token hasn't expired (2 hour lifetime)

### Schedule Empty on Return

Fixed in latest version with automatic token refresh.

## General Debugging

### Enable Verbose Logging

Set in Railway:
```
LOG_LEVEL=debug
```

### Check Service Health

All services have health endpoints:
- Backend: `https://backend-xxx.up.railway.app/health`
- Relay: `https://relay-xxx.up.railway.app/healthz`
- Streamer: `https://streamer-xxx.up.railway.app/health`

### Railway Service URLs

Find your service URLs:
```bash
railway status
```

Or in Railway dashboard → Service → Settings → Domains
