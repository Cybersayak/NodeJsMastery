const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

app.use(express.static('public')); 

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views/index.html'));
});


app.get('/api/images', (req, res) => {
    const imageDir = path.join(__dirname, 'public/images');
    
    // Check if directory exists
    if (!fs.existsSync(imageDir)) {
        return res.status(500).send('Images directory not found');
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
            const images = imageFiles.map(file => ({
                src: `/images/${file}`,
                name: file,
                date: fs.statSync(path.join(imageDir, file)).mtime,
                favorite: false
            }));
            res.json(images);
        } catch (error) {
            console.error('Error processing images:', error);
            res.status(500).send('Error processing image files');
        }
    });
});


app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
}).on('error', (err) => {
    console.error('Failed to start server:', err);
});


