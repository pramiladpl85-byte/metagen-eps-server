const express = require('express');
const multer = require('multer');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const ftp = require("basic-ftp");
const SftpClient = require("ssh2-sftp-client");

const app = express();

// CORS — সব অরিজিন এবং GET/POST দুটোই অনুমতি
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS']
}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// ফাইল সাইজ লিমিট: সর্বোচ্চ ৫০ MB
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 }
});

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


// ৪. FTP/SFTP আপলোড API — হোস্ট অনুযায়ী স্বয়ংক্রিয়ভাবে FTP বা SFTP নির্বাচন করবে
app.post('/api/ftp-upload', upload.single('file'), async (req, res) => {
    const { host, user, pass, protocol } = req.body;
    const file = req.file;

    if (!file || !host || !user || !pass) {
        return res.status(400).json({ success: false, error: "Missing required fields: file, host, user, pass" });
    }

    const cleanHost = host.replace('sftp://', '').replace('ftp://', '').trim();
    // ফ্রন্টএন্ড থেকে পাঠানো protocol ফিল্ড চেক করা, না থাকলে হোস্টনেম থেকে ডিটেক্ট
    const isSftp = (protocol && protocol.toLowerCase() === 'sftp') || cleanHost.toLowerCase().includes('sftp');

    console.log(`[FTP Upload] File: ${file.originalname} | Host: ${cleanHost} | Protocol: ${isSftp ? 'SFTP' : 'FTP'}`);

    try {
        if (isSftp) {
            // ========== SFTP আপলোড (Adobe Stock ইত্যাদি) ==========
            const sftp = new SftpClient();
            try {
                await sftp.connect({
                    host: cleanHost,
                    port: 22,
                    username: user,
                    password: pass,
                    readyTimeout: 30000,   // ৩০ সেকেন্ড কানেকশন টাইমআউট
                    retries: 2
                });

                await sftp.put(file.path, '/' + file.originalname);
                console.log(`[SFTP] Upload successful: ${file.originalname}`);
                res.json({ success: true, message: `File '${file.originalname}' uploaded via SFTP to ${cleanHost}` });
            } catch (sftpErr) {
                console.error(`[SFTP Error] ${cleanHost}:`, sftpErr.message);
                res.status(500).json({ success: false, error: "SFTP Error: " + sftpErr.message });
            } finally {
                await sftp.end().catch(() => {});
            }

        } else {
            // ========== FTP আপলোড (Shutterstock, Freepik ইত্যাদি) ==========
            const client = new ftp.Client();
            client.ftp.verbose = false;

            try {
                await client.access({
                    host: cleanHost,
                    user: user,
                    password: pass,
                    secure: false,
                    secureOptions: { rejectUnauthorized: false }
                });

                // কানেকশন টাইমআউট ৬০ সেকেন্ড
                client.ftp.socket.setTimeout(60000);

                await client.uploadFrom(file.path, file.originalname);
                console.log(`[FTP] Upload successful: ${file.originalname}`);
                res.json({ success: true, message: `File '${file.originalname}' uploaded via FTP to ${cleanHost}` });
            } catch (ftpErr) {
                console.error(`[FTP Error] ${cleanHost}:`, ftpErr.message);
                res.status(500).json({ success: false, error: "FTP Error: " + ftpErr.message });
            } finally {
                client.close();
            }
        }
    } catch (err) {
        console.error(`[Upload Fatal Error]:`, err.message);
        res.status(500).json({ success: false, error: "Upload Error: " + err.message });
    } finally {
        // কাজ শেষে লোকাল ফাইল ডিলিট
        if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
    }
});

// ৫. হেলথ চেক API (Render এর জন্য)
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'MetaGen Render Server' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
