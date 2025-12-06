#!/bin/bash
# Comprehensive URL Security Test Script

echo "================================================"
echo "Signal Bot URL Security Test"
echo "================================================"
echo ""

TARGET_PHONE="+12247253276"
BOT_PHONE="+19108471202"

echo "📤 Test 1: Suspicious TLD (.cn)"
ssh root@proxmox-main "docker exec -d signal-bot signal-cli -a ${BOT_PHONE} --config /app/signal-data send -m 'Suspicious link: https://example.cn/malware' ${TARGET_PHONE}"
echo "   Sent: https://example.cn/malware"
sleep 3

echo ""
echo "📤 Test 2: Tracking parameters"
ssh root@proxmox-main "docker exec -d signal-bot signal-cli -a ${BOT_PHONE} --config /app/signal-data send -m 'Check out https://google.com?utm_source=test&fbclid=123' ${TARGET_PHONE}"
echo "   Sent: https://google.com?utm_source=test&fbclid=123"
sleep 3

echo ""
echo "📤 Test 3: Clean URL (should NOT trigger alert)"
ssh root@proxmox-main "docker exec -d signal-bot signal-cli -a ${BOT_PHONE} --config /app/signal-data send -m 'Safe link: https://github.com/anthropics/claude' ${TARGET_PHONE}"
echo "   Sent: https://github.com/anthropics/claude"
sleep 3

echo ""
echo "⏳ Waiting 15 seconds for messages to be processed..."
sleep 15

echo ""
echo "📋 Checking logs for URL security alerts..."
echo "================================================"
ssh root@proxmox-main "docker logs --since 30s signal-bot 2>&1" | grep -E "(Message text.*https|Found.*URL alerts|🚨|Security Alert|Privacy Alert|About to check for URLs)" | tail -30

echo ""
echo "================================================"
echo "✅ Test complete!"
echo ""
echo "Expected results:"
echo "  - Test 1: Should trigger 🚨 Security Alert for .cn TLD"
echo "  - Test 2: Should trigger 🔒 Privacy Alert for tracking params"
echo "  - Test 3: Should NOT trigger any alerts"
