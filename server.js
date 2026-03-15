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

// ১. EPS প্রিভিউ জেনারেট করার API
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

// ১. স্পেশাল ক্যারেক্টার হ্যান্ডেল করার জন্য এই ফাংশনটি সবার উপরে (রাউটের বাইরে) রাখতে পারেন
const escapeXml = (unsafe) => {
    if (!unsafe) return "";
    return unsafe.toString().replace(/[<>&"']/g, (c) => {
        switch (c) {
            case '<': return '&lt;';
            case '>': return '&gt;';
            case '&': return '&amp;';
            case '"': return '&quot;';
            case "'": return '&apos;';
            default: return c;
        }
    });
};

// ২. মেটাডাটা এমবেড করার মূল রাউট
app.post('/api/embed-metadata', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const { title, description, keywords } = req.body;
    const epsFilePath = req.file.path + '.eps';
    
    // ফাইল রিনেম করা
    try {
        fs.renameSync(req.file.path, epsFilePath);
    } catch (err) {
        return res.status(500).json({ error: "File processing error" });
    }

    // কিউওয়ার্ডস অ্যারে তৈরি (এখানেই ভুল হচ্ছিল হয়তো)
    const keywordsArray = keywords ? keywords.split(',').map(k => k.trim()).filter(k => k !== "") : [];

    // এক্সএমপি প্যাকেট তৈরি
    const xmpData = `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
    xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(title)}</rdf:li></rdf:Alt></dc:title>
   <dc:description><rdf:Alt><rdf:li xml:lang="x-default">${escapeXml(description)}</rdf:li></rdf:Alt></dc:description>
   <dc:subject>
    <rdf:Bag>
     ${keywordsArray.map(k => `<rdf:li>${escapeXml(k)}</rdf:li>`).join('\n')}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${escapeXml(title)}</photoshop:Headline>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    const xmpFilePath = req.file.path + '.xmp';
    fs.writeFileSync(xmpFilePath, xmpData, 'utf8');

    // ExifTool কমান্ড সাজানো
    const args = [
        '-overwrite_original',
        '-charset', 'utf8',
        '-codedcharacterset=utf8',
        `-xmp<=${xmpFilePath}`,
        `-IPTC:ObjectName=${title || ""}`,
        `-IPTC:Caption-Abstract=${description || ""}`,
        `-IPTC:Keywords=${keywordsArray.join(',')}`,
        epsFilePath
    ];

    execFile('exiftool', args, (error, stdout, stderr) => {
        // টেম্পোরারি XMP ফাইল ডিলিট
        if (fs.existsSync(xmpFilePath)) fs.unlinkSync(xmpFilePath);

        if (error) {
            console.error("ExifTool Error:", stderr);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to embed metadata." });
        }

        // ফাইল ডাউনলোড শেষে ডিলিট
        res.download(epsFilePath, `metagen_${req.file.originalname}`, (err) => {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
