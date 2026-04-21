# node:22-slim uses Debian (has native build tools unlike Alpine)
FROM node:22-slim

WORKDIR /app

# Copy package files first (Docker layer caching — faster rebuilds!)
COPY package*.json ./
COPY prisma ./prisma/

# Install OpenSSL (required by Prisma's query engine)
RUN apt-get update -y && apt-get install -y openssl && rm -rf /var/lib/apt/lists/*

# Install ALL dependencies (including devDeps needed for TypeScript build)
RUN npm install

# Copy the rest of the source code
COPY . .

# Generate Prisma Client and compile TypeScript → JavaScript
RUN npx prisma generate
RUN npm run build

# Expose the port the ALB health check expects
EXPOSE 4000

# Run the compiled JS (not ts-node — production uses the compiled output!)
CMD ["npm", "start"]