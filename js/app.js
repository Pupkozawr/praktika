'use strict';

function renderRoom() {
  const room = state.room;
  if (!room) return;
  stopClock();
  const content = room.phase === 'lobby' ? renderLobby(room) : room.phase === 'finished' ? renderFinished(room) : renderQuestion(room);
  app.innerHTML = `<div class="room-page">${roomTopbar(room)}<main class="room-content">${content}</main></div>`;
  if (room.phase === 'question') startClock();
}

function render() {
  if (state.loading) return renderLoading();
  if (!state.user) return renderAuth();
  if (state.view === 'room') return renderRoom();
  if (state.view === 'editor') {
    const html = renderEditor();
    if (typeof html === 'string') app.innerHTML = html;
    return;
  }
  if (state.view === 'quizzes') {
    app.innerHTML = renderQuizzes();
    return;
  }
  if (state.view === 'history') {
    app.innerHTML = renderHistory();
    return;
  }
  app.innerHTML = state.user.role === 'organizer'
    ? renderOrganizerDashboard()
    : renderParticipantDashboard();
}

async function loadQuizzes() {
  if (state.user.role !== 'organizer') return;
  const data = await api('/api/quizzes');
  state.quizzes = data.quizzes;
}

async function loadHistory() {
  const data = await api('/api/history');
  state.history = data.history;
}

async function navigate(view) {
  if (view === 'editor') {
    state.editor = emptyQuiz();
    state.view = 'editor';
    render();
    return;
  }
  disconnectRoom();
  state.view = view;
  state.loading = true;
  render();
  try {
    if (view === 'quizzes') await loadQuizzes();
    if (view === 'history') await loadHistory();
    if (view === 'dashboard') await Promise.all([state.user.role === 'organizer' ? loadQuizzes() : Promise.resolve(), loadHistory()]);
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    state.loading = false;
    render();
    window.scrollTo(0, 0);
  }
}

function openEditor(id) {
  const quiz = state.quizzes.find((item) => item.id === id);
  if (!quiz) return;
  state.editor = structuredClone(quiz);
  state.view = 'editor';
  render();
  window.scrollTo(0, 0);
}

async function saveQuiz() {
  const quiz = state.editor;
  if (!quiz.title.trim()) return toast('Укажите название квиза', 'error');
  try {
    const endpoint = quiz.id ? `/api/quizzes/${quiz.id}` : '/api/quizzes';
    await api(endpoint, { method: quiz.id ? 'PUT' : 'POST', body: quiz });
    toast(quiz.id ? 'Изменения сохранены' : 'Квиз создан');
    await navigate('quizzes');
  } catch (error) {
    toast(error.message, 'error');
  }
}

async function launchQuiz(id) {
  try {
    const data = await api(`/api/quizzes/${id}/launch`, { method: 'POST' });
    enterRoom(data.room);
  } catch (error) { toast(error.message, 'error'); }
}

function enterRoom(room) {
  state.room = room;
  state.selected = [];
  state.view = 'room';
  renderRoom();
  connectRoom(room.code);
}

function applyRoom(room) {
  const oldQuestion = state.room?.question?.id;
  state.room = room;
  if (room.question?.id !== oldQuestion) state.selected = [];
  if (state.view === 'room') renderRoom();
}

