const express = require('express');
const multer = require('multer');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const ftp = require("basic-ftp");
const SftpClient = require("ssh2-sftp-client");

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

    const epsFilePath = req.file.path + '.eps';
    fs.renameSync(req.file.path, epsFilePath);
    
    const jpgFilePath = `${epsFilePath}.jpg`;

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
            
            // কাজ শেষে ফাইল ডিলিট
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

    const args =[
        '-overwrite_original',
        '-charset', 'utf8',
        '-charset', 'iptc=utf8',
        '-codedcharacterset=utf8',
        
        `-Title=${title || ''}`,
        `-XMP-dc:Title=${title || ''}`,
        `-XMP-photoshop:Headline=${title || ''}`,
        `-IPTC:ObjectName=${title || ''}`,
        
        `-Description=${description || ''}`,
        `-XMP-dc:Description=${description || ''}`,
        `-IPTC:Caption-Abstract=${description || ''}`
    ];

    if (keywords) {
        const cleanKeywords = keywords.split(',').map(k => k.trim()).filter(Boolean).join(',');
        args.push('-sep', ',');
        args.push(`-Keywords=${cleanKeywords}`);
        args.push(`-XMP-dc:Subject=${cleanKeywords}`);
        args.push(`-IPTC:Keywords=${cleanKeywords}`);
    }
        
    args.push(epsFilePath);

    execFile('exiftool', args, (error, stdout, stderr) => {
        if (error) {
            console.error("ExifTool Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to embed metadata in EPS." });
        }

        res.download(epsFilePath, req.file.originalname, (err) => {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath); 
        });
    });
});

// ৩. SVG থেকে EPS এ কনভার্ট এবং মেটাডেটা এম্বেড (Inkscape)
app.post('/api/convert-svg-to-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const svgFilePath = req.file.path + '.svg';
    fs.renameSync(req.file.path, svgFilePath);
    
    const epsFilePath = req.file.path + '_converted.eps';
    const { title, description, keywords } = req.body;

    // FIX: --export-area-page ব্যবহার করা হয়েছে। 
    // এটি অরিজিনাল SVG এর আর্টবোর্ড সাইজ (যেমন: 4000x4000) হুবহু বজায় রাখবে। কোনো এক্সট্রা স্কেলিং বা সাইজ বড় করবে না।
    const convertCmd = `inkscape "${svgFilePath}" --export-area-page --export-filename="${epsFilePath}" --export-type=eps`;

    exec(convertCmd, (error, stdout, stderr) => {
        // অরিজিনাল SVG ডিলিট
        if (fs.existsSync(svgFilePath)) fs.unlinkSync(svgFilePath);

        if (error) {
            console.error("Inkscape Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to convert SVG to EPS. Ensure Inkscape is installed." });
        }

        // Exiftool দিয়ে নতুন তৈরি হওয়া EPS ফাইলে মেটাডেটা এম্বেড
        const args =[
            '-overwrite_original',
            '-charset', 'utf8',
            '-charset', 'iptc=utf8',
            '-codedcharacterset=utf8',
            
            `-Title=${title || ''}`,
            `-XMP-dc:Title=${title || ''}`,
            `-XMP-photoshop:Headline=${title || ''}`,
            `-IPTC:ObjectName=${title || ''}`,
            
            `-Description=${description || ''}`,
            `-XMP-dc:Description=${description || ''}`,
            `-IPTC:Caption-Abstract=${description || ''}`
        ];

        if (keywords) {
            const cleanKeywords = keywords.split(',').map(k => k.trim()).filter(Boolean).join(',');
            args.push('-sep', ',');
            args.push(`-Keywords=${cleanKeywords}`);
            args.push(`-XMP-dc:Subject=${cleanKeywords}`);
            args.push(`-IPTC:Keywords=${cleanKeywords}`);
        }

        args.push(epsFilePath);

        execFile('exiftool', args, (exifError, exifStdout, exifStderr) => {
            if (exifError) {
                console.error("ExifTool Error (Post-Convert):", exifStderr || exifError.message);
                if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
                return res.status(500).json({ error: "Failed to embed metadata in converted EPS." });
            }

            // ফ্রন্টএন্ডে ফাইনাল EPS ডাউনলোড করতে পাঠানো
            const originalNameWithoutExt = req.file.originalname.replace(/\.[^/.]+$/, "");
            res.download(epsFilePath, `${originalNameWithoutExt}_meta.eps`, (err) => {
                if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            });
        });
    });
});

// ৪. FTP/SFTP আপলোড API
app.post('/api/ftp-upload', upload.single('file'), async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, message: "No file uploaded" });

    const { host, user, pass } = req.body;
    const localFilePath = req.file.path;
    const remoteFileName = req.file.originalname;

    // Adobe Stock সাধারণত SFTP ব্যবহার করে (Port 22), বাকিরা FTP (Port 21)
    const isSFTP = host.includes("adobestock") || host.includes("contributor.adobestock.com") || host.includes("sftp");

    if (isSFTP) {
        // --- SFTP আপলোড লজিক (Adobe Stock এর জন্য) ---
        const sftp = new SftpClient();
        try {
            await sftp.connect({
                host: host.replace('sftp://', ''),
                port: 22,
                username: user,
                password: pass,
            });
            await sftp.put(localFilePath, remoteFileName);
            await sftp.end();
            
            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            res.json({ success: true, message: `Successfully uploaded ${remoteFileName} to ${host} via SFTP` });
        } catch (err) {
            console.error("SFTP Error:", err.message);
            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            res.status(500).json({ success: false, message: "SFTP Upload Failed: " + err.message });
        }
    } else {
        // --- স্ট্যান্ডার্ড FTP আপলোড লজিক (Shutterstock, Freepik এর জন্য) ---
        const client = new ftp.Client();
        client.ftp.verbose = false;
        try {
            await client.access({
                host: host.replace('ftp://', ''),
                user: user,
                password: pass,
                secure: false // মাইক্রোস্টক সাইটগুলো সাধারণত প্লেইন FTP ব্যবহার করে
            });
            await client.uploadFrom(localFilePath, remoteFileName);
            client.close();

            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            res.json({ success: true, message: `Successfully uploaded ${remoteFileName} to ${host} via FTP` });
        } catch (err) {
            console.error("FTP Error:", err.message);
            if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            res.status(500).json({ success: false, message: "FTP Upload Failed: " + err.message });
        }
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
