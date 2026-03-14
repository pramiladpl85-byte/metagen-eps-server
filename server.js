const express = require('express');
const multer = require('multer');
const { exec } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods:['POST', 'OPTIONS']
}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: 'uploads/' });

app.post('/api/extract-eps', upload.single('file'), (req, res) => {
    if (!req.file) {
        return res.status(400).json({ error: "No file uploaded" });
    }

    const epsFilePath = req.file.path;
    const jpgFilePath = `${epsFilePath}.jpg`;

    // Ghostscript কমান্ড: EPS ফাইলকে সরাসরি JPG তে রেন্ডার করা
    const cmd = `gs -dSAFER -dBATCH -dNOPAUSE -dEPSCrop -r150 -sDEVICE=jpeg -dJPEGQ=80 -sOutputFile="${jpgFilePath}" "${epsFilePath}"`;

    exec(cmd, (error, stdout, stderr) => {
        // প্রসেস শেষে আপলোড হওয়া অরিজিনাল EPS ফাইলটি ডিলিট করা
        if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);

        if (error) {
            console.error("Ghostscript Error:", stderr || error);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            return res.status(500).json({ error: "Failed to render EPS file." });
        }

        try {
            // জেনারেট হওয়া JPG ফাইলটি পড়া
            const jpegBuffer = fs.readFileSync(jpgFilePath);
            const base64Image = jpegBuffer.toString('base64');

            // পাঠানো শেষ হলে JPG ফাইলটিও ডিলিট করে দেওয়া
            fs.unlinkSync(jpgFilePath);

            res.json({ 
                success: true, 
                mimeType: "image/jpeg",
                base64: base64Image 
            });

        } catch (err) {
            console.error("File read error:", err);
            res.status(500).json({ error: "Failed to read converted image." });
        }
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Ghostscript EPS Server running on port ${PORT}`);
});
