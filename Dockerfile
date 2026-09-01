FROM node:22-slim

WORKDIR /app

# Mejor-sqlite3 necesita compilar: instalar build-essential
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install

COPY . .

# datos persistidos fuera del contenedor (volumen)
ENV DB_PATH=/data/loteria.db
RUN mkdir -p /data

EXPOSE 3005
CMD ["node", "src/app.js"]
