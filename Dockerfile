FROM node:18-alpine

# perl এবং exiftool নিশ্চিত করা হচ্ছে
RUN apk add --no-cache ghostscript ghostscript-fonts exiftool perl

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

# আপলোড ফোল্ডার তৈরি এবং পারমিশন
RUN mkdir -p uploads && chmod 777 uploads

EXPOSE 3000

CMD ["node", "server.js"]
