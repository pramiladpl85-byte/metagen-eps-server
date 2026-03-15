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

    // FIX 1: --export-area-drawing ব্যবহার করা হয়েছে যাতে আর্টবোর্ড একদম ডিজাইনের মাপে ফিট হয়ে যায়
    const convertCmd = `inkscape "${svgFilePath}" --export-area-drawing --export-filename="${epsFilePath}" --export-type=eps`;

    exec(convertCmd, (error, stdout, stderr) => {
        if (fs.existsSync(svgFilePath)) fs.unlinkSync(svgFilePath);

        if (error) {
            console.error("Inkscape Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to convert SVG to EPS. Ensure Inkscape is installed." });
        }

        // FIX 2: 4 Megapixels (4MP) Requirement পূরণ করার জন্য EPS ফাইলকে জুম/আপস্কেল করা হচ্ছে
        try {
            let epsData = fs.readFileSync(epsFilePath, 'utf8');
            let bbRegex = /%%BoundingBox:\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)/;
            let match = epsData.match(bbRegex);

            if (match) {
                let llx = parseFloat(match[1]);
                let lly = parseFloat(match[2]);
                let urx = parseFloat(match[3]);
                let ury = parseFloat(match[4]);
                
                let width = urx - llx;
                let height = ury - lly;
                let maxDim = Math.max(width, height);
                
                // যদি ফাইলের ডাইমেনশন 4500 পিক্সেলের কম হয়, তবে اسے 4500 এ আপস্কেল করা হবে
                if (maxDim > 0 && maxDim < 4500) {
                    let scale = 4500 / maxDim;
                    
                    let newLlx = Math.floor(llx * scale);
                    let newLly = Math.floor(lly * scale);
                    let newUrx = Math.ceil(urx * scale);
                    let newUry = Math.ceil(ury * scale);
                    
                    epsData = epsData.replace(bbRegex, `%%BoundingBox: ${newLlx} ${newLly} ${newUrx} ${newUry}`);
                    
                    let hrRegex = /%%HiResBoundingBox:\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)\s+([-.\d]+)/;
                    if (epsData.match(hrRegex)) {
                        epsData = epsData.replace(hrRegex, (m, p1, p2, p3, p4) => {
                            return `%%HiResBoundingBox: ${(parseFloat(p1)*scale).toFixed(4)} ${(parseFloat(p2)*scale).toFixed(4)} ${(parseFloat(p3)*scale).toFixed(4)} ${(parseFloat(p4)*scale).toFixed(4)}`;
                        });
                    }
                    
                    // PostScript-এর ভেতরে ভেক্টরগুলোকে বড় করার কমান্ড যুক্ত করা
                    if (epsData.includes('%%Page: 1 1')) {
                        epsData = epsData.replace(/(%%Page:\s+1\s+1\r?\n)/, `$1${scale.toFixed(4)} ${scale.toFixed(4)} scale\n`);
                    } else if (epsData.includes('%%EndSetup')) {
                        epsData = epsData.replace(/(%%EndSetup\r?\n)/, `$1${scale.toFixed(4)} ${scale.toFixed(4)} scale\n`);
                    }
                    
                    fs.writeFileSync(epsFilePath, epsData, 'utf8');
                }
            }
        } catch (scaleErr) {
            console.error("Error upscaling EPS:", scaleErr);
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

            const originalNameWithoutExt = req.file.originalname.replace(/\.[^/.]+$/, "");
            res.download(epsFilePath, `${originalNameWithoutExt}_meta.eps`, (err) => {
                if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            });
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
