#!/bin/bash
# Quick setup script for Oracle Ampere deployment
# Usage: curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/ai-tutor-hackaton/main/setup.sh | sudo bash

set -e

echo "🚀 AI Tutor - One-Command Setup"
echo "================================"

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "📦 Installing Docker..."
    apt-get update
    apt-get install -y docker.io docker-compose
    systemctl enable docker
    systemctl start docker
fi

# Create project directory
mkdir -p /opt/ai-tutor
cd /opt/ai-tutor

# Create .env template
cat > .env <<'EOF'
# Google Cloud SQL
DATABASE_URL=postgresql://postgres:YOUR_PASSWORD@YOUR_CLOUD_SQL_IP:5432/ai-tutor-db

# LiveKit
LIVEKIT_URL=wss://your-project.livekit.cloud
LIVEKIT_API_KEY=your_livekit_key
LIVEKIT_API_SECRET=your_livekit_secret

# Gemini
GEMINI_API_KEY=your_gemini_api_key
EOF

echo ""
echo "✅ Setup complete!"
echo ""
echo "📝 Next steps:"
echo "1. Edit /opt/ai-tutor/.env with your credentials"
echo "2. Run: cd /opt/ai-tutor && sudo docker-compose -f docker-compose.prod.yml up -d"
echo ""
echo "Need the full deployment script? Run:"
echo "curl -O https://raw.githubusercontent.com/YOUR_USERNAME/ai-tutor-hackaton/main/deploy-oracle.sh"
