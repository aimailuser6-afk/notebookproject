let authToken = localStorage.getItem('nb_auth_token') || '';
let currentStreams = [];
let currentSubjectId = null;
let currentHlsInstance = null;
let searchDebounceTimer = null;

// Authenticated Fetch Helper
async function apiFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (authToken) {
    options.headers['x-auth-token'] = authToken;
  }
  const res = await fetch(url, options);
  if (res.status === 401) {
    lockWorkspace("Session expired or unauthorized. Please re-enter password.");
    throw new Error("Unauthorized");
  }
  return res;
}

// Show & Hide Vault Authentication Screen
function showAuthOverlay(msg = "") {
  const overlay = document.getElementById('authOverlay');
  const errBox = document.getElementById('authError');
  const pwdInput = document.getElementById('authPassword');
  overlay.classList.add('active');
  if (msg) {
    errBox.innerText = msg;
    errBox.classList.add('visible');
  } else {
    errBox.innerText = '';
    errBox.classList.remove('visible');
  }
  pwdInput.value = '';
  setTimeout(() => pwdInput.focus(), 100);
}

function hideAuthOverlay() {
  const overlay = document.getElementById('authOverlay');
  overlay.classList.remove('active');
  const errBox = document.getElementById('authError');
  errBox.innerText = '';
  errBox.classList.remove('visible');
}

// Lock Workspace
function lockWorkspace(reason = "") {
  authToken = '';
  localStorage.removeItem('nb_auth_token');
  closeModal();
  showAuthOverlay(reason);
}

// Verify Password with Backend
async function handleLogin() {
  const pwdInput = document.getElementById('authPassword');
  const errBox = document.getElementById('authError');
  const unlockBtn = document.getElementById('unlockBtn');
  const password = pwdInput.value.trim();

  if (!password) {
    errBox.innerText = "Please enter NoteBook password.";
    errBox.classList.add('visible');
    pwdInput.focus();
    return;
  }

  unlockBtn.disabled = true;
  unlockBtn.innerText = "Verifying...";
  errBox.innerText = '';
  errBox.classList.remove('visible');

  try {
    const res = await fetch('/api/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password })
    });
    const data = await res.json();

    if (res.ok && data.success && data.token) {
      authToken = data.token;
      localStorage.setItem('nb_auth_token', authToken);
      hideAuthOverlay();
      loadHomeFeed();
    } else {
      errBox.innerText = data.error || "Incorrect NoteBook password.";
      errBox.classList.add('visible');
      pwdInput.select();
    }
  } catch (err) {
    errBox.innerText = "Failed to connect to authentication server.";
    errBox.classList.add('visible');
  } finally {
    unlockBtn.disabled = false;
    unlockBtn.innerText = "Unlock Workspace";
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  // Login Form Submission
  const loginForm = document.getElementById('loginForm');
  if (loginForm) {
    loginForm.addEventListener('submit', (e) => {
      e.preventDefault();
      handleLogin();
    });
  }

  // Lock Workspace Button
  const lockBtn = document.getElementById('lockWorkspaceBtn');
  if (lockBtn) {
    lockBtn.addEventListener('click', () => {
      lockWorkspace();
    });
  }

  setupSearch();

  // Modal Close Events
  document.getElementById('closeModal').addEventListener('click', closeModal);
  document.getElementById('playerModal').addEventListener('click', (e) => {
    if (e.target.id === 'playerModal') closeModal();
  });

  // Quality switch handler
  document.getElementById('qualitySelect').addEventListener('change', (e) => {
    const selectedUrl = e.target.value;
    if (selectedUrl) playVideoSource(selectedUrl);
  });

  // Esc key closes modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal();
  });

  // Verify existing token on initial load
  if (authToken) {
    try {
      const res = await fetch('/api/auth-check', {
        headers: { 'x-auth-token': authToken }
      });
      if (res.ok) {
        hideAuthOverlay();
        loadHomeFeed();
        return;
      }
    } catch (e) {}
  }

  // If no valid auth session, prompt login
  lockWorkspace();
});

