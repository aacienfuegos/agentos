#!/usr/bin/env bash
# Arranca el entorno de desarrollo completo:
#   Docker: Redis + Backend (hot reload) + Worker
#   Nativo: Frontend Next.js (hot reload real, sin rebuilds)

set -e

# Cargar .env si existe
[ -f .env ] && export $(grep -v '^#' .env | xargs)

echo "🚀 Arrancando servicios Docker (Redis + Backend + Worker)..."
docker compose -f docker-compose.dev.yml up -d --build

echo "⏳ Esperando al backend..."
until curl -sf http://localhost:8000/api/health > /dev/null 2>&1; do
  sleep 1
done
echo "✅ Backend listo"

echo ""
echo "🖥  Arrancando frontend en modo nativo..."
echo "   → http://localhost:3000"
echo "   → API: http://localhost:8000/docs"
echo ""
echo "Ctrl+C para parar el frontend (los servicios Docker siguen corriendo)"
echo "Para pararlos: docker compose -f docker-compose.dev.yml down"
echo ""

cd frontend && npm run dev
