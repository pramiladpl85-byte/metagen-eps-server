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

    // Multer এক্সটেনশন ছাড়া ফাইল সেভ করে, তাই আমরা ফাইলের শেষে .eps যুক্ত করে নিচ্ছি
    const epsFilePath = req.file.path + '.eps';
    fs.renameSync(req.file.path, epsFilePath);
    
    const jpgFilePath = `${epsFilePath}.jpg`;

    // Ghostscript কমান্ড (অপ্টিমাইজড)
    const cmd = `gs -q -dSAFER -dBATCH -dNOPAUSE -dEPSCrop -r100 -sDEVICE=jpeg -dJPEGQ=80 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${jpgFilePath}" "${epsFilePath}"`;

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error("Ghostscript Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            return res.status(500).json({ error: "Failed to render EPS file.", details: stderr });
        }

        try {
            const jpegBuffer = fs.readFileSync(jpgFilePath);
            
            fs.unlinkSync(epsFilePath);
            fs.unlinkSync(jpgFilePath);
            
            res.json({ success: true, mimeType: "image/jpeg", base64: jpegBuffer.toString('base64') });
        } catch (err) {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            res.status(500).json({ error: "Failed to read converted image." });
        }
    });
});

// ২. EPS ফাইলে মেটাডেটা এম্বেড করার API (ExifTool দিয়ে)
app.post('/api/embed-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const epsFilePath = req.file.path + '.eps';
    fs.renameSync(req.file.path, epsFilePath);
    
    const { title, description, keywords } = req.body;

    // ExifTool কমান্ড: Adobe Illustrator এবং Stock সাইট (Shutterstock/Adobe) এর জন্য সঠিক ট্যাগ ও এনকোডিং
    const args =[
        '-overwrite_original',
        '-charset', 'utf8',
        '-charset', 'iptc=utf8',
        '-codedcharacterset=utf8'
    ];

    // Document Title
    if (title) {
        args.push(`-XMP-dc:Title=${title}`);
        args.push(`-ObjectName=${title}`); // IPTC Standard Title
    }

    // Description
    if (description) {
        args.push(`-XMP-dc:Description=${description}`);
        args.push(`-Caption-Abstract=${description}`); // IPTC Standard Description
    }

    // Keywords
    if (keywords) {
        // FIX: স্পেস পরিষ্কার করে জয়েন করা হচ্ছে, যাতে ExifTool সঠিকভাবে অ্যারে বানায়
        const cleanKeywords = keywords.split(',').map(k => k.trim()).filter(Boolean).join(',');
        args.push('-sep', ','); 
        args.push(`-XMP-dc:Subject=${cleanKeywords}`); // XMP Keywords
        args.push(`-Keywords=${cleanKeywords}`); // IPTC Keywords
    }

    args.push(epsFilePath);

    execFile('exiftool', args, (error, stdout, stderr) => {
        if (error) {
            console.error("ExifTool Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to embed metadata in EPS." });
        }

        // ফ্রন্টএন্ডে ফাইল ডাউনলোড করতে পাঠানো
        res.download(epsFilePath, req.file.originalname, (err) => {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath); // কাজ শেষে ডিলিট
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
