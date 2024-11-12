async function fetchImages() {
    const response = await fetch('/api/images');
    const images = await response.json();
    return images;
}

function displayImages(images) {
    const container = document.getElementById('images-container');
    container.innerHTML = '';
    images.forEach(image => {
        const card = document.createElement('div');
        card.classList.add('image-card');
        card.innerHTML = `
            <img src="${image.src}" alt="${image.name}">
            <span class="favorite" onclick="toggleFavorite('${image.name}')">
                ${image.favorite ? '★' : '☆'}
            </span>
            <p>${image.name}</p>
            <p>${new Date(image.date).toLocaleString()}</p>
        `;
        container.appendChild(card);
    });
}

function searchImages(images, query) {
    return images.filter(image => image.name.toLowerCase().includes(query.toLowerCase()));
}

function sortImages(images, criteria) {
    return images.sort((a, b) => {
        if (criteria === 'date') {
            return new Date(b.date) - new Date(a.date);
        } else if (criteria === 'name') {
            return a.name.localeCompare(b.name);
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

window.onload = async () => {
    images = await fetchImages();
    displayImages(images);
};
