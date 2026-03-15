const express = require('express');
const multer = require('multer');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');

const app = express();

app.use(cors({
    origin: '*',
    methods: ['POST', 'OPTIONS']
}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

const upload = multer({ dest: 'uploads/' });

// ১. EPS প্রিভিউ জেনারেট করার API (Ghostscript দিয়ে)
app.post('/api/extract-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const epsFilePath = req.file.path;
    const jpgFilePath = `${epsFilePath}.jpg`;

    const cmd = `gs -dSAFER -dBATCH -dNOPAUSE -dEPSCrop -r150 -sDEVICE=jpeg -dJPEGQ=80 -sOutputFile="${jpgFilePath}" "${epsFilePath}"`;

    exec(cmd, (error, stdout, stderr) => {
        if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);

        if (error) {
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            return res.status(500).json({ error: "Failed to render EPS file." });
        }

        try {
            const jpegBuffer = fs.readFileSync(jpgFilePath);
            fs.unlinkSync(jpgFilePath);
            res.json({ success: true, mimeType: "image/jpeg", base64: jpegBuffer.toString('base64') });
        } catch (err) {
            res.status(500).json({ error: "Failed to read converted image." });
        }
    });
});

// ২. EPS ফাইলে মেটাডেটা এম্বেড করার নতুন API (ExifTool দিয়ে)
app.post('/api/embed-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const epsFilePath = req.file.path;
    const { title, description, keywords } = req.body;

    // ExifTool এর আর্গুমেন্ট সেট করা (নিরাপত্তার জন্য execFile ব্যবহার করা হলো)
    const args =[
        '-overwrite_original',
        `-Title=${title || ''}`,
        `-ObjectName=${title || ''}`,
        `-Description=${description || ''}`,
        '-sep', ', ',
        `-Keywords=${keywords || ''}`,
        `-Subject=${keywords || ''}`,
        epsFilePath
    ];

    execFile('exiftool', args, (error, stdout, stderr) => {
        if (error) {
            console.error("ExifTool Error:", stderr || error);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to embed metadata in EPS." });
        }

        // এম্বেড করা ফাইলটি ডাউনলোড হিসেবে ফ্রন্টএন্ডে পাঠানো
        res.download(epsFilePath, req.file.originalname, (err) => {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath); // কাজ শেষে ডিলিট
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
