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

// ২. EPS ফাইলে মেটাডেটা এম্বেড করার API (Advanced XMP Injection)
app.post('/api/embed-eps', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const epsFilePath = req.file.path + '.eps';
    fs.renameSync(req.file.path, epsFilePath);
    
    const { title, description, keywords } = req.body;

    // XMP ডেটা তৈরি করা
    const safeTitle = (title || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeDesc = (description || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const keywordsArray = (keywords || '').split(',').map(k => k.trim()).filter(Boolean);
    const keywordsList = keywordsArray.map(k => `<rdf:li>${k.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')}</rdf:li>`).join('\n     ');

    const xmpData = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="Adobe XMP Core 5.6">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/">
   <dc:title>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${safeTitle}</rdf:li>
    </rdf:Alt>
   </dc:title>
   <dc:description>
    <rdf:Alt>
     <rdf:li xml:lang="x-default">${safeDesc}</rdf:li>
    </rdf:Alt>
   </dc:description>
   <dc:subject>
    <rdf:Bag>
     ${keywordsList}
    </rdf:Bag>
   </dc:subject>
   <photoshop:Headline>${safeTitle}</photoshop:Headline>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    const xmpFilePath = req.file.path + '.xmp';
    fs.writeFileSync(xmpFilePath, xmpData, 'utf8');

    // ExifTool কমান্ড: XMP ফাইল থেকে ডাইরেক্ট ইনজেক্ট করা হবে
    const args =[
        '-overwrite_original',
        '-charset', 'utf8',
        '-charset', 'iptc=utf8',
        '-codedcharacterset=utf8',
        `-xmp<=${xmpFilePath}` // Inject Full XMP Block
    ];

    // সাথে IPTC ট্যাগও যোগ করে দেওয়া হলো ব্যাকআপ হিসেবে
    if (title) args.push(`-IPTC:ObjectName=${title}`);
    if (description) args.push(`-IPTC:Caption-Abstract=${description}`);
    if (keywordsArray.length > 0) {
        args.push('-sep', ',');
        args.push(`-IPTC:Keywords=${keywordsArray.join(',')}`);
    }

    args.push(epsFilePath);

    execFile('exiftool', args, (error, stdout, stderr) => {
        if (fs.existsSync(xmpFilePath)) fs.unlinkSync(xmpFilePath); // xmp ডিলিট
        
        if (error) {
            console.error("ExifTool Error:", stderr || error.message);
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath);
            return res.status(500).json({ error: "Failed to embed metadata in EPS." });
        }

        res.download(epsFilePath, req.file.originalname, (err) => {
            if (fs.existsSync(epsFilePath)) fs.unlinkSync(epsFilePath); // কাজ শেষে eps ডিলিট
        });
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
