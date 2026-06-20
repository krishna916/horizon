#!/bin/bash

# Clean up background processes on exit
cleanup() {
    echo "Stopping all services..."
    kill $(jobs -p) 2>/dev/null
    exit
}
trap cleanup SIGINT SIGTERM

echo "=== Starting Horizon Local Environment ==="

# 1. Start postgres database
echo "Starting PostgreSQL container..."
cd server
docker compose up -d
cd ..

# 2. Start Backend API
echo "Starting backend Spring Boot application on http://localhost:8081..."
cd server
if [[ "$OSTYPE" == "msys" || "$OSTYPE" == "win32" || "$OSTYPE" == "cygwin" ]]; then
  ./mvnw.cmd spring-boot:run &
else
  chmod +x mvnw 2>/dev/null || true
  ./mvnw spring-boot:run &
fi
cd ..

# 3. Start Frontend Client
echo "Starting frontend React Vite application..."
cd client
npm run dev &
cd ..

echo "Horizon application is starting up!"
echo "- Backend API: http://localhost:8081"
echo "- Frontend Dev Server: http://localhost:5173"
echo "Press Ctrl+C to stop all services."

# Wait for background jobs to finish/stay running
wait