// 1. Fetch & Render Home Catalog
async function loadHomeFeed() {
  const container = document.getElementById('contentContainer');
  const hero = document.getElementById('heroBanner');
  if (hero) hero.style.display = 'flex';
  container.innerHTML = '<div class="loading-spinner" id="spinner" style="display:block;"></div>';
  const spinner = document.getElementById('spinner');

  try {
    const res = await apiFetch('/api/home');
    const data = await res.json();
    if (spinner) spinner.style.display = 'none';

    if (!data.data || !data.data.items) {
      container.innerHTML = '<p style="text-align:center; padding: 40px; color:#a0a0b2;">Unable to load catalog.</p>';
      return;
    }

    const items = data.data.items;

    // Set Hero Banner using first category with movies
    const heroCategory = items.find(i => i.subjects && i.subjects.length > 0);
    if (heroCategory && heroCategory.subjects[0]) {
      setupHero(heroCategory.subjects[0]);
    }

    // Render Each Category Row
    items.forEach((category, idx) => {
      if (!category.subjects || category.subjects.length === 0) return;

      const row = document.createElement('div');
      row.className = 'category-row';
      row.id = idx === 1 ? 'trending' : (idx === 2 ? 'cinema' : `cat-${idx}`);
      row.innerHTML = `
        <h2 class="row-title">${category.title || 'Featured'}</h2>
        <div class="cards-grid"></div>
      `;

      const grid = row.querySelector('.cards-grid');

      category.subjects.forEach(movie => {
        const posterUrl = movie.cover?.url || movie.image?.url || 'https://via.placeholder.com/300x450';
        const card = document.createElement('div');
        card.className = 'card';
        card.innerHTML = `
          <div class="card-img-wrap">
            <img src="${posterUrl}" loading="lazy" alt="${escapeHtml(movie.title)}">
          </div>
          <div class="card-info">
            <div class="card-title">${escapeHtml(movie.title)}</div>
            <div class="card-meta">
              <span>★ ${movie.score || '8.0'}</span>
              <span>${movie.releaseDate || 'HD'}</span>
            </div>
          </div>
        `;
        card.addEventListener('click', () => openMovie(movie.subjectId, movie.title, posterUrl));
        grid.appendChild(card);
      });

      container.appendChild(row);
    });

  } catch (err) {
    if (spinner) spinner.style.display = 'none';
    if (err.message !== "Unauthorized") {
      container.innerHTML = `<p style="color:#e50914; text-align:center; padding: 40px;">Error connecting to API: ${err.message}</p>`;
    }
  }
}

// 2. Setup Hero Banner
function setupHero(movie) {
  const hero = document.getElementById('heroBanner');
  const posterUrl = movie.cover?.url || movie.image?.url || '';
  if (posterUrl) {
    hero.style.backgroundImage = `url('${posterUrl}')`;
  }

  document.getElementById('heroTitle').innerText = movie.title || "Featured Title";
  document.getElementById('heroDesc').innerText = movie.description || "Stream high quality titles now on NoteBook.";

  document.getElementById('heroPlayBtn').onclick = () => {
    openMovie(movie.subjectId, movie.title, posterUrl);
  };
}

// 3. Search Suggestions & Full Search Execution
function setupSearch() {
  const input = document.getElementById('searchInput');
  const dropdown = document.getElementById('searchDropdown');
  const icon = document.querySelector('.search-icon');

  // Input typing autocomplete
  input.addEventListener('input', (e) => {
    const query = e.target.value.trim();
    clearTimeout(searchDebounceTimer);

    if (query.length < 2) {
      dropdown.classList.remove('active');
      dropdown.innerHTML = '';
      return;
    }

    searchDebounceTimer = setTimeout(async () => {
      try {
        const res = await apiFetch(`/api/search-suggest?q=${encodeURIComponent(query)}`);
        const data = await res.json();
        dropdown.innerHTML = '';

        if (data.data && data.data.items && data.data.items.length > 0) {
          data.data.items.slice(0, 7).forEach(item => {
            const div = document.createElement('div');
            div.className = 'search-item';
            div.innerHTML = `
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="11" cy="11" r="8"></circle>
                <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
              </svg>
              <span>${escapeHtml(item.word)}</span>
            `;
            div.onclick = () => {
              dropdown.classList.remove('active');
              input.value = item.word;
              executeSearch(item.word);
            };
            dropdown.appendChild(div);
          });
          dropdown.classList.add('active');
        } else {
          dropdown.classList.remove('active');
        }
      } catch (e) {}
    }, 250);
  });

  // Enter key initiates full search
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dropdown.classList.remove('active');
      const q = input.value.trim();
      if (q) executeSearch(q);
    }
  });

  // Click on search icon initiates search
  if (icon) {
    icon.addEventListener('click', () => {
      dropdown.classList.remove('active');
      const q = input.value.trim();
      if (q) executeSearch(q);
    });
  }

  // Hide dropdown on click outside
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search-box')) {
      dropdown.classList.remove('active');
    }
  });

  // Navbar Home & Logo link reset to home feed
  const navHome = document.getElementById('navHome');
  if (navHome) {
    navHome.addEventListener('click', (e) => {
      e.preventDefault();
      input.value = '';
      loadHomeFeed();
    });
  }
  const logo = document.querySelector('.logo');
  if (logo) {
    logo.addEventListener('click', () => {
      input.value = '';
      loadHomeFeed();
    });
  }
}

