// =============================================
// MEGANE_PICTURE — app.js
// VERSION OPTIMISÉE POUR WEBVIEW ANDROID
// =============================================

// ===== SUPABASE CONFIG =====
const SUPABASE_URL = 'https://fuulsbckqjzedtbimqaq.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZ1dWxzYmNrcWp6ZWR0YmltcWFxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYxNzA0NTgsImV4cCI6MjA5MTc0NjQ1OH0.g0vlcB0pdQZjmw6ax69dBCE40HlSCjBjT2QXzutYuPk';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);

// ===== DÉTECTION ANDROID =====
const isAndroid = /android/i.test(navigator.userAgent);
if (isAndroid) {
    document.body.classList.add('android-optimized');
}

// ===== ÉTAT GLOBAL =====
let photos = [];
let folders = [];
let selectedPhotos = new Set();
let multiSelectMode = false;
let currentUser = null;
let currentFolderId = null;
let searchQuery = '';

// État upload
let uploadQueue = [];
let uploadCancelled = false;
let uploadInProgress = false;

// Mode nuit
let isDarkMode = false;

// Éléments DOM
const gallery = document.getElementById('gallery');
const photoCountSpan = document.getElementById('photoCount');
const sizeSlider = document.getElementById('sizeSlider');
const sizeValue = document.getElementById('sizeValue');
const actionBar = document.getElementById('actionBar');
const searchBar = document.getElementById('searchBar');
const searchInput = document.getElementById('searchInput');
const foldersScroll = document.getElementById('foldersScroll');
const mainHeader = document.getElementById('mainHeader');

// ===== STOCKAGE LOCAL =====
const STORAGE_KEY = 'megane_photos_cache';
const FOLDERS_KEY = 'megane_folders_cache';

function savePhotosToLocalStorage() {
    if (!currentUser) return;
    const cache = {
        userId: currentUser.id,
        photos: photos,
        timestamp: Date.now()
    };
    localStorage.setItem(`${STORAGE_KEY}_${currentUser.id}`, JSON.stringify(cache));
}

function loadPhotosFromLocalStorage() {
    if (!currentUser) return null;
    const cached = localStorage.getItem(`${STORAGE_KEY}_${currentUser.id}`);
    if (cached) {
        const data = JSON.parse(cached);
        if (Date.now() - data.timestamp < 24 * 60 * 60 * 1000) {
            return data.photos;
        }
    }
    return null;
}

function saveFoldersToLocalStorage() {
    if (!currentUser) return;
    localStorage.setItem(`${FOLDERS_KEY}_${currentUser.id}`, JSON.stringify(folders));
}

function loadFoldersFromLocalStorage() {
    if (!currentUser) return null;
    const cached = localStorage.getItem(`${FOLDERS_KEY}_${currentUser.id}`);
    return cached ? JSON.parse(cached) : null;
}

// ===== NOTIFICATION HEADER =====
function notifyHeader(success) {
    mainHeader.classList.add(success ? 'success' : 'error');
    setTimeout(() => {
        mainHeader.classList.remove('success', 'error');
    }, 2000);
}

// ===== VÉRIFICATION SESSION =====
async function checkSession() {
    const { data: { session }, error } = await sb.auth.getSession();
    if (error || !session) {
        window.location.href = 'login.html';
        return null;
    }
    currentUser = session.user;
    const emailField = document.getElementById('profileEmail');
    if (emailField) emailField.value = currentUser.email;
    return session;
}

// ===== CHARGEMENT DOSSIERS =====
async function loadFolders() {
    if (!currentUser) return;
    
    const cachedFolders = loadFoldersFromLocalStorage();
    if (cachedFolders) {
        folders = cachedFolders;
        renderFolders();
    }
    
    const { data, error } = await sb
        .from('folders')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('name', { ascending: true });
    
    if (!error && data) {
        folders = data;
        renderFolders();
        saveFoldersToLocalStorage();
    }
}

// ===== RENDU DOSSIERS =====
function renderFolders() {
    if (!foldersScroll) return;
    
    const hasActiveFolder = currentFolderId !== null;
    
    foldersScroll.innerHTML = `
        <div class="folder-card ${!hasActiveFolder ? 'active' : ''}" data-folder-id="">
            <i class="fas ${hasActiveFolder ? 'fa-folder' : 'fa-arrow-left'}"></i>
            <span>${hasActiveFolder ? 'Retour' : 'Tous'}</span>
        </div>
        ${folders.map(folder => `
            <div class="folder-card ${currentFolderId === folder.id ? 'active' : ''}" data-folder-id="${folder.id}">
                <i class="fas fa-folder"></i>
                <span>${escapeHtml(folder.name)}</span>
            </div>
        `).join('')}
    `;
    
    document.querySelectorAll('.folder-card').forEach(card => {
        card.addEventListener('click', (e) => {
            e.stopPropagation();
            const folderId = card.dataset.folderId;
            selectFolder(folderId === '' ? null : folderId);
        });
        
        if (card.dataset.folderId && card.dataset.folderId !== '') {
            let folderPressTimer;
            card.addEventListener('touchstart', () => {
                folderPressTimer = setTimeout(() => {
                    const folder = folders.find(f => f.id === card.dataset.folderId);
                    if (folder) openFolderActionsModal(folder);
                }, 600);
            });
            card.addEventListener('touchend', () => clearTimeout(folderPressTimer));
            card.addEventListener('touchcancel', () => clearTimeout(folderPressTimer));
        }
    });
}

