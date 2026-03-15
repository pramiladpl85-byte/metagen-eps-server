FROM node:18-alpine

# Ghostscript, Exiftool এবং প্রয়োজনীয় ফন্ট ইন্সটল করা হচ্ছে
RUN apk add --no-cache ghostscript ghostscript-fonts exiftool

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD["node", "server.js"]