// Full Search Result Renderer
async function executeSearch(query) {
  const container = document.getElementById('contentContainer');
  const hero = document.getElementById('heroBanner');
  const dropdown = document.getElementById('searchDropdown');
  dropdown.classList.remove('active');

  // Hide hero banner when viewing search results
  if (hero) hero.style.display = 'none';

  container.innerHTML = `
    <div style="padding: 24px 0 20px; display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 14px;">
      <div>
        <h2 style="font-size: 1.6rem; font-weight: 700; color: #fff;">Library Search for <span style="color: #e50914;">"${escapeHtml(query)}"</span></h2>
      </div>
      <button class="btn btn-secondary" id="clearSearchBtn" style="padding: 8px 18px; font-size: 0.9rem; cursor: pointer; border-radius: 8px;">
        ← Back to Home
      </button>
    </div>
    <div class="cards-grid" id="searchResultsGrid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 20px;">
      <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; color: #a0a0b2;">
        <div class="loading-spinner" style="display: block; margin: 0 auto 16px;"></div>
        Searching titles and entries...
      </div>
    </div>
  `;

  document.getElementById('clearSearchBtn').onclick = () => {
    document.getElementById('searchInput').value = '';
    loadHomeFeed();
  };

  try {
    const res = await apiFetch(`/api/search?q=${encodeURIComponent(query)}`);
    const data = await res.json();
    const grid = document.getElementById('searchResultsGrid');
    grid.innerHTML = '';

    const movies = data.data?.items || [];
    if (movies.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 60px 20px; color: #a0a0b2;">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="margin-bottom: 16px; opacity: 0.6;">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <h3 style="color: #fff; margin-bottom: 8px; font-size: 1.2rem;">No entries found for "${escapeHtml(query)}"</h3>
          <p style="font-size: 0.95rem;">Try searching with titles like <i>Kantara, Baahubali, Rebel Moon, Avatar, Marvel</i></p>
        </div>
      `;
      return;
    }

    movies.forEach(movie => {
      const posterUrl = movie.cover?.url || movie.image?.url || 'https://via.placeholder.com/300x450';
      const card = document.createElement('div');
      card.className = 'card';
      const rating = movie.imdbRatingValue || movie.score || '8.0';
      const year = movie.releaseDate ? movie.releaseDate.split('-')[0] : 'HD';

      card.innerHTML = `
        <div class="card-img-wrap">
          <img src="${posterUrl}" loading="lazy" alt="${escapeHtml(movie.title)}">
        </div>
        <div class="card-info">
          <div class="card-title">${escapeHtml(movie.title)}</div>
          <div class="card-meta">
            <span>★ ${rating}</span>
            <span>${year}</span>
          </div>
        </div>
      `;
      card.addEventListener('click', () => openMovie(movie.subjectId, movie.title, posterUrl));
      grid.appendChild(card);
    });
  } catch (err) {
    const grid = document.getElementById('searchResultsGrid');
    if (grid && err.message !== "Unauthorized") {
      grid.innerHTML = `<p style="grid-column: 1 / -1; color: #e50914; text-align: center; padding: 40px;">Search failed: ${err.message}</p>`;
    }
  }
}

// 4. Open Movie Modal & Handle Seasons / Episodes
async function openMovie(subjectId, title, coverUrl) {
  currentSubjectId = subjectId;
  const modal = document.getElementById('playerModal');
  modal.classList.add('active');

  document.getElementById('modalTitle').innerText = title || "Loading...";
  document.getElementById('modalDesc').innerText = "Fetching details & stream links...";

  // Check if it has episodes/seasons
  try {
    const seasonRes = await apiFetch(`/api/season-info?id=${subjectId}`);
    const seasonData = await seasonRes.json();

    const epSection = document.getElementById('episodesSection');
    const epList = document.getElementById('episodeList');
    epList.innerHTML = '';

    if (seasonData.data && seasonData.data.seasons && seasonData.data.seasons.length > 0) {
      epSection.style.display = 'block';
      const season = seasonData.data.seasons[0];
      const maxEp = season.maxEp || 1;

      for (let i = 1; i <= Math.min(maxEp, 80); i++) {
        const btn = document.createElement('button');
        btn.className = `ep-btn ${i === 1 ? 'active' : ''}`;
        btn.innerText = `Ep ${i}`;
        btn.onclick = () => {
          document.querySelectorAll('.ep-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          loadStream(subjectId, season.se || 1, i);
        };
        epList.appendChild(btn);
      }

      // Load Episode 1
      loadStream(subjectId, season.se || 1, 1);
    } else {
      epSection.style.display = 'none';
      // Load standard single movie
      loadStream(subjectId, 0, 0);
    }
  } catch(e) {
    loadStream(subjectId, 0, 0);
  }

  // Fetch full description & score
  try {
    const detailRes = await apiFetch(`/api/detail?id=${subjectId}`);
    const detailData = await detailRes.json();
    if (detailData.data) {
      document.getElementById('modalDesc').innerText = detailData.data.description || "No overview available.";
      document.getElementById('modalRating').innerText = `★ ${detailData.data.score || '8.0'}`;
      if (detailData.data.title) {
        document.getElementById('modalTitle').innerText = detailData.data.title;
      }
    }
  } catch(e) {}
}

// 5. Load Stream URLs & Handle Multi-Quality
async function loadStream(subjectId, se, ep) {
  const select = document.getElementById('qualitySelect');
  select.innerHTML = '<option>Loading stream...</option>';

  try {
    const res = await apiFetch(`/api/play-info?id=${subjectId}&se=${se}&ep=${ep}`);
    const data = await res.json();

    if (data.data && data.data.streams && data.data.streams.length > 0) {
      currentStreams = data.data.streams;
      select.innerHTML = '';

      currentStreams.forEach((s) => {
        const opt = document.createElement('option');
        opt.value = s.url;
        
        let label = s.resolutions ? `${s.resolutions}P` : 'HD';
        if (s.size && s.size > 0) {
          const mb = s.size / (1024 * 1024);
          label += mb >= 1000 ? ` (${(mb / 1024).toFixed(1)} GB)` : ` (${mb.toFixed(0)} MB)`;
        }
        if (s.duration && s.duration > 0) {
          const hours = Math.floor(s.duration / 3600);
          const mins = Math.floor((s.duration % 3600) / 60);
          label += hours > 0 ? ` • ${hours}h ${mins}m` : ` • ${mins}m`;
        }

        opt.innerText = label;
        select.appendChild(opt);
      });

      // Play highest quality stream
      playVideoSource(currentStreams[0].url);
    } else {
      select.innerHTML = '<option>No stream available</option>';
    }
  } catch (err) {
    select.innerHTML = `<option>Error: ${err.message}</option>`;
  }
}

// 6. Video Playback via Native Video or HLS.js
function playVideoSource(url) {
  const video = document.getElementById('videoPlayer');

  if (currentHlsInstance) {
    currentHlsInstance.destroy();
    currentHlsInstance = null;
  }

  if (url.includes('.m3u8')) {
    if (Hls.isSupported()) {
      currentHlsInstance = new Hls({
        enableWorker: true,
        lowLatencyMode: true
      });
      currentHlsInstance.loadSource(url);
      currentHlsInstance.attachMedia(video);
      currentHlsInstance.on(Hls.Events.MANIFEST_PARSED, () => video.play());
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = url;
      video.play();
    }
  } else {
    // Standard MP4 stream
    video.src = url;
    video.play();
  }
}

// 7. Close Modal & Teardown Video
function closeModal() {
  const modal = document.getElementById('playerModal');
  const video = document.getElementById('videoPlayer');
  video.pause();
  video.src = '';
  if (currentHlsInstance) {
    currentHlsInstance.destroy();
    currentHlsInstance = null;
  }
  modal.classList.remove('active');
}

// Helper: Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>"']/g, (m) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  })[m]);
}
