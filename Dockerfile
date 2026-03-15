FROM node:18-alpine

# Ghostscript, Exiftool এবং Inkscape ইন্সটল করা হচ্ছে
RUN apk add --no-cache ghostscript ghostscript-fonts exiftool inkscape

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