function selectFolder(folderId) {
    currentFolderId = folderId;
    renderFolders();
    loadPhotos();
}

// ===== CHARGEMENT PHOTOS =====
async function loadPhotos(syncFromServer = true) {
    if (!currentUser) return;
    
    const cachedPhotos = loadPhotosFromLocalStorage();
    if (cachedPhotos) {
        photos = cachedPhotos.filter(p => {
            if (currentFolderId === null) return p.folder_id === null;
            return p.folder_id === currentFolderId;
        });
        if (searchQuery) {
            photos = photos.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
        }
        renderGallery();
    } else {
        gallery.innerHTML = `<div class="loading-placeholder"><i class="fas fa-spinner fa-pulse"></i><p>Chargement…</p></div>`;
    }
    
    if (syncFromServer) {
        try {
            let query = sb
                .from('photos')
                .select('*')
                .eq('user_id', currentUser.id)
                .order('created_at', { ascending: false });
            
            if (currentFolderId === null) {
                query = query.is('folder_id', null);
            } else {
                query = query.eq('folder_id', currentFolderId);
            }
            
            const { data, error } = await query;
            
            if (!error && data) {
                photos = data;
                if (searchQuery) {
                    photos = photos.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase()));
                }
                renderGallery();
                savePhotosToLocalStorage();
            }
        } catch (error) {
            console.warn('Sync error:', error);
        }
    }
}

// ===== LAZY LOADING IMAGES =====
function lazyLoadImages() {
    const images = document.querySelectorAll('.photo-img[data-src]');
    if (images.length === 0) return;
    
    const observer = new IntersectionObserver((entries) => {
        for (let i = 0; i < entries.length; i++) {
            const entry = entries[i];
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.removeAttribute('data-src');
                observer.unobserve(img);
            }
        }
    }, { rootMargin: '100px' });
    
    for (let i = 0; i < images.length; i++) {
        observer.observe(images[i]);
    }
}

// ===== RENDU GALERIE OPTIMISÉ =====
function renderGallery() {
    const cardSize = parseInt(sizeSlider.value);
    sizeValue.textContent = cardSize + 'px';
    document.documentElement.style.setProperty('--card-size', cardSize + 'px');
    
    if (photos.length === 0) {
        gallery.innerHTML = `<div class="loading-placeholder"><i class="fas fa-cloud-upload-alt"></i><p>Aucune photo</p><p class="sub">Appuyez sur + pour ajouter</p></div>`;
        photoCountSpan.textContent = '📷 0 photo';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    const grouped = groupPhotosByDate(photos);
    
    for (const [dateLabel, groupPhotos] of Object.entries(grouped)) {
        const section = document.createElement('div');
        section.className = 'date-section';
        
        const header = document.createElement('div');
        header.className = 'date-header';
        header.textContent = dateLabel;
        section.appendChild(header);
        
        const photosContainer = document.createElement('div');
        photosContainer.className = 'date-photos';
        
        for (let i = 0; i < groupPhotos.length; i++) {
            const photo = groupPhotos[i];
            const isSelected = selectedPhotos.has(photo.id);
            const shortName = photo.name.length > 20 ? photo.name.substring(0, 17) + '…' : photo.name;
            
            const card = document.createElement('div');
            card.className = `photo-card ${multiSelectMode ? 'multi-select-mode' : ''} ${isSelected ? 'selected' : ''}`;
            card.dataset.id = photo.id;
            card.dataset.name = photo.name;
            card.dataset.url = photo.url;
            
            card.innerHTML = `
                <div class="photo-checkbox">
                    <input type="checkbox" class="photo-check" ${isSelected ? 'checked' : ''}>
                </div>
                <div class="photo-frame">
                    <img class="photo-img" data-src="${photo.url}" src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3C/svg%3E" alt="${escapeHtml(photo.name)}">
                </div>
                <div class="photo-name">${escapeHtml(shortName)}</div>
            `;
            
            photosContainer.appendChild(card);
        }
        
        section.appendChild(photosContainer);
        fragment.appendChild(section);
    }
    
    gallery.innerHTML = '';
    gallery.appendChild(fragment);
    lazyLoadImages();
    
    photoCountSpan.textContent = `📷 ${photos.length} photo${photos.length > 1 ? 's' : ''}`;
    attachCardEventsOptimized();
}

function groupPhotosByDate(photosArray) {
    const groups = {};
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - 7);
    const monthStart = new Date(today);
    monthStart.setMonth(monthStart.getMonth() - 1);
    
    for (let i = 0; i < photosArray.length; i++) {
        const photo = photosArray[i];
        const photoDate = new Date(photo.created_at);
        let label = '';
        
        if (photoDate >= today) label = "Aujourd'hui";
        else if (photoDate >= yesterday) label = "Hier";
        else if (photoDate >= weekStart) label = "Cette semaine";
        else if (photoDate >= monthStart) label = "Ce mois";
        else label = "Plus ancien";
        
        if (!groups[label]) groups[label] = [];
        groups[label].push(photo);
    }
    
    return groups;
}