function connectRoom(code) {
  if (state.socket) state.socket.close();
  clearTimeout(state.reconnectTimer);
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${location.host}/ws?token=${encodeURIComponent(state.token)}&room=${code}`);
  state.socket = socket;
  socket.onmessage = (event) => {
    try {
      const message = JSON.parse(event.data);
      if (message.room) applyRoom(message.room);
    } catch { /* Ignore malformed message. */ }
  };
  socket.onclose = () => {
    if (state.view === 'room' && state.room?.code === code) {
      state.reconnectTimer = setTimeout(() => connectRoom(code), 1800);
    }
  };
}

function disconnectRoom() {
  clearTimeout(state.reconnectTimer);
  stopClock();
  if (state.socket) {
    state.socket.onclose = null;
    state.socket.close();
  }
  state.socket = null;
}

function startClock() {
  stopClock();
  const update = () => {
    if (!state.room?.questionEndsAt) return;
    const remainingMs = Math.max(0, new Date(state.room.questionEndsAt).getTime() - Date.now());
    const remaining = Math.ceil(remainingMs / 1000);
    const value = document.querySelector('[data-timer-value]');
    const ring = document.querySelector('[data-timer-ring]');
    if (value) value.textContent = remaining;
    if (ring) ring.style.setProperty('--time', String(remainingMs / (state.room.quiz.duration * 1000) * 100));
  };
  update();
  state.clockTimer = setInterval(update, 250);
}

function stopClock() {
  if (state.clockTimer) clearInterval(state.clockTimer);
  state.clockTimer = null;
}

async function roomAction(action, body) {
  try {
    const data = await api(`/api/rooms/${state.room.code}/${action}`, { method: 'POST', body: body || {} });
    if (data.room) applyRoom(data.room);
  } catch (error) { toast(error.message, 'error'); }
}

function updateEditorSummary() {
  const questions = document.querySelector('[data-summary="questions"]');
  const duration = document.querySelector('[data-summary="duration"]');
  const total = document.querySelector('[data-summary="total"]');
  if (questions) questions.textContent = state.editor.questions.length;
  if (duration) duration.textContent = `${state.editor.duration} сек.`;
  if (total) total.textContent = `≈ ${Math.ceil(state.editor.questions.length * state.editor.duration / 60)} мин.`;
}

document.addEventListener('submit', async (event) => {
  const form = event.target;
  if (!form.matches('[data-form]')) return;
  event.preventDefault();
  const type = form.dataset.form;
  const formData = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  try {
    if (type === 'auth') {
      const endpoint = state.authMode === 'login' ? '/api/login' : '/api/register';
      const data = await api(endpoint, { method: 'POST', body: formData });
      setSession(data.token, data.user);
      toast(`Здравствуйте, ${data.user.name}!`);
      await navigate('dashboard');
    }
    if (type === 'join') {
      const code = String(formData.code || '').replace(/\D/g, '');
      const data = await api('/api/rooms/join', { method: 'POST', body: { code } });
      enterRoom(data.room);
    }
  } catch (error) {
    toast(error.message, 'error');
  } finally {
    if (submit) submit.disabled = false;
  }
});

document.addEventListener('click', async (event) => {
  const viewButton = event.target.closest('[data-view]');
  if (viewButton) {
    navigate(viewButton.dataset.view);
    return;
  }
  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  if (action === 'auth-mode') { state.authMode = button.dataset.mode; renderAuth(); }
  if (action === 'demo-login') {
    const form = document.querySelector('[data-form="auth"]');
    form.email.value = button.dataset.email;
    form.password.value = 'demo123';
    form.requestSubmit();
  }
  if (action === 'logout') {
    try { await api('/api/logout', { method: 'POST' }); } catch { /* Session may already be gone. */ }
    clearSession();
  }
  if (action === 'new-quiz') { state.editor = emptyQuiz(); state.view = 'editor'; render(); }
  if (action === 'edit-quiz') openEditor(button.dataset.id);
  if (action === 'launch-quiz') launchQuiz(button.dataset.id);
  if (action === 'delete-quiz') {
    const quiz = state.quizzes.find((item) => item.id === button.dataset.id);
    showConfirm('Удалить квиз?', `«${quiz?.title || 'Этот квиз'}» нельзя будет восстановить.`, async () => {
      try {
        await api(`/api/quizzes/${button.dataset.id}`, { method: 'DELETE' });
        state.quizzes = state.quizzes.filter((item) => item.id !== button.dataset.id);
        closeModal(); render(); toast('Квиз удалён');
      } catch (error) { toast(error.message, 'error'); }
    });
  }
  if (action === 'close-modal' && !event.target.closest('[data-modal]')) closeModal();
  if (action === 'close-modal' && button.matches('button')) closeModal();
  if (action === 'confirm-modal' && confirmHandler) await confirmHandler();

  if (action === 'add-question') {
    if (state.editor.questions.length >= 50) return toast('Достигнут лимит в 50 вопросов', 'error');
    state.editor.questions.push(newQuestion()); render(); window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
  }
  if (action === 'remove-question') {
    if (state.editor.questions.length === 1) return toast('В квизе нужен хотя бы один вопрос', 'error');
    state.editor.questions.splice(Number(button.dataset.index), 1); render();
  }
  if (action === 'add-option') {
    const question = state.editor.questions[Number(button.dataset.index)];
    if (question.options.length < 6) question.options.push('');
    render();
  }
  if (action === 'remove-option') {
    const question = state.editor.questions[Number(button.dataset.index)];
    const optionIndex = Number(button.dataset.option);
    if (question.options.length <= 2) return toast('Нужно оставить минимум два варианта', 'error');
    question.options.splice(optionIndex, 1);
    question.correct = question.correct.filter((value) => value !== optionIndex).map((value) => value > optionIndex ? value - 1 : value);
    if (!question.correct.length) question.correct = [0];
    render();
  }
  if (action === 'remove-image') {
    event.preventDefault(); event.stopPropagation();
    state.editor.questions[Number(button.dataset.index)].image = ''; render();
  }
  if (action === 'save-quiz') saveQuiz();

  if (action === 'copy-code') {
    try { await navigator.clipboard.writeText(state.room.code); toast('Код скопирован'); }
    catch { toast(`Код комнаты: ${state.room.code}`); }
  }
  if (action === 'leave-room') {
    const target = state.user.role === 'organizer' ? 'dashboard' : (state.room?.phase === 'finished' ? 'history' : 'dashboard');
    state.room = null; navigate(target);
  }
  if (action === 'room-start') roomAction('start');
  if (action === 'room-next') roomAction('next');
  if (action === 'room-finish') roomAction('finish');
  if (action === 'select-answer') {
    const index = Number(button.dataset.index);
    if (state.room.question.type === 'single') state.selected = [index];
    else state.selected = state.selected.includes(index) ? state.selected.filter((item) => item !== index) : [...state.selected, index];
    renderRoom();
  }
  if (action === 'submit-answer') roomAction('answer', { selected: state.selected });
});

document.addEventListener('input', (event) => {
  const target = event.target;
  if (target.matches('.code-input')) target.value = target.value.replace(/\D/g, '').slice(0, 6);
  if (target.matches('[data-editor-field]')) {
    const field = target.dataset.editorField;
    state.editor[field] = field === 'duration' ? Number(target.value) : target.value;
    updateEditorSummary();
  }
  if (target.matches('[data-question-field="text"]')) {
    state.editor.questions[Number(target.dataset.index)].text = target.value;
    const heading = target.closest('.question-card').querySelector('.question-head h3');
    heading.textContent = target.value || `Новый вопрос ${Number(target.dataset.index) + 1}`;
  }
  if (target.matches('[data-option-field]')) {
    state.editor.questions[Number(target.dataset.index)].options[Number(target.dataset.option)] = target.value;
  }
});

document.addEventListener('change', (event) => {
  const target = event.target;
  if (target.matches('[data-editor-field]')) {
    const field = target.dataset.editorField;
    state.editor[field] = field === 'duration' ? Number(target.value) : target.value;
    updateEditorSummary();
  }
  if (target.matches('[data-question-field="type"]')) {
    const question = state.editor.questions[Number(target.dataset.index)];
    question.type = target.value;
    if (question.type === 'single') question.correct = [question.correct[0] ?? 0];
    render();
  }
  if (target.matches('[data-correct]')) {
    const question = state.editor.questions[Number(target.dataset.index)];
    const option = Number(target.dataset.option);
    if (question.type === 'single') question.correct = [option];
    else if (target.checked) question.correct = [...new Set([...question.correct, option])].sort();
    else question.correct = question.correct.filter((item) => item !== option);
  }
  if (target.matches('[data-image-input]') && target.files?.[0]) {
    const file = target.files[0];
    if (file.size > 3 * 1024 * 1024) return toast('Изображение должно быть меньше 3 МБ', 'error');
    const reader = new FileReader();
    reader.onload = () => { state.editor.questions[Number(target.dataset.index)].image = reader.result; render(); };
    reader.readAsDataURL(file);
  }
});

async function init() {
  if (!state.token) return renderAuth();
  state.loading = true;
  render();
  try {
    const data = await api('/api/me');
    state.user = data.user;
    await Promise.all([state.user.role === 'organizer' ? loadQuizzes() : Promise.resolve(), loadHistory()]);
  } catch {
    clearSession(false);
  } finally {
    state.loading = false;
    render();
  }
}

init();

