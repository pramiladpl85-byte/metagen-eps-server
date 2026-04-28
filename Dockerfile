FROM node:18

# সিস্টেম ডিপেন্ডেন্সি ইন্সটল (Ghostscript, Inkscape, Exiftool)
RUN apt-get update && apt-get install -y \
    ghostscript \
    inkscape \
    libimage-exiftool-perl \
    && rm -rf /var/lib/apt/lists/*

# অ্যাপ ডিরেক্টরি তৈরি
WORKDIR /app

# প্যাকেজ ফাইল কপি এবং ইন্সটল
COPY package*.json ./
RUN npm install

# সব কোড কপি করা
COPY . .

# পোর্ট এক্সপোজ করা
EXPOSE 3000

# সার্ভার রান করা
CMD ["node", "server.js"]
