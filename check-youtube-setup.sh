#!/bin/bash
# YouTube Streaming Diagnostic Script

echo "============================================"
echo "YouTube Streaming Diagnostic Check"
echo "============================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Get relay URL from Railway or frontend config
echo "Step 1: Finding Relay Service URL..."
RELAY_URL=$(railway service relay 2>/dev/null | grep "relay-production.up.railway.app" || echo "")

if [ -z "$RELAY_URL" ]; then
  echo -e "${YELLOW}⚠ Cannot auto-detect relay URL. Please enter it manually:${NC}"
  read -p "Relay URL (e.g., https://relay-production.up.railway.app): " RELAY_URL
fi

echo -e "${GREEN}✓ Using Relay URL: $RELAY_URL${NC}"
echo ""

# Check relay health
echo "Step 2: Checking Relay Service Health..."
HEALTH=$(curl -s -o /dev/null -w "%{http_code}" "$RELAY_URL/healthz")
if [ "$HEALTH" = "200" ]; then
  echo -e "${GREEN}✓ Relay service is online${NC}"
else
  echo -e "${RED}✗ Relay service is not responding (HTTP $HEALTH)${NC}"
  echo "  Fix: Check Railway deployment status for relay service"
  exit 1
fi
echo ""

# Check configured destinations
echo "Step 3: Checking YouTube Destination Configuration..."
DESTINATIONS=$(curl -s "$RELAY_URL/api/destinations")
echo "Response: $DESTINATIONS"

if echo "$DESTINATIONS" | jq -e '.destinations | length > 0' > /dev/null 2>&1; then
  HAS_YOUTUBE=$(echo "$DESTINATIONS" | jq -r '.destinations[]' | grep -i youtube || echo "")
  if [ -n "$HAS_YOUTUBE" ]; then
    echo -e "${GREEN}✓ YouTube destination is configured${NC}"
  else
    echo -e "${YELLOW}⚠ Destinations configured, but none contain 'youtube'${NC}"
    echo "  Found: $(echo "$DESTINATIONS" | jq -r '.destinations[]')"
  fi
else
  echo -e "${RED}✗ No destinations configured${NC}"
  echo ""
  echo "  Fix: Add YouTube RTMP URL to Railway relay service"
  echo "  1. Go to Railway dashboard"
  echo "  2. Select the 'relay' service"
  echo "  3. Go to Variables tab"
  echo "  4. Add: RELAY_PUSH_1=rtmp://a.rtmp.youtube.com/live2/<your-stream-key>"
  echo "  5. Redeploy the relay service"
  exit 1
fi
echo ""

# Check streaming status
echo "Step 4: Checking Streaming Status..."
STATUS=$(curl -s "$RELAY_URL/api/status")
echo "Response: $STATUS"

IS_STREAMING=$(echo "$STATUS" | jq -r '.streaming')
if [ "$IS_STREAMING" = "true" ]; then
  echo -e "${GREEN}✓ Relay is currently receiving a stream${NC}"
else
  echo -e "${YELLOW}⚠ Relay is not currently receiving a stream${NC}"
  echo "  This is normal if the streamer is stopped."
  echo "  If streamer is running, check streamer logs for connection errors."
fi
echo ""

# Check HLS stream availability
echo "Step 5: Checking HLS Stream..."
HLS_URL="$RELAY_URL/hls/stream.m3u8"
HLS_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HLS_URL")
if [ "$HLS_STATUS" = "200" ]; then
  echo -e "${GREEN}✓ HLS stream is available${NC}"
  echo "  URL: $HLS_URL"
else
  echo -e "${YELLOW}⚠ HLS stream not available (HTTP $HLS_STATUS)${NC}"
  echo "  This is normal when no stream is active."
fi
echo ""

echo "============================================"
echo "Summary"
echo "============================================"
echo ""
echo "To fix YouTube streaming issues:"
echo "1. Ensure RELAY_PUSH_1 is set in Railway relay service variables"
echo "2. Format: rtmp://a.rtmp.youtube.com/live2/<your-stream-key>"
echo "3. Redeploy relay service after adding the variable"
echo "4. Start the streamer"
echo "5. Check YouTube Studio for incoming stream"
echo ""
echo "To get your YouTube stream key:"
echo "1. Go to https://studio.youtube.com"
echo "2. Click 'Create' → 'Go live'"
echo "3. Select 'Stream' (not 'Webcam')"
echo "4. Copy the 'Stream key' value"
echo ""