// ===== VERSION OPTIMISÉE AVEC DIFFÉRENCIATION SCROLL/CLIC =====
function attachCardEventsOptimized() {
    const cards = document.querySelectorAll('.photo-card');
    
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const id = card.dataset.id;
        const checkbox = card.querySelector('.photo-check');
        
        let touchTimer = null;
        let hasMoved = false;
        let startX, startY;
        
        if (checkbox) {
            checkbox.addEventListener('change', (e) => {
                e.stopPropagation();
                if (checkbox.checked) {
                    selectedPhotos.add(id);
                } else {
                    selectedPhotos.delete(id);
                }
                card.classList.toggle('selected', checkbox.checked);
                updateActionBar();
            });
        }
        
        // TOUCH START
        card.addEventListener('touchstart', (e) => {
            if (e.touches.length === 1) {
                startX = e.touches[0].clientX;
                startY = e.touches[0].clientY;
                hasMoved = false;
                touchTimer = setTimeout(() => {
                    if (!hasMoved) {
                        // APPUI LONG
                        selectedPhotos.add(id);
                        updateActionBar();
                        card.classList.add('selected');
                        if (checkbox) checkbox.checked = true;
                        if (navigator.vibrate) navigator.vibrate(30);
                    }
                }, 600);
            }
        });
        
        // TOUCH MOVE (détection scroll)
        card.addEventListener('touchmove', (e) => {
            if (startX && startY && e.touches.length === 1) {
                const deltaX = Math.abs(e.touches[0].clientX - startX);
                const deltaY = Math.abs(e.touches[0].clientY - startY);
                if (deltaX > 10 || deltaY > 10) {
                    hasMoved = true;
                    clearTimeout(touchTimer);
                }
            }
        });
        
        // TOUCH END
        card.addEventListener('touchend', () => {
            clearTimeout(touchTimer);
            if (!hasMoved && touchTimer) {
                // APPUI COURT (clic)
                if (multiSelectMode) {
                    if (selectedPhotos.has(id)) {
                        selectedPhotos.delete(id);
                        if (checkbox) checkbox.checked = false;
                        card.classList.remove('selected');
                    } else {
                        selectedPhotos.add(id);
                        if (checkbox) checkbox.checked = true;
                        card.classList.add('selected');
                    }
                    updateActionBar();
                } else {
                    const photo = photos.find(p => p.id === id);
                    if (photo) openViewer(photo.url);
                }
            }
            hasMoved = false;
            startX = null;
            startY = null;
            touchTimer = null;
        });
        
        card.addEventListener('touchcancel', () => {
            clearTimeout(touchTimer);
            hasMoved = false;
            touchTimer = null;
        });
        
        // MOUSE SUPPORT (pour debug)
        let mouseLongPress = null;
        let mouseMoved = false;
        
        card.addEventListener('mousedown', (e) => {
            if (e.button !== 0) return;
            mouseMoved = false;
            mouseLongPress = setTimeout(() => {
                if (!mouseMoved) {
                    selectedPhotos.add(id);
                    updateActionBar();
                    card.classList.add('selected');
                    if (checkbox) checkbox.checked = true;
                }
            }, 600);
        });
        
        card.addEventListener('mousemove', () => {
            mouseMoved = true;
            clearTimeout(mouseLongPress);
        });
        
        card.addEventListener('mouseup', () => {
            clearTimeout(mouseLongPress);
            if (!mouseMoved && mouseLongPress) {
                if (multiSelectMode) {
                    if (selectedPhotos.has(id)) {
                        selectedPhotos.delete(id);
                        if (checkbox) checkbox.checked = false;
                        card.classList.remove('selected');
                    } else {
                        selectedPhotos.add(id);
                        if (checkbox) checkbox.checked = true;
                        card.classList.add('selected');
                    }
                    updateActionBar();
                } else {
                    const photo = photos.find(p => p.id === id);
                    if (photo) openViewer(photo.url);
                }
            }
            mouseMoved = false;
        });
    }
}

// ===== BARRE D'ACTION =====
function updateActionBar() {
    multiSelectMode = selectedPhotos.size > 0;
    
    if (multiSelectMode) {
        searchBar.style.display = 'none';
        actionBar.classList.add('active');
    } else {
        searchBar.style.display = 'flex';
        actionBar.classList.remove('active');
    }
    
    const cards = document.querySelectorAll('.photo-card');
    for (let i = 0; i < cards.length; i++) {
        const card = cards[i];
        const id = card.dataset.id;
        const isSelected = selectedPhotos.has(id);
        card.classList.toggle('selected', isSelected);
        card.classList.toggle('multi-select-mode', multiSelectMode);
        const cb = card.querySelector('.photo-check');
        if (cb) cb.checked = isSelected;
    }
}

// ===== RECHERCHE =====
function initSearch() {
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            searchQuery = e.target.value;
            loadPhotos(true);
        }, 300);
    });
}

// ===== VIEWER =====
const viewerOverlay = document.getElementById('viewerOverlay');
const viewerImg = document.getElementById('viewerImg');
const viewerContainer = document.getElementById('viewerContainer');
let currentScale = 1;
let currentTranslate = { x: 0, y: 0 };
let initialDistance = 0;
let initialScale = 1;
let isZooming = false;

