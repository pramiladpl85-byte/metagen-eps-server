const express = require('express');
const multer = require('multer');
const { exec, execFile } = require('child_process');
const fs = require('fs');
const path = require('path');
const cors = require('cors');
const ftp = require("basic-ftp");
const SftpClient = require("ssh2-sftp-client");

const app = express();

// CORS
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS']
}));

const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}

// File size limit: max 50 MB
const upload = multer({
    dest: 'uploads/',
    limits: { fileSize: 50 * 1024 * 1024 }
});

// ==========================================
// UptimeRobot Health Check Route
// ==========================================
app.get('/', (req, res) => {
    res.status(200).send('MetaGen EPS & AI Server is Awake and Running Perfectly!');
});

// 1. EPS & AI Preview Generator (Ghostscript Engine - UPDATED FOR .AI SUPPORT)
app.post('/api/extract-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // ফাইলের অরিজিনাল এক্সটেনশন বের করা (.ai বা .eps)
    const ext = path.extname(req.file.originalname).toLowerCase() || '.eps';
    const inputFilePath = req.file.path + ext;
    fs.renameSync(req.file.path, inputFilePath);
    
    const jpgFilePath = `${inputFilePath}.jpg`;

    // .ai ফাইলের জন্য FirstPage রেন্ডারিং এবং .eps এর জন্য EPSCrop ব্যবহার হবে
    const isAi = (ext === '.ai');
    const cropOpt = isAi ? '-dFirstPage=1 -dLastPage=1 -dFitPage' : '-dEPSCrop';

    const cmd = `gs -q -dSAFER -dBATCH -dNOPAUSE ${cropOpt} -r150 -sDEVICE=jpeg -dJPEGQ=85 -dTextAlphaBits=4 -dGraphicsAlphaBits=4 -sOutputFile="${jpgFilePath}" "${inputFilePath}"`;

    exec(cmd, (error, stdout, stderr) => {
        if (error) {
            console.error("Ghostscript Render Error:", stderr || error.message);
            if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            return res.status(500).json({ error: "Failed to render vector file.", details: stderr || error.message });
        }

        try {
            const jpegBuffer = fs.readFileSync(jpgFilePath);
            if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            
            res.json({ 
                success: true, 
                mimeType: "image/jpeg", 
                base64: jpegBuffer.toString('base64') 
            });
        } catch (err) {
            if (fs.existsSync(inputFilePath)) fs.unlinkSync(inputFilePath);
            if (fs.existsSync(jpgFilePath)) fs.unlinkSync(jpgFilePath);
            res.status(500).json({ error: "Failed to read converted image." });
        }
    });
});

// 2. EPS Metadata Embed (ExifTool)
app.post('/api/embed-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const epsFilePath = req.file.path + '.eps';
    fs.renameSync(req.file.path, epsFilePath);
    
    const { title, description, keywords } = req.body;

    const args = [
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

// 3. SVG to EPS Convert + Metadata (Inkscape + ExifTool)
app.post('/api/convert-svg-to-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const svgFilePath = req.file.path + '.svg';
    fs.renameSync(req.file.path, svgFilePath);
    
    const epsFilePath = req.file.path + '_converted.eps';
    const { title, description, keywords } = req.body;

    const convertCmd = `inkscape "${svgFilePath}" --export-area-page --export-filename="${epsFilePath}" --export-type=eps`;

    exec(convertCmd, (error, stdout, stderr) => {
        if (fs.existsSync(svgFilePath)) fs.unlinkSync(svgFilePath);

        if (error) {
            console.error("Inkscape Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to convert SVG to EPS. Ensure Inkscape is installed." });
        }

        const args = [
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

            const originalNameWithoutExt = req.file.originalname.replace(/\.[^/.]+$/, "");
            res.download(epsFilePath, `${originalNameWithoutExt}_meta.eps`, (err) => {
                if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            });
        });
    });
});

// 4. FTP/SFTP Upload API
app.post('/api/ftp-upload', upload.single('file'), async (req, res) => {
    const { host, user, pass, protocol, port } = req.body;
    const file = req.file;

    if (!file || !host || !user || !pass) {
        return res.status(400).json({ success: false, error: "Missing required fields: file, host, user, pass" });
    }

    const cleanHost = host.replace('sftp://', '').replace('ftp://', '').replace('ftps://', '').trim();
    const isSftp = (protocol && protocol.toLowerCase() === 'sftp') || cleanHost.toLowerCase().includes('sftp');
    const customPort = port ? parseInt(port, 10) : null;

    console.log(`[Upload] File: ${file.originalname} (${(file.size / 1024).toFixed(1)} KB) | Host: ${cleanHost} | Port: ${customPort || 'default'} | Mode: ${isSftp ? 'SFTP' : 'FTP/FTPS'}`);

    try {
        if (isSftp) {
            const sftp = new SftpClient();
            try {
                await sftp.connect({
                    host: cleanHost,
                    port: customPort || 22,
                    username: user,
                    password: pass,
                    readyTimeout: 30000,
                    retries: 2
                });

                await sftp.put(file.path, '/' + file.originalname);
                res.json({ success: true, message: `File '${file.originalname}' uploaded via SFTP to ${cleanHost}` });
            } catch (sftpErr) {
                res.status(500).json({ success: false, error: "SFTP Error: " + sftpErr.message });
            } finally {
                await sftp.end().catch(() => {});
            }

        } else {
            let uploaded = false;
            let lastError = null;

            // Step 1: FTPS
            const ftpsClient = new ftp.Client();
            ftpsClient.ftp.verbose = false;
            try {
                await ftpsClient.access({
                    host: cleanHost,
                    user: user,
                    password: pass,
                    secure: true,
                    secureOptions: { rejectUnauthorized: false }
                });
                ftpsClient.ftp.socket.setTimeout(120000);
                await ftpsClient.uploadFrom(file.path, file.originalname);
                res.json({ success: true, message: `File '${file.originalname}' uploaded via FTPS to ${cleanHost}` });
                uploaded = true;
            } catch (ftpsErr) {
                lastError = ftpsErr;
            } finally {
                ftpsClient.close();
            }

            // Step 2: Plain FTP
            if (!uploaded) {
                const plainClient = new ftp.Client();
                plainClient.ftp.verbose = false;
                try {
                    await plainClient.access({
                        host: cleanHost,
                        user: user,
                        password: pass,
                        secure: false
                    });
                    plainClient.ftp.socket.setTimeout(120000);
                    await plainClient.uploadFrom(file.path, file.originalname);
                    res.json({ success: true, message: `File '${file.originalname}' uploaded via FTP to ${cleanHost}` });
                    uploaded = true;
                } catch (plainErr) {
                    lastError = plainErr;
                } finally {
                    plainClient.close();
                }
            }

            if (!uploaded) {
                const errMsg = lastError ? lastError.message : "Unknown FTP error";
                res.status(500).json({ success: false, error: "FTP Connection Failed: " + errMsg });
            }
        }
    } catch (err) {
        res.status(500).json({ success: false, error: "Upload Error: " + err.message });
    } finally {
        try {
            if (file && file.path && fs.existsSync(file.path)) fs.unlinkSync(file.path);
        } catch (cleanupErr) {}
    }
});

// 5. Health Check API
app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'MetaGen Render Server', timestamp: new Date().toISOString() });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`MetaGen Render Server running on port ${PORT}`);
});
