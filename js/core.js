'use strict';

const app = document.querySelector('#app');
const toastRoot = document.querySelector('#toast-root');
const modalRoot = document.querySelector('#modal-root');

const state = {
  token: localStorage.getItem('quizflow_token') || '',
  user: null,
  authMode: 'login',
  view: 'dashboard',
  quizzes: [],
  history: [],
  editor: null,
  room: null,
  selected: [],
  socket: null,
  reconnectTimer: null,
  clockTimer: null,
  loading: false
};

const letters = ['A', 'B', 'C', 'D', 'E', 'F'];

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function icon(name) {
  const paths = {
    home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5 10.5V20h14v-9.5M9 20v-6h6v6"/>',
    quiz: '<rect x="4" y="3" width="16" height="18" rx="3"/><path d="M8 8h8M8 12h5M8 16h7"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    logout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M8 12h10"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    play: '<path d="m8 5 11 7-11 7Z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 15H6L5 6M10 11v5M14 11v5"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M15 9V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h4"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    x: '<path d="m6 6 12 12M18 6 6 18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/>',
    arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    trophy: '<path d="M8 21h8M12 17v4M7 4h10v4a5 5 0 0 1-10 0Z"/><path d="M7 6H4v2a4 4 0 0 0 4 4M17 6h3v2a4 4 0 0 1-4 4"/>',
    spark: '<path d="m12 3 1.7 5.3L19 10l-5.3 1.7L12 17l-1.7-5.3L5 10l5.3-1.7ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7Z"/>',
    menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
    back: '<path d="m15 18-6-6 6-6"/>',
    save: '<path d="M5 21h14a2 2 0 0 0 2-2V7l-4-4H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2Z"/><path d="M7 3v6h9V3M8 21v-7h8v7"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 3v3M21 12h-3M12 21v-3M3 12h3"/>',
    bolt: '<path d="m13 2-9 12h8l-1 8 9-12h-8Z"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.spark}</svg>`;
}

function formatDate(value) {
  if (!value) return '—';
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(value));
}

function plural(number, forms) {
  const n = Math.abs(number) % 100;
  const n1 = n % 10;
  if (n > 10 && n < 20) return forms[2];
  if (n1 > 1 && n1 < 5) return forms[1];
  if (n1 === 1) return forms[0];
  return forms[2];
}

function toast(message, type = 'success') {
  const element = document.createElement('div');
  element.className = `toast ${type === 'error' ? 'toast--error' : ''}`;
  element.textContent = message;
  toastRoot.append(element);
  setTimeout(() => element.remove(), 3800);
}

let confirmHandler = null;
function showConfirm(title, text, handler) {
  confirmHandler = handler;
  modalRoot.innerHTML = `
    <div class="modal-backdrop" data-action="close-modal">
      <div class="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" data-modal>
        <h2 id="modal-title">${escapeHtml(title)}</h2>
        <p>${escapeHtml(text)}</p>
        <div class="modal-actions">
          <button class="button button--secondary" data-action="close-modal">Отмена</button>
          <button class="button button--danger" data-action="confirm-modal">Удалить</button>
        </div>
      </div>
    </div>`;
}

function closeModal() {
  modalRoot.innerHTML = '';
  confirmHandler = null;
}

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const response = await fetch(path, { ...options, headers });
  let data = {};
  try { data = await response.json(); } catch { /* Empty response. */ }
  if (!response.ok) {
    if (response.status === 401 && path !== '/api/login') clearSession(false);
    throw new Error(data.error || 'Не удалось выполнить запрос');
  }
  return data;
}

function setSession(token, user) {
  state.token = token;
  state.user = user;
  localStorage.setItem('quizflow_token', token);
}

function clearSession(renderNow = true) {
  disconnectRoom();
  state.token = '';
  state.user = null;
  state.quizzes = [];
  state.history = [];
  state.room = null;
  localStorage.removeItem('quizflow_token');
  if (renderNow) render();
}

function brand() {
  return '<span class="brand"><span class="brand-mark">Q</span><span>QuizFlow</span></span>';
}

function navItems() {
  return state.user.role === 'organizer'
    ? [
        ['dashboard', 'home', 'Главная'],
        ['quizzes', 'quiz', 'Мои квизы'],
        ['editor', 'plus', 'Создать квиз'],
        ['history', 'history', 'История']
      ]
    : [
        ['dashboard', 'home', 'Присоединиться'],
        ['history', 'history', 'Мои результаты']
      ];
}

function shell(content) {
  const current = state.view === 'editor' ? 'quizzes' : state.view;
  const navigation = navItems().map(([view, iconName, label]) => `
    <button class="nav-button ${current === view ? 'is-active' : ''}" data-view="${view}">
      ${icon(iconName)}<span>${label}</span>
    </button>`).join('');
  const mobile = navItems().filter(([view]) => view !== 'editor').map(([view, iconName, label]) => `
    <button class="icon-button ${current === view ? 'is-active' : ''}" data-view="${view}" aria-label="${label}">${icon(iconName)}</button>`).join('');
  return `
    <div class="app-shell">
      <aside class="sidebar">
        ${brand()}
        <nav class="nav-list" aria-label="Основная навигация">${navigation}</nav>
        <div class="sidebar-footer">
          <div class="profile-mini">
            <div class="avatar">${escapeHtml(state.user.name.charAt(0).toUpperCase())}</div>
            <div><div class="profile-name">${escapeHtml(state.user.name)}</div><div class="profile-role">${state.user.role === 'organizer' ? 'Организатор' : 'Участник'}</div></div>
            <button class="icon-button" data-action="logout" aria-label="Выйти">${icon('logout')}</button>
          </div>
        </div>
      </aside>
      <header class="mobile-header">
        ${brand()}
        <nav class="mobile-nav">${mobile}<button class="icon-button" data-action="logout" aria-label="Выйти">${icon('logout')}</button></nav>
      </header>
      <main id="main" class="main"><div class="content">${content}</div></main>
    </div>`;
}

