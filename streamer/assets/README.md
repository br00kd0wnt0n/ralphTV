# Logo Assets

Place your channel logo here for it to be overlaid on the video stream in the top-right corner.

## Supported Formats

### Static Logo (PNG)
- Format: PNG with transparency
- File: `logo.png`
- Use case: Static branding, watermarks

### Animated Logo (MP4)
- Format: MP4 or MOV video
- File: `logo.mp4` or `logo.mov`
- Use case: Animated branding, motion graphics
- **Automatic looping**: Video loops infinitely during stream
- Transparency: Use videos with alpha channel for best results

## Requirements

- Recommended size: 200-400px width
- Position: Top right corner with 20px padding
- The logo will be automatically scaled to the specified width
- For MP4: Keep duration short (2-5 seconds) for smooth looping

## Environment Variables

- `LOGO_ENABLE=true` - Enable logo overlay (default: false)
- `LOGO_PATH=/app/assets/logo.png` - Path to logo file (default: logo.png)
  - Can be: `/app/assets/logo.png`, `/app/assets/logo.mp4`, etc.
- `LOGO_SCALE=200` - Logo width in pixels (default: 200)
- `LOGO_OPACITY=0.8` - Logo opacity 0.0-1.0 (default: 0.8)

## Examples

### Static PNG Logo
```bash
# Place logo.png in assets/
docker build -t streamer .
docker run -e LOGO_ENABLE=true streamer
```

### Animated MP4 Logo
```bash
# Place logo.mp4 in assets/
docker build -t streamer .
docker run -e LOGO_ENABLE=true \
  -e LOGO_PATH=/app/assets/logo.mp4 \
  streamer
```

### Custom Settings
```bash
docker run -e LOGO_ENABLE=true \
  -e LOGO_PATH=/app/assets/logo.mp4 \
  -e LOGO_SCALE=300 \
  -e LOGO_OPACITY=0.9 \
  streamer
```

## How It Works

- **PNG logos**: Static overlay on every frame
- **MP4 logos**: Video loops using ffmpeg's loop filter with infinite repetition
- Auto-detection: File extension determines if static (PNG) or animated (MP4/MOV)
- Graceful fallback: If logo file not found, streaming continues without overlay

## Tips for Animated Logos

1. **Keep it short**: 2-5 second loops work best
2. **Seamless loop**: Ensure first and last frames match for smooth looping
3. **Optimize file size**: Small logos reduce processing overhead
4. **Test locally**: Preview your logo before deploying to production