function openViewer(url) {
    viewerImg.src = url;
    viewerOverlay.classList.add('active');
    resetZoom();
    document.body.style.overflow = 'hidden';
}

function closeViewer() {
    viewerOverlay.classList.remove('active');
    resetZoom();
    document.body.style.overflow = '';
    setTimeout(() => { viewerImg.src = ''; }, 250);
}

function resetZoom() {
    currentScale = 1;
    currentTranslate = { x: 0, y: 0 };
    viewerImg.style.transform = `translate(0px, 0px) scale(1)`;
}

viewerContainer.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
        e.preventDefault();
        initialDistance = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
        );
        initialScale = currentScale;
        isZooming = true;
    }
});

viewerContainer.addEventListener('touchmove', (e) => {
    if (isZooming && e.touches.length === 2) {
        e.preventDefault();
        const newDistance = Math.hypot(
            e.touches[0].pageX - e.touches[1].pageX,
            e.touches[0].pageY - e.touches[1].pageY
        );
        let scale = initialScale * (newDistance / initialDistance);
        scale = Math.min(Math.max(scale, 1), 4);
        currentScale = scale;
        viewerImg.style.transform = `translate(${currentTranslate.x}px, ${currentTranslate.y}px) scale(${currentScale})`;
    }
});

viewerContainer.addEventListener('touchend', () => {
    isZooming = false;
});

viewerImg.addEventListener('dblclick', (e) => {
    e.stopPropagation();
    if (currentScale > 1) {
        resetZoom();
    } else {
        currentScale = 2.5;
        viewerImg.style.transform = `translate(0px, 0px) scale(2.5)`;
    }
});

// ===== CRÉATION DOSSIER =====
async function createFolder(name) {
    if (!name || !name.trim()) {
        notifyHeader(false);
        return false;
    }
    
    const { data, error } = await sb
        .from('folders')
        .insert({ name: name.trim(), user_id: currentUser.id })
        .select()
        .single();
    
    if (error) {
        notifyHeader(false);
        return false;
    }
    
    notifyHeader(true);
    await loadFolders();
    return true;
}

// ===== SUPPRESSION DOSSIER =====
async function deleteFolder(folderId, folderName) {
    await sb.from('photos').update({ folder_id: null }).eq('folder_id', folderId);
    
    const { error } = await sb.from('folders').delete().eq('id', folderId);
    
    if (error) {
        notifyHeader(false);
        return false;
    }
    
    if (currentFolderId === folderId) {
        selectFolder(null);
    }
    
    notifyHeader(true);
    await loadFolders();
    await loadPhotos(true);
    return true;
}

// ===== RENOMMER DOSSIER =====
async function renameFolder(folderId, newName) {
    if (!newName || !newName.trim()) return false;
    
    const { error } = await sb
        .from('folders')
        .update({ name: newName.trim() })
        .eq('id', folderId);
    
    if (error) {
        notifyHeader(false);
        return false;
    }
    
    notifyHeader(true);
    await loadFolders();
    return true;
}

