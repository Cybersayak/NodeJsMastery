async function fetchImages() {
    try {
        const response = await fetch('/api/images');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const images = await response.json();
        console.log('Fetched images:', images);
        return images;
    } catch (error) {
        console.error('Error fetching images:', error);
        return [];
    }
}

function displayImages(images) {
    const container = document.getElementById('images-container');
    if (!container) {
        console.error('Images container not found');
        return;
    }
    
    container.innerHTML = '';
    
    if (!images || images.length === 0) {
        container.innerHTML = '<p>No images found</p>';
        return;
    }

    images.forEach(image => {
        const card = document.createElement('div');
        card.classList.add('image-card');
        
        // Add error handling for image loading
        const imgHtml = `
            <img src="${image.src}" 
                 alt="${image.name}"
                 onerror="this.onerror=null; this.src='/path/to/fallback-image.jpg';"
                 loading="lazy">
        `;
        
        card.innerHTML = `
            ${imgHtml}
            <span class="favorite" onclick="toggleFavorite('${image.name}')">
                ${image.favorite ? '★' : '☆'}
            </span>
            <p class="image-name">${image.name}</p>
            <p class="image-date">${new Date(image.date).toLocaleString()}</p>
            <div class="metadata-container">
                <p class="image-location" onclick="filterByLocation('${image.location || ''}')">
                    <span class="location-icon">📍</span> ${image.location || 'No location'}
                </p>
                <p class="image-tags">
                    <span class="tag-icon">🏷️</span> 
                    ${image.tags ? image.tags.map(tag => 
                        `<span class="tag" onclick="filterByTag('${tag}')">${tag}</span>`
                    ).join(', ') : 'No tags'}
                </p>
            </div>
        `;
        container.appendChild(card);
    });
}

function filterByTag(tag) {
    const filteredImages = images.filter(image => 
        image.tags && image.tags.includes(tag)
    );
    displayImages(filteredImages);
}

function filterByLocation(location) {
    if (!location) return;
    const filteredImages = images.filter(image => 
        image.location === location
    );
    displayImages(filteredImages);
}

function searchImages(images, query) {
    query = query.toLowerCase();
    return images.filter(image => {
        return image.name.toLowerCase().includes(query) ||
               (image.tags && image.tags.some(tag => tag.toLowerCase().includes(query))) ||
               (image.location && image.location.toLowerCase().includes(query));
    });
}

function sortImages(images, criteria) {
    return images.sort((a, b) => {
        switch (criteria) {
            case 'date':
                return new Date(b.date) - new Date(a.date);
            case 'name':
                return a.name.localeCompare(b.name);
            case 'tags':
                const aTag = (a.tags && a.tags[0]) || 'z';
                const bTag = (b.tags && b.tags[0]) || 'z';
                return aTag.localeCompare(bTag);
            case 'location':
                const aLoc = a.location || 'z';
                const bLoc = b.location || 'z';
                return aLoc.localeCompare(bLoc);
            default:
                return 0;
        }
    });
}

function toggleFavorite(imageName) {
    const image = images.find(img => img.name === imageName);
    image.favorite = !image.favorite;
    displayImages(images);
}

document.getElementById('search').addEventListener('input', (event) => {
    const filteredImages = searchImages(images, event.target.value);
    displayImages(filteredImages);
});

document.getElementById('sort').addEventListener('change', (event) => {
    const sortedImages = sortImages(images, event.target.value);
    displayImages(sortedImages);
});

let images = [];

window.addEventListener('DOMContentLoaded', async () => {
    images = await fetchImages();
    displayImages(images);
});

const clientCode = `
// WebSocket Connection

const ws = new WebSocket('ws://localhost:3000');

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
        case 'new-image':
            addImageToGallery(data.data);
            break;
        case 'favorite-update':
            updateFavoriteStatus(data.data);
            break;
    }
};

ws.onerror = (error) => {
    console.error('WebSocket error:', error);
};

ws.onclose = () => {
    console.log('WebSocket connection closed');
    // Implement reconnection logic if needed
};

// Infinite Scrolling

let page = 1;
let loading = false;

window.addEventListener('scroll', () => {
    if (loading) return;
    
    if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 1000) {
        loading = true;
        loadMoreImages(page++).then(() => {
            loading = false;
        });
    }
});

// Drag and Drop Upload
const dropZone = document.getElementById('drop-zone');

dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('drag-over');
});

dropZone.addEventListener('drop', async (e) => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
        if (file.type.startsWith('image/')) {
            await uploadImage(file);
        }
    }
});

// Image Processing UI
function setupImageProcessing() {
    const processingForm = document.getElementById('processing-form');
    
    processingForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const operations = [];
        if (e.target.resize.checked) {
            operations.push({
                type: 'resize',
                width: parseInt(e.target.width.value),
                height: parseInt(e.target.height.value),
                fit: e.target.fit.value
            });
        }
        
        if (e.target.rotate.checked) {
            operations.push({
                type: 'rotate',
                angle: parseInt(e.target.angle.value)
            });
        }
        
        const response = await fetch('/api/process-image', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                imageId: currentImageId,
                operations
            })
        });
        
        const result = await response.json();
        if (result.success) {
            showProcessedImage(result.processedImageUrl);
        }
    });
}
`;