FROM node:18-alpine

# ExifTool এবং Ghostscript দুটোই ইন্সটল করা
RUN apk add --no-cache ghostscript exiftool

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