// ===== TÉLÉCHARGER DOSSIER =====
async function downloadFolder(folderId, folderName) {
    const { data, error } = await sb
        .from('photos')
        .select('*')
        .eq('folder_id', folderId);
    
    if (error || !data || data.length === 0) {
        notifyHeader(false);
        return;
    }
    
    const zip = new JSZip();
    for (const photo of data) {
        const response = await fetch(photo.url);
        const blob = await response.blob();
        zip.file(photo.name, blob);
    }
    
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${folderName}.zip`);
    notifyHeader(true);
}

// ===== MODAL ACTIONS DOSSIER =====
function openFolderActionsModal(folder) {
    const modalOverlay = document.getElementById('folderActionsOverlay');
    const modal = document.getElementById('folderActionsModal');
    
    const renameBtn = document.getElementById('folderRenameBtn');
    const deleteBtn = document.getElementById('folderDeleteBtn');
    const downloadBtn = document.getElementById('folderDownloadBtn');
    const cancelBtn = document.getElementById('folderCancelBtn');
    
    const newRenameBtn = renameBtn.cloneNode(true);
    const newDeleteBtn = deleteBtn.cloneNode(true);
    const newDownloadBtn = downloadBtn.cloneNode(true);
    const newCancelBtn = cancelBtn.cloneNode(true);
    
    renameBtn.parentNode.replaceChild(newRenameBtn, renameBtn);
    deleteBtn.parentNode.replaceChild(newDeleteBtn, deleteBtn);
    downloadBtn.parentNode.replaceChild(newDownloadBtn, downloadBtn);
    cancelBtn.parentNode.replaceChild(newCancelBtn, cancelBtn);
    
    newRenameBtn.onclick = () => {
        const newName = prompt('Nouveau nom du dossier:', folder.name);
        if (newName) renameFolder(folder.id, newName);
        closeModal('folderActionsOverlay', 'folderActionsModal');
    };
    
    newDeleteBtn.onclick = () => {
        if (confirm(`Supprimer le dossier "${folder.name}" ? Les photos seront déplacées vers "Sans dossier".`)) {
            deleteFolder(folder.id, folder.name);
        }
        closeModal('folderActionsOverlay', 'folderActionsModal');
    };
    
    newDownloadBtn.onclick = () => {
        downloadFolder(folder.id, folder.name);
        closeModal('folderActionsOverlay', 'folderActionsModal');
    };
    
    newCancelBtn.onclick = () => {
        closeModal('folderActionsOverlay', 'folderActionsModal');
    };
    
    openModal('folderActionsOverlay', 'folderActionsModal');
}

// ===== UPLOAD PHOTOS =====
async function uploadPhotos(files) {
    if (!currentUser) {
        notifyHeader(false);
        return;
    }
    if (!files || files.length === 0) return;
    
    const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
    if (imageFiles.length === 0) {
        notifyHeader(false);
        return;
    }
    
    uploadQueue = [];
    uploadCancelled = false;
    uploadInProgress = true;
    
    for (const file of imageFiles) {
        const preview = await readFileAsDataURL(file);
        uploadQueue.push({ file, name: file.name, preview, done: false });
    }
    
    openUploadModal();
    renderUploadList();
    updateProgress(0, uploadQueue.length);
    
    let uploaded = 0;
    const toUpload = [...uploadQueue];
    const newPhotos = [];
    
    for (const item of toUpload) {
        if (uploadCancelled) break;
        
        try {
            const ext = item.file.name.split('.').pop() || 'jpg';
            const fileName = `${Date.now()}_${Math.random().toString(36).substring(2, 8)}.${ext}`;
            const filePath = `${currentUser.id}/${fileName}`;
            
            const { error: uploadError } = await sb.storage.from('photos').upload(filePath, item.file);
            if (uploadError) throw new Error(uploadError.message);
            
            const { data: urlData } = sb.storage.from('photos').getPublicUrl(filePath);
            
            const newPhoto = {
                name: item.name,
                url: urlData.publicUrl,
                user_id: currentUser.id,
                storage_path: filePath,
                folder_id: currentFolderId,
                created_at: new Date().toISOString()
            };
            
            const { data: inserted, error: dbError } = await sb.from('photos').insert(newPhoto).select().single();
            if (dbError) throw new Error(dbError.message);
            
            newPhotos.push(inserted);
            
            item.done = true;
            uploaded++;
            updateProgress(uploaded, toUpload.length);
            renderUploadList();
            
        } catch (err) {
            console.error('Upload error:', err);
        }
    }
    
    uploadInProgress = false;
    
    if (!uploadCancelled && uploaded > 0) {
        photos = [...newPhotos, ...photos];
        savePhotosToLocalStorage();
        await loadPhotos(true);
        notifyHeader(true);
    } else if (uploaded === 0) {
        notifyHeader(false);
    }
    
    setTimeout(() => closeUploadModal(), 800);
}

// ===== DÉPLACER/COPIER PHOTOS =====
async function movePhotosToFolder(photoIds, targetFolderId, isCopy = false) {
    const ids = Array.from(photoIds);
    const progressOverlay = document.getElementById('progressOverlay');
    const progressModal = document.getElementById('progressModal');
    const progressTitle = document.getElementById('progressTitle');
    const progressMessage = document.getElementById('progressMessage');
    const progressCount = document.getElementById('actionProgressCount');
    const progressPercent = document.getElementById('actionProgressPercent');
    const progressFill = document.getElementById('actionProgressFill');
    
    progressTitle.innerHTML = isCopy ? '<i class="fas fa-copy"></i> Copie en cours' : '<i class="fas fa-arrows-alt"></i> Déplacement en cours';
    progressMessage.textContent = `${isCopy ? 'Copie' : 'Déplacement'} de ${ids.length} photo${ids.length > 1 ? 's' : ''}...`;
    progressOverlay.classList.add('active');
    progressModal.classList.add('active');
    
    let processed = 0;
    
    for (const photoId of ids) {
        const photo = photos.find(p => p.id === photoId);
        if (!photo) continue;
        
        if (isCopy) {
            const { error } = await sb.from('photos').insert({
                name: photo.name,
                url: photo.url,
                user_id: currentUser.id,
                storage_path: photo.storage_path,
                folder_id: targetFolderId
            });
            if (error) console.error('Copy error:', error);
        } else {
            const { error } = await sb.from('photos').update({ folder_id: targetFolderId }).eq('id', photoId);
            if (error) console.error('Move error:', error);
        }
        
        processed++;
        const percent = Math.round((processed / ids.length) * 100);
        progressCount.textContent = `${processed}/${ids.length}`;
        progressPercent.textContent = `${percent}%`;
        progressFill.style.width = `${percent}%`;
    }
    
    setTimeout(() => {
        progressOverlay.classList.remove('active');
        progressModal.classList.remove('active');
    }, 500);
    
    await loadPhotos(true);
    selectedPhotos.clear();
    updateActionBar();
    notifyHeader(true);
}

// ===== SUPPRESSION PHOTOS =====
async function deletePhotos(photoIds) {
    const ids = Array.from(photoIds);
    const batch = photos.filter(p => ids.includes(p.id));
    
    const paths = batch.map(p => p.storage_path).filter(Boolean);
    if (paths.length) {
        await sb.storage.from('photos').remove(paths);
    }
    
    const { error } = await sb.from('photos').delete().in('id', ids);
    if (error) {
        notifyHeader(false);
        return;
    }
    
    photos = photos.filter(p => !ids.includes(p.id));
    savePhotosToLocalStorage();
    
    notifyHeader(true);
    selectedPhotos.clear();
    updateActionBar();
    await loadPhotos(true);
}

// ===== RENOMMER PHOTO =====
async function renamePhoto(photoId, newName) {
    const { error } = await sb.from('photos').update({ name: newName }).eq('id', photoId);
    if (error) {
        notifyHeader(false);
        return;
    }
    
    const photo = photos.find(p => p.id === photoId);
    if (photo) photo.name = newName;
    savePhotosToLocalStorage();
    
    notifyHeader(true);
    await loadPhotos(true);
}

// ===== TÉLÉCHARGER PHOTOS =====
async function downloadPhotos(photoIds) {
    const ids = Array.from(photoIds);
    const batch = photos.filter(p => ids.includes(p.id));
    
    if (batch.length === 1) {
        const link = document.createElement('a');
        link.href = batch[0].url;
        link.download = batch[0].name;
        link.click();
        notifyHeader(true);
    } else {
        const zip = new JSZip();
        for (const photo of batch) {
            const response = await fetch(photo.url);
            const blob = await response.blob();
            zip.file(photo.name, blob);
        }
        const content = await zip.generateAsync({ type: 'blob' });
        saveAs(content, `photos_${Date.now()}.zip`);
        notifyHeader(true);
    }
}

// ===== MODAL INFO PHOTO =====
async function showPhotoInfo(photoId) {
    const photo = photos.find(p => p.id === photoId);
    if (!photo) return;
    
    document.getElementById('infoName').textContent = photo.name;
    document.getElementById('infoDate').textContent = new Date(photo.created_at).toLocaleDateString('fr-FR');
    
    try {
        const response = await fetch(photo.url);
        const blob = await response.blob();
        const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
        document.getElementById('infoSize').textContent = `${sizeMB} MB`;
    } catch (e) {
        document.getElementById('infoSize').textContent = 'Inconnue';
    }
    
    const preview = document.getElementById('infoPreview');
    preview.innerHTML = `<img src="${photo.url}" alt="${photo.name}">`;
    
    openModal('infoModalOverlay', 'infoModal');
}

// ===== MODAL SÉLECTION DOSSIER =====
function openSelectFolderModal(callback, isCopy) {
    const modalOverlay = document.getElementById('selectFolderOverlay');
    const modal = document.getElementById('selectFolderModal');
    const folderList = document.getElementById('folderList');
    
    folderList.innerHTML = `
        <div class="folder-list-item" data-folder-id="">
            <i class="fas fa-folder-open"></i>
            <span>Sans dossier</span>
        </div>
        ${folders.map(folder => `
            <div class="folder-list-item" data-folder-id="${folder.id}">
                <i class="fas fa-folder"></i>
                <span>${escapeHtml(folder.name)}</span>
            </div>
        `).join('')}
    `;
    
    modalOverlay.classList.add('active');
    modal.classList.add('active');
    
    const handler = (e) => {
        const card = e.target.closest('.folder-list-item');
        if (card) {
            const folderId = card.dataset.folderId === '' ? null : card.dataset.folderId;
            modalOverlay.classList.remove('active');
            modal.classList.remove('active');
            callback(folderId);
        }
    };
    
    folderList.querySelectorAll('.folder-list-item').forEach(item => {
        item.addEventListener('click', handler);
    });
    
    document.getElementById('closeSelectFolder').onclick = () => {
        modalOverlay.classList.remove('active');
        modal.classList.remove('active');
    };
    document.getElementById('cancelSelectFolderBtn').onclick = () => {
        modalOverlay.classList.remove('active');
        modal.classList.remove('active');
    };
}

// ===== MODAUX HELPERS =====
function openModal(overlayId, modalId) {
    document.getElementById(overlayId).classList.add('active');
    document.getElementById(modalId).classList.add('active');
}

function closeModal(overlayId, modalId) {
    document.getElementById(overlayId).classList.remove('active');
    document.getElementById(modalId).classList.remove('active');
}

// ===== MODAL UPLOAD =====
const uploadModalOverlay = document.getElementById('uploadModalOverlay');
const uploadModal = document.getElementById('uploadModal');
const uploadList = document.getElementById('uploadList');
const closeUploadModalBtn = document.getElementById('closeUploadModal');
const cancelUploadBtn = document.getElementById('cancelUploadBtn');
const progressCountSpan = document.getElementById('progressCount');
const progressPercentSpan = document.getElementById('progressPercent');
const progressFillDiv = document.getElementById('progressFill');

function openUploadModal() {
    uploadModalOverlay.classList.add('active');
    uploadModal.classList.add('active');
}

function closeUploadModal() {
    uploadModalOverlay.classList.remove('active');
    uploadModal.classList.remove('active');
    uploadList.innerHTML = '';
}

function renderUploadList() {
    const pending = uploadQueue.filter(i => !i.done);
    if (pending.length === 0) {
        uploadList.innerHTML = `<div style="text-align:center;padding:20px;"><i class="fas fa-check-circle" style="font-size:24px;color:#22c55e;"></i><p>Tous les fichiers sont envoyés</p></div>`;
        return;
    }
    uploadList.innerHTML = pending.map((item, idx) => `
        <div class="upload-item">
            <img class="upload-item-preview" src="${item.preview}">
            <span class="upload-item-name">${item.name.length > 28 ? item.name.substring(0,25)+'…' : item.name}</span>
            <button class="remove-item" onclick="window.removeFromQueue(${uploadQueue.indexOf(item)})"><i class="fas fa-times"></i></button>
        </div>
    `).join('');
}

window.removeFromQueue = (index) => {
    if (uploadQueue[index] && !uploadQueue[index].done) {
        uploadQueue.splice(index, 1);
        renderUploadList();
    }
};

function updateProgress(uploaded, total) {
    const pct = total === 0 ? 0 : Math.round((uploaded / total) * 100);
    progressCountSpan.textContent = `${uploaded}/${total}`;
    progressPercentSpan.textContent = `${pct}%`;
    progressFillDiv.style.width = `${pct}%`;
}

function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

// ===== MODE NUIT =====
function initTheme() {
    const savedTheme = localStorage.getItem('megane_theme');
    if (savedTheme === 'dark') {
        isDarkMode = true;
        document.body.classList.add('dark');
    }
}

function toggleTheme() {
    isDarkMode = !isDarkMode;
    if (isDarkMode) {
        document.body.classList.add('dark');
        localStorage.setItem('megane_theme', 'dark');
    } else {
        document.body.classList.remove('dark');
        localStorage.setItem('megane_theme', 'light');
    }
    notifyHeader(true);
}

// ===== DÉCONNEXION =====
async function logout() {
    localStorage.removeItem(`${STORAGE_KEY}_${currentUser.id}`);
    localStorage.removeItem(`${FOLDERS_KEY}_${currentUser.id}`);
    await sb.auth.signOut();
    window.location.href = 'login.html';
}

// ===== SIDEBAR =====
const sidebarOverlay = document.getElementById('sidebarOverlay');
const sidebar = document.getElementById('sidebar');

function openSidebar() {
    sidebarOverlay.classList.add('active');
    sidebar.classList.add('active');
}

function closeSidebar() {
    sidebarOverlay.classList.remove('active');
    sidebar.classList.remove('active');
}

// ===== ESCAPE HTML =====
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

// ===== INITIALISATION =====
async function init() {
    const session = await checkSession();
    if (!session) return;
    
    initTheme();
    initSearch();
    await loadFolders();
    await loadPhotos(true);
    
    // Header events
    document.getElementById('hamburgerBtn')?.addEventListener('click', openSidebar);
    document.getElementById('siteName')?.addEventListener('click', () => loadPhotos(true));
    document.getElementById('logoBtn')?.addEventListener('click', () => location.reload());
    
    // Slider
    sizeSlider.addEventListener('input', () => renderGallery());
    
    // Sidebar
    document.getElementById('closeSidebarBtn')?.addEventListener('click', closeSidebar);
    sidebarOverlay.addEventListener('click', closeSidebar);
    
    document.getElementById('profileBtn')?.addEventListener('click', () => {
        closeSidebar();
        openModal('profilModalOverlay', 'profilModal');
    });
    
    document.getElementById('themeBtn')?.addEventListener('click', () => {
        closeSidebar();
        toggleTheme();
    });
    
    document.getElementById('infoBtn')?.addEventListener('click', () => {
        closeSidebar();
        window.location.href = 'info.html';
    });
    
    // Profil modal
    document.getElementById('closeProfilModal')?.addEventListener('click', () => {
        closeModal('profilModalOverlay', 'profilModal');
    });
    document.getElementById('profilModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('profilModalOverlay'))
            closeModal('profilModalOverlay', 'profilModal');
    });
    
    let passwordVisible = false;
    document.getElementById('togglePasswordBtn')?.addEventListener('click', () => {
        passwordVisible = !passwordVisible;
        document.getElementById('profilePassword').type = passwordVisible ? 'text' : 'password';
        document.getElementById('togglePasswordBtn').innerHTML = `<i class="fas fa-eye${passwordVisible ? '-slash' : ''}"></i>`;
    });
    
    document.getElementById('logoutBtn')?.addEventListener('click', () => {
        closeModal('profilModalOverlay', 'profilModal');
        openModal('confirmLogoutOverlay', 'confirmLogoutModal');
    });
    
    document.getElementById('closeConfirmLogout')?.addEventListener('click', () => {
        closeModal('confirmLogoutOverlay', 'confirmLogoutModal');
    });
    document.getElementById('cancelLogoutBtn')?.addEventListener('click', () => {
        closeModal('confirmLogoutOverlay', 'confirmLogoutModal');
    });
    document.getElementById('confirmLogoutBtn')?.addEventListener('click', logout);
    
    // Action bar
    document.getElementById('renameActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size !== 1) return;
        const photo = photos.find(p => p.id === Array.from(selectedPhotos)[0]);
        if (photo) {
            const baseName = photo.name.includes('.') ? photo.name.substring(0, photo.name.lastIndexOf('.')) : photo.name;
            document.getElementById('renameInput').value = baseName;
        }
        openModal('renameModalOverlay', 'renameModal');
        setTimeout(() => document.getElementById('renameInput')?.focus(), 350);
    });
    
    document.getElementById('deleteActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size === 0) return;
        document.getElementById('deleteCount').textContent = selectedPhotos.size;
        openModal('deleteModalOverlay', 'deleteModal');
    });
    
    document.getElementById('downloadActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size === 0) return;
        downloadPhotos(selectedPhotos);
    });
    
    document.getElementById('infoActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size !== 1) return;
        const photoId = Array.from(selectedPhotos)[0];
        showPhotoInfo(photoId);
    });
    
    document.getElementById('moveActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size === 0) return;
        openSelectFolderModal(async (folderId) => {
            await movePhotosToFolder(selectedPhotos, folderId, false);
        }, false);
    });
    
    document.getElementById('copyActionBtn')?.addEventListener('click', () => {
        if (selectedPhotos.size === 0) return;
        openSelectFolderModal(async (folderId) => {
            await movePhotosToFolder(selectedPhotos, folderId, true);
        }, true);
    });
    
    document.getElementById('closeActionBtn')?.addEventListener('click', () => {
        selectedPhotos.clear();
        updateActionBar();
    });
    
    // Rename modal
    document.getElementById('closeRenameModal')?.addEventListener('click', () => {
        closeModal('renameModalOverlay', 'renameModal');
    });
    document.getElementById('cancelRenameBtn')?.addEventListener('click', () => {
        closeModal('renameModalOverlay', 'renameModal');
    });
    document.getElementById('confirmRenameBtn')?.addEventListener('click', async () => {
        const newName = document.getElementById('renameInput').value.trim();
        if (!newName) return;
        const photoId = Array.from(selectedPhotos)[0];
        const photo = photos.find(p => p.id === photoId);
        if (!photo) return;
        const ext = photo.name.includes('.') ? '.' + photo.name.split('.').pop() : '';
        closeModal('renameModalOverlay', 'renameModal');
        await renamePhoto(photoId, newName + ext);
        selectedPhotos.clear();
        updateActionBar();
    });
    
    // Delete modal
    document.getElementById('closeDeleteModal')?.addEventListener('click', () => {
        closeModal('deleteModalOverlay', 'deleteModal');
    });
    document.getElementById('cancelDeleteBtn')?.addEventListener('click', () => {
        closeModal('deleteModalOverlay', 'deleteModal');
    });
    document.getElementById('confirmDeleteBtn')?.addEventListener('click', async () => {
        closeModal('deleteModalOverlay', 'deleteModal');
        await deletePhotos(selectedPhotos);
    });
    
    // Create folder
    document.getElementById('createFolderBtn')?.addEventListener('click', () => {
        openModal('createFolderOverlay', 'createFolderModal');
        setTimeout(() => document.getElementById('folderNameInput')?.focus(), 350);
    });
    document.getElementById('closeCreateFolder')?.addEventListener('click', () => {
        closeModal('createFolderOverlay', 'createFolderModal');
    });
    document.getElementById('cancelFolderBtn')?.addEventListener('click', () => {
        closeModal('createFolderOverlay', 'createFolderModal');
    });
    document.getElementById('confirmFolderBtn')?.addEventListener('click', async () => {
        const name = document.getElementById('folderNameInput').value.trim();
        if (name) {
            await createFolder(name);
            document.getElementById('folderNameInput').value = '';
            closeModal('createFolderOverlay', 'createFolderModal');
        }
    });
    
    // Info modal
    document.getElementById('closeInfoModal')?.addEventListener('click', () => {
        closeModal('infoModalOverlay', 'infoModal');
    });
    document.getElementById('infoModalOverlay')?.addEventListener('click', (e) => {
        if (e.target === document.getElementById('infoModalOverlay'))
            closeModal('infoModalOverlay', 'infoModal');
    });
    
    // Progress modal close
    document.getElementById('closeProgressModal')?.addEventListener('click', () => {
        document.getElementById('progressOverlay').classList.remove('active');
        document.getElementById('progressModal').classList.remove('active');
    });
    
    // Upload
    document.getElementById('uploadBtn')?.addEventListener('click', () => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.onchange = (e) => {
            if (e.target.files.length) uploadPhotos(e.target.files);
        };
        input.click();
    });
    
    closeUploadModalBtn?.addEventListener('click', () => {
        uploadCancelled = true;
        closeUploadModal();
    });
    cancelUploadBtn?.addEventListener('click', () => {
        uploadCancelled = true;
        closeUploadModal();
    });
    
    // Viewer close
    document.getElementById('viewerClose')?.addEventListener('click', closeViewer);
    viewerOverlay?.addEventListener('click', (e) => {
        if (e.target === viewerOverlay) closeViewer();
    });
    
    // Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (viewerOverlay?.classList.contains('active')) closeViewer();
            else if (sidebar?.classList.contains('active')) closeSidebar();
        }
    });
}

// ===== SERVICE WORKER =====
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then((registration) => {
                console.log('[SW] Enregistré:', registration.scope);
            })
            .catch((error) => {
                console.error('[SW] Erreur:', error);
            });
    });
}

// Démarrer
init();
