# Node.js এর হালকা ভার্সন
FROM node:18-alpine

# ExifTool ইন্সটল করা (আল্পাইন লিনাক্সের জন্য)
RUN apk add --no-cache exiftool

# প্রজেক্ট ডিরেক্টরি সেট করা
WORKDIR /app

# প্যাকেজ ফাইল কপি ও ইন্সটল
COPY package*.json ./
RUN npm install

# প্রজেক্টের বাকি ফাইল কপি করা
COPY . .

# পোর্ট ওপেন করা
EXPOSE 3000

# সার্ভার রান করা
CMD ["node", "server.js"]