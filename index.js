const express = require('express');
const fs = require('fs');
const path = require('path');

const multer = require('multer');
const sharp = require('sharp');
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');

const app = express();
const PORT = 3000;

app.use('/images', express.static(path.join(__dirname, 'public/images')));
app.use(express.static('public')); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/index.html'));
});

const imageMetadata = require('./imageMetadata.json');

app.get('/api/images', (req, res) => {
    const imageDir = path.join(__dirname, 'public/images');
    
    // Add directory creation if it doesn't exist
    if (!fs.existsSync(imageDir)) {
        fs.mkdirSync(imageDir, { recursive: true });
    }

    fs.readdir(imageDir, (err, files) => {
        if (err) {
            console.error('Error reading directory:', err);
            return res.status(500).send('Error reading image files');
        }
        
        // Filter for image files
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
        });

        try {
            const images = imageFiles.map(file => {
                // Get metadata from JSON file or use defaults
                const metadata = imageMetadata[file] || {};
                
                return {
                    src: `/images/${encodeURIComponent(file)}`,
                    name: file,
                    date: fs.statSync(path.join(imageDir, file)).mtime,
                    favorite: false,
                    tags: metadata.tags || [],
                    location: metadata.location || null
                };
            });
            res.json(images);
        } catch (error) {
            console.error('Error processing images:', error);
            res.status(500).send('Error processing image files');
        }
    });
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('Failed to start server:', err);
});

// 1. Enhanced Image Upload with Processing
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images/uploads')
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + path.extname(file.originalname))
    }
});

const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
        if (!allowedTypes.includes(file.mimetype)) {
            return cb(new Error('Invalid file type'), false);
        }
        cb(null, true);
    },
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB limit
    }
});

// 2. Image Processing Middleware
async function processImage(req, res, next) {
    if (!req.file) return next();

    try {
        const image = sharp(req.file.path);
        const metadata = await image.metadata();

        // Create thumbnail
        await image
            .resize(200, 200, { fit: 'cover' })
            .jpeg({ quality: 80 })
            .toFile(path.join('public/images/thumbnails', `thumb_${req.file.filename}`));

        // Add metadata
        req.imageMetadata = {
            width: metadata.width,
            height: metadata.height,
            format: metadata.format,
            size: req.file.size
        };

        next();
    } catch (error) {
        next(error);
    }
}

// 3. Real-time Gallery Updates using WebSocket
wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        const data = JSON.parse(message);
        // Broadcast updates to all clients
        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });
});

// 4. Advanced Image Routes
app.post('/api/upload', upload.single('image'), processImage, async (req, res) => {
    try {
        const imageData = {
            filename: req.file.filename,
            metadata: req.imageMetadata,
            uploadDate: new Date(),
            tags: req.body.tags ? req.body.tags.split(',') : [],
            location: req.body.location || null
        };

        // Save metadata to JSON file
        await updateImageMetadata(imageData);

        // Notify connected clients
        wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
                client.send(JSON.stringify({ type: 'new-image', data: imageData }));
            }
        });

        res.json({ success: true, data: imageData });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// 5. Persistent Favorites System
const favoritesPath = path.join(__dirname, 'data', 'favorites.json');

async function updateFavorites(userId, imageId, isFavorite) {
    try {
        let favorites = {};
        try {
            favorites = JSON.parse(await fs.readFile(favoritesPath, 'utf8'));
        } catch (error) {
            // File doesn't exist or is empty
        }

        if (!favorites[userId]) {
            favorites[userId] = [];
        }

        if (isFavorite) {
            favorites[userId].push(imageId);
        } else {
            favorites[userId] = favorites[userId].filter(id => id !== imageId);
        }

        await fs.writeFile(favoritesPath, JSON.stringify(favorites, null, 2));
        return true;
    } catch (error) {
        console.error('Error updating favorites:', error);
        return false;
    }
}

app.post('/api/favorites', express.json(), async (req, res) => {
    const { userId, imageId, isFavorite } = req.body;
    const success = await updateFavorites(userId, imageId, isFavorite);
    res.json({ success });
});

// 6. Image Organization and Albums
async function createAlbum(name, description, images) {
    const albumId = crypto.randomBytes(16).toString('hex');
    const albumData = {
        id: albumId,
        name,
        description,
        created: new Date(),
        images: images || [],
    };

    const albumsPath = path.join(__dirname, 'data', 'albums.json');
    let albums = {};
    
    try {
        albums = JSON.parse(await fs.readFile(albumsPath, 'utf8'));
    } catch (error) {
        // File doesn't exist or is empty
    }

    albums[albumId] = albumData;
    await fs.writeFile(albumsPath, JSON.stringify(albums, null, 2));
    return albumData;
}

// 7. Image Processing Queue
const Queue = require('bull');
const imageQueue = new Queue('image-processing');

imageQueue.process(async (job) => {
    const { filepath, operations } = job.data;
    
    let imageProcessor = sharp(filepath);
    
    for (const op of operations) {
        switch (op.type) {
            case 'resize':
                imageProcessor = imageProcessor.resize(op.width, op.height, { fit: op.fit });
                break;
            case 'rotate':
                imageProcessor = imageProcessor.rotate(op.angle);
                break;
            case 'format':
                imageProcessor = imageProcessor.toFormat(op.format, op.options);
                break;
        }
    }
    
    const outputPath = path.join(
        path.dirname(filepath),
        'processed_' + path.basename(filepath)
    );
    
    await imageProcessor.toFile(outputPath);
    return outputPath;
});

// 8. Image Analytics
async function trackImageView(imageId, userId) {
    const analyticsPath = path.join(__dirname, 'data', 'analytics.json');
    let analytics = {};
    
    try {
        analytics = JSON.parse(await fs.readFile(analyticsPath, 'utf8'));
    } catch (error) {
        // File doesn't exist or is empty
    }

    if (!analytics[imageId]) {
        analytics[imageId] = {
            views: 0,
            uniqueViews: new Set(),
            lastViewed: null
        };
    }

    analytics[imageId].views++;
    analytics[imageId].uniqueViews.add(userId);
    analytics[imageId].lastViewed = new Date();

    await fs.writeFile(analyticsPath, JSON.stringify(
        analytics,
        (key, value) => key === 'uniqueViews' ? Array.from(value) : value,
        2
    ));
}

// Add error handling middleware at the end of your Express setup
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error' : err.message
    });
});


