# Logo Assets

Place your channel logo here as `logo.png` for it to be overlaid on the video stream.

## Requirements

- Format: PNG with transparency
- Recommended size: 200-400px width
- Position: Top right corner with 20px padding
- The logo will be automatically scaled if needed

## Environment Variables

- `LOGO_ENABLE=true` - Enable logo overlay (default: false)
- `LOGO_PATH=/app/assets/logo.png` - Path to logo file (default)
- `LOGO_SCALE=200` - Logo width in pixels (default: 200)
- `LOGO_OPACITY=0.8` - Logo opacity 0.0-1.0 (default: 0.8)

## Example

```bash
docker build -t streamer .
docker run -e LOGO_ENABLE=true streamer
```

If no logo.png is found, the overlay will be skipped automatically.
