const fs = require('fs').promises;
//const fs = require('fs');
const path = require('path');

const multer = require('multer');
const sharp = require('sharp');

const crypto = require('crypto');
const WebSocket = require('ws');
const http = require('http');



const express = require('express');
const app = express();
const PORT = 3000;

app.use(express.static('public')); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/index.html'));
});

const imageMetadata = require('./imageMetadata.json');

app.get('/api/images', async (req, res) => {
    const imageDir = path.join(__dirname, 'public/images');
    
    try {
        // Check if directory exists
        await fs.access(imageDir);
        
        // Read directory
        const files = await fs.readdir(imageDir);
        
        // Filter for image files
        const imageFiles = files.filter(file => {
            const ext = path.extname(file).toLowerCase();
            return ['.jpg', '.jpeg', '.png', '.gif'].includes(ext);
        });

        // Get file stats
        const images = await Promise.all(imageFiles.map(async file => {
            const metadata = imageMetadata[file] || {};
            const stats = await fs.stat(path.join(imageDir, file));
            
            return {
                src: `/images/${file}`,
                name: file,
                date: stats.mtime,
                favorite: false,
                tags: metadata.tags || [],
                location: metadata.location || null
            };
        }));

        res.json(images);
    } catch (error) {
        console.error('Error processing images:', error);
        res.status(500).json({ error: 'Error processing image files' });
    }
});

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

async function initializeDirectories() {
    const dirs = [
        path.join(__dirname, 'public/images'),
        path.join(__dirname, 'public/images/thumbnails'),
        path.join(__dirname, 'data')
    ];

    for (const dir of dirs) {
        try {
            await fs.access(dir);
        } catch {
            await fs.mkdir(dir, { recursive: true });
            console.log(`Created directory: ${dir}`);
        }
    }
}

server.listen(PORT, async () => {
    await initializeDirectories();
    console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('Failed to start server:', err);
});

// 1. Enhanced Image Upload with Processing
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/images')
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname)
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
wss.on('error', (error) => {
    console.error('WebSocket Server Error:', error);
});

wss.on('connection', (ws) => {
    console.log('New client connected');
    
    ws.on('message', (message) => {
        try {
            const data = JSON.parse(message);
            // Broadcast updates to all clients
            wss.clients.forEach((client) => {
                if (client !== ws && client.readyState === WebSocket.OPEN) {
                    client.send(JSON.stringify(data));
                }
            });
        } catch (error) {
            console.error('WebSocket message error:', error);
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket client error:', error);
    });

    ws.on('close', () => {
        console.log('Client disconnected');
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


