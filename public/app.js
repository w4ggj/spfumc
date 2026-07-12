/* SPFUMC Signage Admin SPA */
(function () {
  'use strict';

  /* ── State ── */
  let currentUser = null;
  let allImages = []; // cached for group editor

  /* ── API helpers ── */
  async function api(method, path, body, isForm) {
    const opts = { method, credentials: 'include' };
    if (body && !isForm) {
      opts.headers = { 'Content-Type': 'application/json' };
      opts.body = JSON.stringify(body);
    } else if (isForm) {
      opts.body = body; // FormData
    }
    const res = await fetch('/api' + path, opts);
    const ct = res.headers.get('Content-Type') || '';
    const data = ct.includes('application/json') ? await res.json() : await res.text();
    if (!res.ok) throw new Error((data && data.error) || 'Request failed');
    return data;
  }

  /* ── Toast ── */
  function toast(msg, type = 'success') {
    let container = document.getElementById('toast-container');
    if (!container) {
      container = el('div', { id: 'toast-container' });
      document.body.appendChild(container);
    }
    const t = el('div', { className: `toast toast-${type}` });
    t.textContent = msg;
    container.appendChild(t);
    setTimeout(() => t.remove(), 3500);
  }

  /* ── DOM helpers ── */
  function el(tag, attrs = {}, ...children) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'className') e.className = v;
      else if (k in e) e[k] = v;
      else e.setAttribute(k, v);
    }
    for (const child of children) {
      if (child == null) continue;
      e.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    }
    return e;
  }

  function html(str) {
    const d = document.createElement('div');
    d.innerHTML = str;
    return d;
  }

  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function btn(label, cls, onClick) {
    const b = el('button', { className: `btn ${cls}` });
    b.innerHTML = label;
    b.addEventListener('click', onClick);
    return b;
  }

  function renderModal(titleText, contentNode, footer) {
    const overlay = el('div', { className: 'modal-overlay' });
    const modal = el('div', { className: 'modal' });
    const title = el('h3');
    title.textContent = titleText;
    modal.appendChild(title);
    modal.appendChild(contentNode);
    if (footer) modal.appendChild(footer);
    overlay.appendChild(modal);
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    document.body.appendChild(overlay);
    return { overlay, modal };
  }

  function formGroup(labelText, inputEl) {
    const g = el('div', { className: 'form-group' });
    const lbl = el('label');
    lbl.textContent = labelText;
    g.appendChild(lbl);
    g.appendChild(inputEl);
    return g;
  }

  function textInput(placeholder, value = '', type = 'text') {
    const i = el('input', { type, placeholder });
    i.value = value;
    return i;
  }

  function selectInput(options, current) {
    const s = el('select');
    for (const [val, label] of options) {
      const o = el('option');
      o.value = val;
      o.textContent = label;
      if (val === current) o.selected = true;
      s.appendChild(o);
    }
    return s;
  }

  /* ── Router ── */
  function navigate(hash) { location.hash = hash; }

  function getPage() {
    const h = location.hash.replace('#', '') || 'screens';
    return h.split('/')[0];
  }

  function getSubParam() {
    const parts = location.hash.replace('#', '').split('/');
    return parts[1] || null;
  }

  window.addEventListener('hashchange', render);

  /* ── Root render ── */
  function render() {
    const app = document.getElementById('app');
    if (!currentUser) {
      app.innerHTML = '';
      app.appendChild(renderLogin());
      return;
    }
    const page = getPage();
    app.innerHTML = '';
    app.appendChild(renderShell(page));
  }

  /* ── Login page ── */
  function renderLogin() {
    const wrapper = el('div', { id: 'login-page' });
    const card = el('div', { className: 'login-card' });
    const title = el('h1'); title.textContent = 'St. Pete First UMC';
    const sub = el('p'); sub.textContent = 'Signage admin — enter your credentials';
    const errDiv = el('div', { className: 'error', id: 'login-err' });
    const usernameInput = textInput('Username');
    const pinInput = textInput('PIN', '', 'password');
    const submitBtn = btn('Sign in', 'btn btn-primary btn-full', async () => {
      errDiv.textContent = '';
      submitBtn.disabled = true;
      try {
        const user = await api('POST', '/auth/login', {
          username: usernameInput.value.trim(),
          pin: pinInput.value,
        });
        currentUser = user;
        render();
      } catch (e) {
        errDiv.textContent = e.message;
      } finally {
        submitBtn.disabled = false;
      }
    });
    pinInput.addEventListener('keydown', e => { if (e.key === 'Enter') submitBtn.click(); });
    card.appendChild(title);
    card.appendChild(sub);
    card.appendChild(errDiv);
    card.appendChild(formGroup('Username', usernameInput));
    card.appendChild(formGroup('PIN', pinInput));
    card.appendChild(el('div', { style: 'margin-top:20px' }, submitBtn));
    wrapper.appendChild(card);
    return wrapper;
  }

  /* ── App shell ── */
  function renderShell(activePage) {
    const sidebar = renderSidebar(activePage);
    const main = el('div', { id: 'main' });
    const page = el('div', { id: 'page' });
    main.appendChild(page);

    const shell = el('div', { id: 'app-shell', style: 'display:flex;height:100vh' });
    shell.appendChild(sidebar);
    shell.appendChild(main);

    // Render active page
    loadPage(page, activePage);
    return shell;
  }

  function renderSidebar(activePage) {
    const sidebar = el('div', { id: 'sidebar' });
    const header = el('div', { id: 'sidebar-header' });
    // Church heart-logo SVG
    const logoWrap = el('div', { style: 'display:flex;align-items:center;gap:10px;margin-bottom:8px' });
    logoWrap.innerHTML = `<svg width="38" height="38" viewBox="0 0 44 44" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M22 39C22 39 4 26 4 14.5C4 8.7 8.2 5 14 5C17.5 5 20.5 6.8 22 9.2C23.5 6.8 26.5 5 30 5C35.8 5 40 8.7 40 14.5C40 26 22 39 22 39Z" fill="#c01230"/>
      <rect x="17" y="24" width="10" height="9" rx="0.5" fill="white" opacity="0.9"/>
      <polygon points="22,13 13,23 31,23" fill="white" opacity="0.9"/>
      <rect x="21" y="10" width="2" height="5" fill="white" opacity="0.9"/>
      <rect x="18.5" y="12" width="7" height="1.5" fill="white" opacity="0.9"/>
      <rect x="19.5" y="28" width="5" height="5" fill="#c01230"/>
      <rect x="17.5" y="25.5" width="3" height="2.5" fill="#c01230" opacity="0.7"/>
      <rect x="23.5" y="25.5" width="3" height="2.5" fill="#c01230" opacity="0.7"/>
    </svg>`;
    const nameBlock = el('div');
    const h1 = el('h1'); h1.textContent = 'St. Pete First';
    const p = el('p'); p.textContent = 'Signage Admin';
    nameBlock.appendChild(h1); nameBlock.appendChild(p);
    logoWrap.appendChild(nameBlock);
    header.appendChild(logoWrap);

    const navItems = [
      { hash: 'screens', icon: '📺', label: 'Screens' },
      { hash: 'images',  icon: '🖼️', label: 'Images' },
      { hash: 'groups',  icon: '📋', label: 'Groups' },
    ];
    if (currentUser.role === 'admin') {
      navItems.push({ hash: 'users', icon: '👤', label: 'Users' });
    }

    const nav = el('ul', { id: 'nav' });
    for (const item of navItems) {
      const li = el('li');
      const a = el('a', { href: `#${item.hash}` });
      if (item.hash === activePage) a.classList.add('active');
      const icon = el('span', { className: 'icon' }); icon.textContent = item.icon;
      a.appendChild(icon);
      a.appendChild(document.createTextNode(item.label));
      li.appendChild(a);
      nav.appendChild(li);
    }

    const footer = el('div', { id: 'sidebar-footer' });
    const userInfo = el('div', { id: 'user-info' });
    const strong = el('strong'); strong.textContent = currentUser.username;
    userInfo.appendChild(strong);
    userInfo.appendChild(document.createTextNode(currentUser.role));
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btnsRow = el('div', { id: 'sidebar-footer-btns' });
    const logoutBtn = el('button', { id: 'logout-btn' });
    logoutBtn.textContent = 'Sign out';
    logoutBtn.addEventListener('click', async () => {
      await api('POST', '/auth/logout').catch(() => {});
      currentUser = null;
      render();
    });
    const themeBtn = el('button', { id: 'theme-btn', title: 'Toggle light/dark mode' });
    themeBtn.textContent = isDark ? '☀️' : '🌙';
    themeBtn.addEventListener('click', toggleTheme);
    btnsRow.appendChild(logoutBtn);
    btnsRow.appendChild(themeBtn);
    const credit = el('div', { style: 'padding:8px 12px 2px;font-size:.68rem;color:var(--text-dim);text-align:center' });
    credit.innerHTML = 'Design by <a href="https://tavaone.com/#dev" target="_blank" rel="noopener" style="color:var(--text-muted);text-decoration:none;">Tava One LLC</a>';
    footer.appendChild(userInfo);
    footer.appendChild(btnsRow);
    footer.appendChild(credit);

    sidebar.appendChild(header);
    sidebar.appendChild(nav);
    sidebar.appendChild(footer);
    return sidebar;
  }

  async function loadPage(container, page) {
    container.innerHTML = '<div class="loading">Loading…</div>';
    try {
      if (page === 'screens') await renderScreens(container);
      else if (page === 'images') await renderImages(container);
      else if (page === 'groups') {
        const sub = getSubParam();
        if (sub) await renderGroupEditor(container, sub);
        else await renderGroups(container);
      }
      else if (page === 'users') {
        if (currentUser.role !== 'admin') { container.innerHTML = '<div class="empty">Access denied.</div>'; return; }
        await renderUsers(container);
      }
      else container.innerHTML = '<div class="empty">Unknown page.</div>';
    } catch (e) {
      container.innerHTML = `<div class="empty">Error: ${esc(e.message)}</div>`;
    }
  }

  /* ── SCREENS ── */
  async function renderScreens(container) {
    const [screens, groups] = await Promise.all([
      api('GET', '/screens'),
      api('GET', '/groups'),
    ]);

    const wrap = el('div');
    const header = el('div', { className: 'page-header' });
    const title = el('h2'); title.textContent = 'Screens';
    const addBtn = btn('+ Add Screen', 'btn btn-primary btn-sm', () => openScreenModal(null, screens, groups, () => loadPage(container, 'screens')));
    header.appendChild(title); header.appendChild(addBtn);
    wrap.appendChild(header);

    if (!screens.length) {
      wrap.appendChild(el('div', { className: 'empty' }, 'No screens yet. Add one to get started.'));
    } else {
      const tableWrap = el('div', { className: 'table-wrap' });
      const t = el('table');
      t.innerHTML = `<thead><tr>
        <th>Name</th><th>Location</th><th>Orientation</th>
        <th>Assigned Group</th><th>Display URL</th><th>Actions</th>
      </tr></thead>`;
      const tbody = el('tbody');
      for (const s of screens) {
        const tr = el('tr');
        tr.innerHTML = `
          <td><strong>${esc(s.name)}</strong></td>
          <td>${s.location ? esc(s.location) : '<span class="cell-muted">—</span>'}</td>
          <td><span class="badge badge-${esc(s.orientation)}">${esc(s.orientation)}</span></td>
          <td></td>
          <td><span class="url-cell" title="${esc(s.display_url)}">${esc(s.display_url)}</span></td>
          <td></td>
        `;
        // Group selector cell
        const groupCell = tr.querySelectorAll('td')[3];
        const sel = el('select');
        const noneOpt = el('option'); noneOpt.value = ''; noneOpt.textContent = '— Unassigned —';
        sel.appendChild(noneOpt);
        for (const g of groups) {
          const o = el('option'); o.value = g.id; o.textContent = g.name;
          if (s.active_group_id === g.id) o.selected = true;
          sel.appendChild(o);
        }
        sel.addEventListener('change', async () => {
          try {
            await api('PATCH', `/screens/${s.id}`, {
              active_group_id: sel.value || null,
            });
            toast('Assignment updated');
          } catch (e) {
            toast(e.message, 'error');
            sel.value = s.active_group_id || '';
          }
        });
        groupCell.appendChild(sel);

        // Actions cell
        const actionsCell = tr.querySelectorAll('td')[5];
        const actDiv = el('div', { className: 'actions' });
        actDiv.appendChild(btn('Copy URL', 'btn btn-ghost btn-sm', () => {
          navigator.clipboard.writeText(s.display_url).then(() => toast('URL copied'));
        }));
        actDiv.appendChild(btn('Edit', 'btn btn-ghost btn-sm', () =>
          openScreenModal(s, screens, groups, () => loadPage(container, 'screens'))
        ));
        if (currentUser.role === 'admin') {
          actDiv.appendChild(btn('Delete', 'btn btn-danger btn-sm', async () => {
            if (!confirm(`Delete screen "${s.name}"?`)) return;
            try {
              await api('DELETE', `/screens/${s.id}`);
              toast('Screen deleted');
              loadPage(container, 'screens');
            } catch (e) { toast(e.message, 'error'); }
          }));
        }
        actionsCell.appendChild(actDiv);
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      tableWrap.appendChild(t);
      wrap.appendChild(tableWrap);
    }
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  function openScreenModal(screen, screens, groups, onDone) {
    const isEdit = !!screen;
    const nameInput = textInput('e.g. Lobby TV', screen?.name || '');
    const locInput = textInput('e.g. Main entrance', screen?.location || '');
    const orientSel = selectInput([['landscape','Landscape'],['portrait','Portrait']], screen?.orientation || 'landscape');

    const content = el('div');
    content.appendChild(formGroup('Name *', nameInput));
    content.appendChild(formGroup('Location', locInput));
    content.appendChild(formGroup('Orientation', orientSel));

    const errDiv = el('div', { style: 'color:var(--danger);font-size:.82rem;margin-bottom:8px' });

    const footer = el('div', { className: 'modal-footer' });
    footer.appendChild(el('div'));
    const cancelBtn = btn('Cancel', 'btn btn-ghost', () => overlay.remove());
    const saveBtn = btn(isEdit ? 'Save' : 'Create', 'btn btn-primary', async () => {
      errDiv.textContent = '';
      const name = nameInput.value.trim();
      if (!name) { errDiv.textContent = 'Name is required'; return; }
      saveBtn.disabled = true;
      try {
        if (isEdit) {
          await api('PATCH', `/screens/${screen.id}`, {
            name, location: locInput.value.trim() || null,
            orientation: orientSel.value,
          });
          toast('Screen updated');
        } else {
          await api('POST', '/screens', {
            name, location: locInput.value.trim() || null,
            orientation: orientSel.value,
          });
          toast('Screen created');
        }
        overlay.remove();
        onDone();
      } catch (e) {
        errDiv.textContent = e.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
    content.insertBefore(errDiv, null);
    footer.appendChild(cancelBtn);
    footer.appendChild(saveBtn);
    const { overlay } = renderModal(isEdit ? `Edit: ${screen.name}` : 'Add Screen', content, footer);
    setTimeout(() => nameInput.focus(), 50);
  }

  /* ── IMAGES ── */
  async function renderImages(container) {
    const images = await api('GET', '/images');
    allImages = images;

    const wrap = el('div');
    const header = el('div', { className: 'page-header' });
    const title = el('h2'); title.textContent = 'Images';
    header.appendChild(title);
    wrap.appendChild(header);

    // Upload zone
    const zone = el('div', { className: 'upload-zone', id: 'upload-zone' });
    zone.innerHTML = '<div style="font-size:2rem">📁</div><p>Click or drag & drop images here (JPEG, PNG, WebP · max 10 MB each)</p>';
    const fileInput = el('input', { type: 'file', style: 'display:none', multiple: true, accept: 'image/jpeg,image/png,image/webp' });
    const progressEl = el('div', { className: 'upload-progress' });
    zone.appendChild(fileInput);
    zone.appendChild(progressEl);

    zone.addEventListener('click', () => fileInput.click());
    zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      uploadFiles(Array.from(e.dataTransfer.files), progressEl, container);
    });
    fileInput.addEventListener('change', () => {
      uploadFiles(Array.from(fileInput.files), progressEl, container);
      fileInput.value = '';
    });
    wrap.appendChild(zone);

    if (!images.length) {
      wrap.appendChild(el('div', { className: 'empty' }, 'No images uploaded yet.'));
    } else {
      const grid = el('div', { className: 'img-grid' });
      for (const img of images) {
        grid.appendChild(renderImageCard(img, container));
      }
      wrap.appendChild(grid);
    }
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  async function uploadFiles(files, progressEl, container) {
    const valid = files.filter(f => ['image/jpeg','image/png','image/webp'].includes(f.type));
    if (!valid.length) { toast('No valid image files selected', 'error'); return; }
    progressEl.textContent = `Uploading 0/${valid.length}…`;
    let done = 0, errors = 0;
    for (const file of valid) {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('display_name', file.name.replace(/\.[^.]+$/, ''));
      try {
        await api('POST', '/images', fd, true);
        done++;
      } catch (e) {
        errors++;
        toast(`${file.name}: ${e.message}`, 'error');
      }
      progressEl.textContent = `Uploading ${done + errors}/${valid.length}…`;
    }
    progressEl.textContent = '';
    if (done) toast(`${done} image${done > 1 ? 's' : ''} uploaded`);
    await renderImages(container);
  }

  function renderImageCard(img, container) {
    const card = el('div', { className: 'img-card' });
    const image = el('img', { src: img.url, alt: img.display_name, loading: 'lazy' });
    card.appendChild(image);
    const body = el('div', { className: 'img-card-body' });
    const namePara = el('p', { className: 'name', title: img.display_name });
    namePara.textContent = img.display_name;
    const dims = el('p', { className: 'dims' });
    dims.textContent = img.width ? `${img.width}×${img.height}` : '';
    body.appendChild(namePara);
    body.appendChild(dims);
    const actions = el('div', { className: 'img-card-actions' });

    actions.appendChild(btn('Rename', 'btn btn-ghost btn-sm', () => {
      const newName = prompt('New name:', img.display_name);
      if (!newName || newName === img.display_name) return;
      api('PATCH', `/images/${img.id}`, { display_name: newName })
        .then(() => { toast('Renamed'); renderImages(container); })
        .catch(e => toast(e.message, 'error'));
    }));
    actions.appendChild(btn('Delete', 'btn btn-danger btn-sm', async () => {
      if (!confirm(`Delete "${img.display_name}"? It will be removed from all groups.`)) return;
      try {
        await api('DELETE', `/images/${img.id}`);
        toast('Image deleted');
        renderImages(container);
      } catch (e) { toast(e.message, 'error'); }
    }));
    body.appendChild(actions);
    card.appendChild(body);
    return card;
  }

  /* ── GROUPS ── */
  async function renderGroups(container) {
    const groups = await api('GET', '/groups');

    const wrap = el('div');
    const header = el('div', { className: 'page-header' });
    const title = el('h2'); title.textContent = 'Groups';
    const addBtn = btn('+ Add Group', 'btn btn-primary btn-sm', () => openGroupModal(null, () => loadPage(container, 'groups')));
    header.appendChild(title); header.appendChild(addBtn);
    wrap.appendChild(header);

    if (!groups.length) {
      wrap.appendChild(el('div', { className: 'empty' }, 'No groups yet.'));
    } else {
      const tableWrap = el('div', { className: 'table-wrap' });
      const t = el('table');
      t.innerHTML = `<thead><tr>
        <th>Name</th><th>Description</th><th>Images</th><th>Speed</th><th>Shuffle</th><th>Actions</th>
      </tr></thead>`;
      const tbody = el('tbody');
      for (const g of groups) {
        const tr = el('tr');
        tr.innerHTML = `
          <td><strong>${esc(g.name)}</strong></td>
          <td>${g.description ? esc(g.description) : '<span class="cell-muted">—</span>'}</td>
          <td>${g.image_count}</td>
          <td>${g.rotation_speed}s</td>
          <td>${g.shuffle ? '✓' : '—'}</td>
          <td></td>
        `;
        const actCell = tr.querySelectorAll('td')[5];
        const actDiv = el('div', { className: 'actions' });
        actDiv.appendChild(btn('Edit', 'btn btn-primary btn-sm', () => navigate(`#groups/${g.id}`)));
        actDiv.appendChild(btn('Settings', 'btn btn-ghost btn-sm', () => openGroupModal(g, () => loadPage(container, 'groups'))));
        actDiv.appendChild(btn('Delete', 'btn btn-danger btn-sm', async () => {
          if (!confirm(`Delete group "${g.name}"? Screens showing it will go idle.`)) return;
          try {
            await api('DELETE', `/groups/${g.id}`);
            toast('Group deleted');
            loadPage(container, 'groups');
          } catch (e) { toast(e.message, 'error'); }
        }));
        actCell.appendChild(actDiv);
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      tableWrap.appendChild(t);
      wrap.appendChild(tableWrap);
    }
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  function openGroupModal(group, onDone) {
    const isEdit = !!group;
    const nameInput = textInput('Group name', group?.name || '');
    const descInput = el('textarea', { placeholder: 'Description (optional)' });
    descInput.value = group?.description || '';
    const speedInput = el('input', { type: 'range', min: 2, max: 60, step: 1 });
    speedInput.value = group?.rotation_speed || 8;
    const speedVal = el('span', { className: 'speed-val' });
    speedVal.textContent = `${speedInput.value}s`;
    speedInput.addEventListener('input', () => { speedVal.textContent = `${speedInput.value}s`; });

    const shuffleToggle = el('input', { type: 'checkbox' });
    shuffleToggle.checked = !!(group?.shuffle);

    const content = el('div');
    content.appendChild(formGroup('Name *', nameInput));
    content.appendChild(formGroup('Description', descInput));

    const speedRow = el('div', { className: 'form-group' });
    const speedLabel = el('label'); speedLabel.textContent = 'Rotation speed';
    const speedWrap = el('div', { className: 'speed-row' });
    speedWrap.appendChild(speedInput); speedWrap.appendChild(speedVal);
    speedRow.appendChild(speedLabel); speedRow.appendChild(speedWrap);
    content.appendChild(speedRow);

    const toggleRow = el('div', { className: 'toggle-row form-group' });
    const lbl = el('span', { className: 'toggle-label' }); lbl.textContent = 'Shuffle images';
    const toggleLabel = el('label', { className: 'toggle' });
    const slider = el('span', { className: 'toggle-slider' });
    toggleLabel.appendChild(shuffleToggle); toggleLabel.appendChild(slider);
    toggleRow.appendChild(lbl); toggleRow.appendChild(toggleLabel);
    content.appendChild(toggleRow);

    const errDiv = el('div', { style: 'color:var(--danger);font-size:.82rem;margin-top:8px' });
    content.appendChild(errDiv);

    const footer = el('div', { className: 'modal-footer' });
    const cancelBtn = btn('Cancel', 'btn btn-ghost', () => overlay.remove());
    const saveBtn = btn(isEdit ? 'Save' : 'Create', 'btn btn-primary', async () => {
      const name = nameInput.value.trim();
      if (!name) { errDiv.textContent = 'Name is required'; return; }
      saveBtn.disabled = true;
      try {
        const payload = {
          name, description: descInput.value.trim() || null,
          rotation_speed: Number(speedInput.value), shuffle: shuffleToggle.checked,
        };
        if (isEdit) {
          await api('PATCH', `/groups/${group.id}`, payload);
          toast('Group updated');
        } else {
          await api('POST', '/groups', payload);
          toast('Group created');
        }
        overlay.remove(); onDone();
      } catch (e) {
        errDiv.textContent = e.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
    footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    const { overlay } = renderModal(isEdit ? `Edit: ${group.name}` : 'New Group', content, footer);
    setTimeout(() => nameInput.focus(), 50);
  }

  /* ── GROUP EDITOR ── */
  async function renderGroupEditor(container, groupId) {
    const [groupData, screensData, allImagesData] = await Promise.all([
      api('GET', `/groups/${groupId}`),
      api('GET', '/screens'),
      api('GET', '/images'),
    ]);
    allImages = allImagesData;

    const wrap = el('div');
    const header = el('div', { className: 'page-header' });
    const backBtn = btn('← Groups', 'btn btn-ghost btn-sm', () => navigate('#groups'));
    const title = el('h2'); title.textContent = groupData.name;
    header.appendChild(backBtn); header.appendChild(title);
    wrap.appendChild(header);

    // ── Image membership section ──
    const imgSection = el('div', { className: 'section' });
    const imgTitle = el('div', { className: 'section-title' }); imgTitle.textContent = 'Images in this group';
    imgSection.appendChild(imgTitle);

    let memberImages = [...groupData.images]; // {id, display_name, r2_key, url, position, ...}

    const listWrap = el('div');
    const memberList = el('ul', { className: 'group-images-list' });

    function renderMemberList() {
      memberList.innerHTML = '';
      if (!memberImages.length) {
        const empty = el('li', { style: 'color:var(--text-muted);font-size:.85rem;padding:12px 0' });
        empty.textContent = 'No images yet. Add from the library below.';
        memberList.appendChild(empty);
        return;
      }
      let draggedRow = null;
      for (const img of memberImages) {
        const row = el('li', { className: 'group-img-row' });
        row.dataset.id = img.id;
        const handle = el('span', { className: 'drag-handle' }); handle.textContent = '⠿';
        const thumb = el('img', { src: img.url, alt: img.display_name });
        const name = el('span', { className: 'img-name' }); name.textContent = img.display_name;
        const removeBtn = btn('✕', 'btn btn-danger btn-sm', () => {
          memberImages = memberImages.filter(i => i.id !== img.id);
          renderMemberList();
        });
        row.appendChild(handle); row.appendChild(thumb); row.appendChild(name); row.appendChild(removeBtn);

        // Drag-and-drop reorder
        row.draggable = true;
        row.addEventListener('dragstart', e => {
          draggedRow = row;
          e.dataTransfer.effectAllowed = 'move';
        });
        row.addEventListener('dragend', () => {
          draggedRow = null;
          memberList.querySelectorAll('.group-img-row').forEach(r => r.classList.remove('drag-over'));
          // Sync order from DOM
          memberImages = Array.from(memberList.querySelectorAll('[data-id]')).map(r => {
            return memberImages.find(i => i.id === r.dataset.id);
          }).filter(Boolean);
        });
        row.addEventListener('dragover', e => {
          e.preventDefault();
          if (draggedRow && draggedRow !== row) row.classList.add('drag-over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
        row.addEventListener('drop', e => {
          e.preventDefault();
          row.classList.remove('drag-over');
          if (draggedRow && draggedRow !== row) {
            const items = Array.from(memberList.children);
            const fromIdx = items.indexOf(draggedRow);
            const toIdx = items.indexOf(row);
            if (fromIdx < toIdx) row.after(draggedRow);
            else row.before(draggedRow);
          }
        });
        memberList.appendChild(row);
      }
    }

    renderMemberList();
    listWrap.appendChild(memberList);
    imgSection.appendChild(listWrap);

    // Add images from library
    const addBtn2 = btn('+ Add from library', 'btn btn-ghost btn-sm', () => {
      openImagePicker(memberImages, (selected) => {
        const existing = new Set(memberImages.map(i => i.id));
        for (const img of selected) {
          if (!existing.has(img.id)) memberImages.push(img);
        }
        renderMemberList();
      });
    });
    imgSection.appendChild(el('div', { style: 'margin-top:12px' }, addBtn2));

    const saveImagesBtn = btn('Save image list', 'btn btn-primary btn-sm', async () => {
      try {
        const ids = Array.from(memberList.querySelectorAll('[data-id]')).map(r => r.dataset.id);
        await api('PUT', `/groups/${groupId}/images`, { image_ids: ids });
        toast('Images saved');
        // Reload to get fresh data
        const fresh = await api('GET', `/groups/${groupId}`);
        memberImages = fresh.images;
        renderMemberList();
      } catch (e) { toast(e.message, 'error'); }
    });
    imgSection.appendChild(el('div', { style: 'margin-top:10px' }, saveImagesBtn));
    wrap.appendChild(imgSection);
    wrap.appendChild(el('hr'));

    // ── Screen assignment section ──
    const screenSection = el('div', { className: 'section' });
    const screenTitle = el('div', { className: 'section-title' }); screenTitle.textContent = 'Show on screens';
    screenSection.appendChild(screenTitle);

    const assignedIds = new Set(screensData.filter(s => s.active_group_id === groupId).map(s => s.id));
    const chips = el('div', { className: 'multi-select' });
    const screenSelections = new Set(assignedIds);

    for (const screen of screensData) {
      const chip = el('div', { className: `chip ${assignedIds.has(screen.id) ? 'selected' : ''}` });
      chip.textContent = `${screen.name}${screen.location ? ` (${screen.location})` : ''}`;
      chip.addEventListener('click', () => {
        if (screenSelections.has(screen.id)) { screenSelections.delete(screen.id); chip.classList.remove('selected'); }
        else { screenSelections.add(screen.id); chip.classList.add('selected'); }
      });
      chips.appendChild(chip);
    }

    if (!screensData.length) {
      const note = el('p', { style: 'color:var(--text-muted);font-size:.85rem' });
      note.textContent = 'No screens defined yet.';
      screenSection.appendChild(note);
    } else {
      screenSection.appendChild(chips);
      const saveScreensBtn = btn('Save screen assignments', 'btn btn-primary btn-sm', async () => {
        try {
          await api('PUT', `/groups/${groupId}/screens`, { screen_ids: Array.from(screenSelections) });
          toast('Screen assignments saved');
        } catch (e) { toast(e.message, 'error'); }
      });
      screenSection.appendChild(el('div', { style: 'margin-top:12px' }, saveScreensBtn));
    }
    wrap.appendChild(screenSection);

    container.innerHTML = '';
    container.appendChild(wrap);
  }

  function openImagePicker(alreadySelected, onAdd) {
    const selectedIds = new Set(alreadySelected.map(i => i.id));

    const content = el('div');
    const grid = el('div', { className: 'img-picker-grid' });

    if (!allImages.length) {
      const p = el('p', { style: 'color:var(--text-muted)' }); p.textContent = 'No images in library yet.';
      content.appendChild(p);
    } else {
      for (const img of allImages) {
        const item = el('div', { className: `img-picker-item ${selectedIds.has(img.id) ? 'selected' : ''}` });
        item.dataset.id = img.id;
        const thumb = el('img', { src: img.url, alt: img.display_name, loading: 'lazy' });
        const name = el('p'); name.textContent = img.display_name;
        item.appendChild(thumb); item.appendChild(name);
        item.addEventListener('click', () => {
          if (selectedIds.has(img.id)) { selectedIds.delete(img.id); item.classList.remove('selected'); }
          else { selectedIds.add(img.id); item.classList.add('selected'); }
        });
        grid.appendChild(item);
      }
      content.appendChild(grid);
    }

    const footer = el('div', { className: 'modal-footer' });
    const cancelBtn = btn('Cancel', 'btn btn-ghost', () => overlay.remove());
    const addBtn = btn('Add selected', 'btn btn-primary', () => {
      const toAdd = allImages.filter(i => selectedIds.has(i.id) && !alreadySelected.find(a => a.id === i.id));
      onAdd(toAdd);
      overlay.remove();
    });
    footer.appendChild(cancelBtn); footer.appendChild(addBtn);
    const { overlay } = renderModal('Add images to group', content, footer);
  }

  /* ── USERS ── */
  async function renderUsers(container) {
    const users = await api('GET', '/users');

    const wrap = el('div');
    const header = el('div', { className: 'page-header' });
    const title = el('h2'); title.textContent = 'Users';
    const addBtn = btn('+ Add User', 'btn btn-primary btn-sm', () => openUserModal(null, () => loadPage(container, 'users')));
    header.appendChild(title); header.appendChild(addBtn);
    wrap.appendChild(header);

    if (!users.length) {
      wrap.appendChild(el('div', { className: 'empty' }, 'No users.'));
    } else {
      const tableWrap = el('div', { className: 'table-wrap' });
      const t = el('table');
      t.innerHTML = `<thead><tr><th>Username</th><th>Role</th><th>Created</th><th>Actions</th></tr></thead>`;
      const tbody = el('tbody');
      for (const u of users) {
        const tr = el('tr');
        const date = new Date(u.created_at).toLocaleDateString();
        tr.innerHTML = `
          <td><strong>${esc(u.username)}</strong></td>
          <td><span class="badge badge-${esc(u.role)}">${esc(u.role)}</span></td>
          <td>${date}</td>
          <td></td>
        `;
        const actCell = tr.querySelectorAll('td')[3];
        const actDiv = el('div', { className: 'actions' });
        actDiv.appendChild(btn('Edit', 'btn btn-ghost btn-sm', () => openUserModal(u, () => loadPage(container, 'users'))));
        if (u.id !== currentUser.id) {
          actDiv.appendChild(btn('Delete', 'btn btn-danger btn-sm', async () => {
            if (!confirm(`Delete user "${u.username}"?`)) return;
            try {
              await api('DELETE', `/users/${u.id}`);
              toast('User deleted');
              loadPage(container, 'users');
            } catch (e) { toast(e.message, 'error'); }
          }));
        }
        actCell.appendChild(actDiv);
        tbody.appendChild(tr);
      }
      t.appendChild(tbody);
      tableWrap.appendChild(t);
      wrap.appendChild(tableWrap);
    }
    container.innerHTML = '';
    container.appendChild(wrap);
  }

  function openUserModal(user, onDone) {
    const isEdit = !!user;
    const usernameInput = textInput('Username', user?.username || '');
    const pinInput = textInput(isEdit ? 'New PIN (leave blank to keep)' : 'PIN (min 4 chars)', '', 'password');
    const roleSel = selectInput([['admin','Admin'],['user','User']], user?.role || 'user');

    const content = el('div');
    content.appendChild(formGroup('Username *', usernameInput));
    content.appendChild(formGroup(isEdit ? 'Change PIN' : 'PIN *', pinInput));
    content.appendChild(formGroup('Role', roleSel));
    const errDiv = el('div', { style: 'color:var(--danger);font-size:.82rem;margin-top:8px' });
    content.appendChild(errDiv);

    const footer = el('div', { className: 'modal-footer' });
    const cancelBtn = btn('Cancel', 'btn btn-ghost', () => overlay.remove());
    const saveBtn = btn(isEdit ? 'Save' : 'Create', 'btn btn-primary', async () => {
      const username = usernameInput.value.trim();
      const pin = pinInput.value;
      if (!username) { errDiv.textContent = 'Username required'; return; }
      if (!isEdit && !pin) { errDiv.textContent = 'PIN required'; return; }
      if (pin && pin.length < 4) { errDiv.textContent = 'PIN must be at least 4 characters'; return; }
      saveBtn.disabled = true;
      try {
        const payload = { username, role: roleSel.value };
        if (pin) payload.pin = pin;
        if (isEdit) {
          await api('PATCH', `/users/${user.id}`, payload);
          toast('User updated');
        } else {
          await api('POST', '/users', { ...payload, pin });
          toast('User created');
        }
        overlay.remove(); onDone();
      } catch (e) {
        errDiv.textContent = e.message;
      } finally {
        saveBtn.disabled = false;
      }
    });
    footer.appendChild(cancelBtn); footer.appendChild(saveBtn);
    const { overlay } = renderModal(isEdit ? `Edit: ${user.username}` : 'Add User', content, footer);
    setTimeout(() => usernameInput.focus(), 50);
  }

  /* ── Theme ── */
  function applyTheme(theme) {
    if (theme === 'dark') {
      document.documentElement.setAttribute('data-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
    }
    localStorage.setItem('theme', theme);
  }

  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    applyTheme(current === 'dark' ? 'light' : 'dark');
    // Update button icon if it exists
    const btn = document.getElementById('theme-btn');
    if (btn) btn.textContent = current === 'dark' ? '🌙' : '☀️';
  }

  /* ── Boot ── */
  async function boot() {
    // Apply saved theme (default: light)
    const saved = localStorage.getItem('theme') || 'light';
    applyTheme(saved);

    try {
      currentUser = await api('GET', '/auth/me');
    } catch {
      currentUser = null;
    }
    render();
  }

  boot();
})();
