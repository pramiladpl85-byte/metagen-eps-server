FROM node:18-alpine

# সার্ভারে Ghostscript ইন্সটল করা
RUN apk add --no-cache ghostscript

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
