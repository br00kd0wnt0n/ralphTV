# Restream Streamer Setup Checklist

## Step 1: Get Your Restream RTMP URL
1. Go to https://restream.io
2. Navigate to Settings → Streaming
3. Copy your **RTMP URL** (format: `rtmp://live.restream.io/live/re_XXXXXXXX_XXXXXXXXXXXX`)

## Step 2: Configure Railway Streamer Service
In Railway dashboard, go to your **Streamer** service → Variables:

```
RTMP_TARGET=rtmp://live.restream.io/live/re_XXXXXXXX_XXXXXXXXXXXX
API_BASE_URL=https://backend-production-3f879.up.railway.app
API_AUTH_TOKEN=<your-jwt-secret>
CHANNEL=default
WEEK=current
```

## Step 3: Configure Railway Frontend Service
In Railway dashboard, go to your **Frontend** service → Variables:

```
VITE_STREAMER_BASE_URL=https://streamer-production-XXXX.up.railway.app
```

**⚠️ IMPORTANT:** Replace `XXXX` with your actual streamer service domain from Railway.

To find your streamer URL:
1. Go to Railway → Streamer service → Settings
2. Look for "Domains" section
3. Copy the `.up.railway.app` URL

## Step 4: Redeploy Services
1. After setting variables, redeploy **both** Frontend and Streamer services
2. Wait for deployments to complete

## Step 5: Test the Connection

### In your browser console (F12):
Check if the variable is set:
```javascript
console.log(import.meta.env.VITE_STREAMER_BASE_URL)
```

Should output your streamer URL, NOT undefined or empty string.

### Test the streamer endpoint:
Visit in browser: `https://your-streamer-url.up.railway.app/status`

Should return JSON like:
```json
{"running": false, "current": null}
```

## Step 6: Start Streaming
1. Upload some content in the UI
2. Schedule it for today
3. Click "Start" in Streamer controls
4. Check Restream dashboard - stream should appear as "Live" within 10-30 seconds

## Troubleshooting

### If clicking "Start" shows 404 error:
- Frontend can't reach streamer
- Check `VITE_STREAMER_BASE_URL` is set correctly in Frontend service
- Redeploy frontend after setting variable

### If stream doesn't appear on Restream:
- Check streamer logs in Railway: `railway logs -s streamer`
- Look for errors like "Missing RTMP_TARGET" or FFmpeg errors
- Verify `RTMP_TARGET` is exactly as copied from Restream (no extra spaces)

### If "Streamer Stopped" never changes to "Running":
- Check API_BASE_URL is set correctly
- Verify there's content scheduled for today
- Check Railway logs for errors

### If stream is black/silent:
- Check content is uploaded and has valid media files
- Verify S3_BUCKET_UPLOADS is set correctly in backend
- Check S3 CORS policy allows streamer to download files
