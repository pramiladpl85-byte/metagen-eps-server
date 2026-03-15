FROM node:18-alpine

# Alpine এ exiftool চলার জন্য perl অবশ্যই লাগবে
RUN apk add --no-cache ghostscript ghostscript-fonts exiftool perl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# আপলোড ফোল্ডার তৈরি নিশ্চিত করা
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 3000

CMD ["node", "server.js"]
