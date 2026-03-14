const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const sharp = require('sharp');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

// CORS এনাবল করা (যাতে আপনার ওয়েবসাইট থেকে রিকোয়েস্ট ব্লক না হয়)
app.use(cors({
    origin: '*', // আপনি চাইলে শুধু আপনার ওয়েবসাইটের URL দিতে পারেন
    methods: ['POST', 'OPTIONS']
}));

// আপলোড ফোল্ডার তৈরি করা (যদি না থাকে)
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// Multer কনফিগারেশন
const upload = multer({ dest: 'uploads/' });

// API রাউট
app.post('/api/extract-eps', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const epsFilePath = req.file.path;

    // ExifTool কমান্ড: EPS থেকে প্রিভিউ ছবি বের করা
    const cmd = `exiftool -b -TIFFPreview "${epsFilePath}"`;

    exec(cmd, { encoding: 'buffer', maxBuffer: 50 * 1024 * 1024 }, async (error, stdout, stderr) => {
        // প্রসেস শেষে আপলোড হওয়া EPS ফাইলটি সার্ভার থেকে মুছে ফেলা
        if (fs.existsSync(epsFilePath)) {
            fs.unlinkSync(epsFilePath);
        }

        if (error || !stdout || stdout.length === 0) {
            return res.status(400).json({ 
                error: "No preview found. Please ensure the EPS was saved with a preview format." 
            });
        }

        try {
            // ExifTool এর দেওয়া ছবিকে (TIFF) Sharp দিয়ে দ্রুত JPG তে কনভার্ট করা
            const jpegBuffer = await sharp(stdout)
                .resize(800) // AI এর টোকেন বাঁচাতে এবং রেসপন্স ফাস্ট করতে সাইজ ৮০০ পিক্সেল করা হলো
                .jpeg({ quality: 80 })
                .toBuffer();

            const base64Image = jpegBuffer.toString('base64');

            res.json({ 
                success: true, 
                mimeType: "image/jpeg",
                base64: base64Image 
            });

        } catch (err) {
            console.error("Image conversion error:", err);
            res.status(500).json({ error: "Failed to convert preview image." });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MetaGen EPS Server running on port ${PORT}`);
});