# Quick Fix: Force Encode Mode for YouTube Audio

## The Problem
When using COPY MODE with videos that lack audio, YouTube receives a video-only stream.

## Quick Fix (Temporary)
Set this environment variable in Railway streamer service:

```
STREAMER_NORMALIZE=false
```

This forces ENCODE MODE which will:
- Re-encode all videos with consistent audio
- Add audio encoding even if source lacks audio (though it will be silent)
- Ensure YouTube always receives both video + audio streams

## Permanent Fix
Re-transcode the 3 videos without audio using the updated transcoder (already deployed).

### Steps:
1. Delete the 3 videos from your library that have no audio
2. Re-upload them
3. The new transcoder will add silent audio tracks automatically
4. Switch back to COPY MODE by removing STREAMER_NORMALIZE variable

## Trade-offs

**Encode Mode (temporary):**
- ✓ Works immediately
- ✓ Ensures audio exists
- ✗ Higher CPU usage
- ✗ Slight quality loss from re-encoding

**Re-transcode (permanent):**
- ✓ Best performance (copy mode)
- ✓ No quality loss
- ✓ Proper audio in all files
- ✗ Requires re-uploading videos
