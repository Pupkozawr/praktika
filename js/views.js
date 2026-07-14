'use strict';

function renderAuth() {
  const register = state.authMode === 'register';
  app.innerHTML = `
    <div class="auth-page">
      <section class="auth-panel">
        ${brand()}
        <div class="auth-form-wrap">
          <p class="eyebrow">Добро пожаловать</p>
          <h1>${register ? 'Создайте аккаунт' : 'С возвращением!'}</h1>
          <p class="subtitle">${register ? 'Выберите роль и начните играть уже сегодня.' : 'Войдите, чтобы продолжить свой квиз.'}</p>
          <div class="auth-switch">
            <button class="${!register ? 'is-active' : ''}" data-action="auth-mode" data-mode="login">Вход</button>
            <button class="${register ? 'is-active' : ''}" data-action="auth-mode" data-mode="register">Регистрация</button>
          </div>
          <form class="form" data-form="auth">
            ${register ? `<div class="field"><label for="auth-name">Имя</label><input class="input" id="auth-name" name="name" autocomplete="name" placeholder="Как к вам обращаться?" required minlength="2"></div>` : ''}
            <div class="field"><label for="auth-email">Email</label><input class="input" id="auth-email" name="email" type="email" autocomplete="email" placeholder="name@example.com" required></div>
            <div class="field"><label for="auth-password">Пароль</label><input class="input" id="auth-password" name="password" type="password" autocomplete="${register ? 'new-password' : 'current-password'}" placeholder="Минимум 6 символов" required minlength="6"></div>
            ${register ? `<div class="field"><span class="label">Ваша роль</span><div class="role-options"><label class="role-option"><input type="radio" name="role" value="participant" checked><span>Я участник</span></label><label class="role-option"><input type="radio" name="role" value="organizer"><span>Я организатор</span></label></div></div>` : ''}
            <button class="button button--large button--wide" type="submit">${register ? 'Создать аккаунт' : 'Войти'} ${icon('arrow')}</button>
          </form>
          ${!register ? `<div class="demo-note">Демо: <button class="text-button" data-action="demo-login" data-email="host@quiz.local">организатор</button> или <button class="text-button" data-action="demo-login" data-email="player@quiz.local">участник</button>. Пароль: <code>demo123</code></div>` : ''}
        </div>
      </section>
      <aside class="auth-visual" aria-hidden="true">
        <div class="auth-badge"><span class="floating-dot"></span> Онлайн прямо сейчас<strong>24 игрока</strong></div>
        <div class="auth-visual-copy"><p class="eyebrow">Играй. Учись. Побеждай.</p><h2>Квизы, которые объединяют</h2><p>Создавайте яркие вопросы, приглашайте участников по коду и наблюдайте за результатами в реальном времени.</p></div>
      </aside>
    </div>`;
}

function renderLoading() {
  app.innerHTML = '<div class="boot-screen"><div class="loader" aria-label="Загрузка"></div></div>';
}

function quizCard(quiz) {
  return `
    <article class="card quiz-card">
      <div class="quiz-card-top"><span class="category-pill">${escapeHtml(quiz.category)}</span>${quiz.activeRooms ? '<span class="status-pill status-pill--live">● В эфире</span>' : ''}</div>
      <h3>${escapeHtml(quiz.title)}</h3>
      <p>${escapeHtml(quiz.description || 'Описание пока не добавлено.')}</p>
      <div class="quiz-meta"><span>${icon('quiz')} ${quiz.questions.length} ${plural(quiz.questions.length, ['вопрос', 'вопроса', 'вопросов'])}</span><span>${icon('clock')} ${quiz.duration} сек.</span></div>
      <div class="quiz-actions">
        <button class="button button--lime" data-action="launch-quiz" data-id="${quiz.id}">${icon('play')} Запустить</button>
        <button class="button button--secondary" data-action="edit-quiz" data-id="${quiz.id}" aria-label="Редактировать">${icon('edit')}</button>
        <button class="button button--ghost" data-action="delete-quiz" data-id="${quiz.id}" aria-label="Удалить">${icon('trash')}</button>
      </div>
    </article>`;
}

function renderOrganizerDashboard() {
  const sessions = state.history.length;
  const totalPlayers = state.history.reduce((sum, item) => sum + item.participantCount, 0);
  return shell(`
    <div class="page-head">
      <div><h1>Панель организатора</h1><p class="subtitle">Здесь можно создавать и запускать квизы.</p></div>
      <button class="button" data-action="new-quiz">${icon('plus')} Создать квиз</button>
    </div>
    <div class="simple-summary card">
      <span>Квизов: <strong>${state.quizzes.length}</strong></span>
      <span>Проведено игр: <strong>${sessions}</strong></span>
      <span>Участников: <strong>${totalPlayers}</strong></span>
    </div>
    <div class="section-head"><h2>Мои квизы</h2></div>
    ${state.quizzes.length ? `<div class="quiz-grid">${state.quizzes.map(quizCard).join('')}</div>` : renderEmptyQuizzes()}`);
}

function renderParticipantDashboard() {
  const completed = state.history.filter((item) => item.status === 'finished');
  return shell(`
    <div class="join-layout">
      <section class="join-panel">
        <h1>Подключение к квизу</h1>
        <p class="subtitle">Введите шестизначный код, который сообщил организатор.</p>
        <form class="card join-card form" data-form="join">
          <h2>Код комнаты</h2>
          <input class="code-input" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" aria-label="Шестизначный код комнаты" required>
          <button class="button button--large button--wide" type="submit">Присоединиться ${icon('arrow')}</button>
          <p class="field-hint">Профиль: <strong>${escapeHtml(state.user.name)}</strong>. Сыграно квизов: ${completed.length}.</p>
        </form>
      </section>
    </div>`);
}

function renderEmptyQuizzes() {
  return `<div class="card empty-state"><div class="empty-illustration">${icon('quiz')}</div><h2>Здесь появятся ваши квизы</h2><p>Создайте первый набор вопросов — на это понадобится всего несколько минут.</p><button class="button" data-action="new-quiz">${icon('plus')} Создать квиз</button></div>`;
}

function renderQuizzes() {
  return shell(`
    <div class="page-head"><div><p class="eyebrow">Библиотека</p><h1>Мои квизы</h1><p class="subtitle">Редактируйте наборы вопросов или запускайте новую комнату.</p></div><button class="button button--large" data-action="new-quiz">${icon('plus')} <span>Создать квиз</span></button></div>
    ${state.quizzes.length ? `<div class="quiz-grid">${state.quizzes.map(quizCard).join('')}</div>` : renderEmptyQuizzes()}`);
}

function newQuestion() {
  return { id: crypto.randomUUID(), text: '', image: '', type: 'single', options: ['', '', '', ''], correct: [0] };
}

function emptyQuiz() {
  return { title: '', description: '', category: 'Общие знания', duration: 30, rules: 'За каждый правильный ответ начисляется 1000 баллов и бонус за скорость.', questions: [newQuestion()] };
}

function renderQuestionEditor(question, index) {
  const controlType = question.type === 'single' ? 'radio' : 'checkbox';
  return `
    <article class="card question-card">
      <div class="question-head">
        <span class="question-number">${index + 1}</span>
        <h3>${escapeHtml(question.text || `Новый вопрос ${index + 1}`)}</h3>
        <button class="button button--danger" data-action="remove-question" data-index="${index}">${icon('trash')} Удалить</button>
      </div>
      <div class="question-body">
        <div class="field"><label for="question-${index}">Текст вопроса</label><textarea class="textarea" id="question-${index}" data-question-field="text" data-index="${index}" placeholder="Например: какая планета ближе всего к Солнцу?">${escapeHtml(question.text)}</textarea></div>
        <div class="field-row">
          <div class="field"><label>Тип ответа</label><select class="select" data-question-field="type" data-index="${index}"><option value="single" ${question.type === 'single' ? 'selected' : ''}>Один вариант</option><option value="multiple" ${question.type === 'multiple' ? 'selected' : ''}>Несколько вариантов</option></select></div>
          <div class="field"><span class="label">Изображение</span><label class="image-upload">${question.image ? `<img class="image-preview" src="${question.image}" alt="Превью вопроса"><button type="button" class="icon-button image-remove" data-action="remove-image" data-index="${index}">${icon('x')}</button>` : `<span>${icon('image')}Добавить изображение<br><small>PNG, JPG или WebP до 3 МБ</small></span>`}<input type="file" data-image-input data-index="${index}" accept="image/png,image/jpeg,image/webp"></label></div>
        </div>
        <div class="field"><span class="label">Варианты ответа</span><p class="field-hint">Отметьте правильный вариант слева.</p><div class="option-list">
          ${question.options.map((option, optionIndex) => `<div class="option-row"><label class="correct-check" title="Правильный ответ"><input type="${controlType}" name="correct-${index}" data-correct data-index="${index}" data-option="${optionIndex}" ${question.correct.includes(optionIndex) ? 'checked' : ''}><span>${icon('check')}</span></label><input class="input" data-option-field data-index="${index}" data-option="${optionIndex}" value="${escapeHtml(option)}" placeholder="Вариант ${letters[optionIndex]}"><button class="icon-button remove-option" type="button" data-action="remove-option" data-index="${index}" data-option="${optionIndex}" aria-label="Удалить вариант">${icon('x')}</button></div>`).join('')}
        </div></div>
        <button class="button button--ghost" type="button" data-action="add-option" data-index="${index}" ${question.options.length >= 6 ? 'disabled' : ''}>${icon('plus')} Добавить вариант</button>
      </div>
    </article>`;
}

function renderEditor() {
  const quiz = state.editor;
  if (!quiz) return renderLoading();
  const isEdit = Boolean(quiz.id);
  return shell(`
    <div class="page-head"><div><button class="button button--ghost" data-view="quizzes">${icon('back')} Назад к квизам</button><p class="eyebrow">${isEdit ? 'Редактирование' : 'Новый квиз'}</p><h1>${isEdit ? 'Настройка квиза' : 'Создание квиза'}</h1></div></div>
    <div class="editor-layout">
      <div class="editor-main">
        <section class="card editor-card">
          <div class="editor-card-head"><h2>Основная информация</h2><span class="category-pill">Шаг 1</span></div>
          <div class="form">
            <div class="field"><label for="quiz-title">Название</label><input class="input" id="quiz-title" data-editor-field="title" value="${escapeHtml(quiz.title)}" maxlength="100" placeholder="Название вашего квиза"></div>
            <div class="field"><label for="quiz-description">Описание</label><textarea class="textarea" id="quiz-description" data-editor-field="description" maxlength="500" placeholder="Коротко расскажите участникам, о чём этот квиз">${escapeHtml(quiz.description)}</textarea></div>
            <div class="field-row"><div class="field"><label for="quiz-category">Категория</label><input class="input" id="quiz-category" data-editor-field="category" value="${escapeHtml(quiz.category)}" maxlength="60"></div><div class="field"><label for="quiz-duration">Время на вопрос</label><select class="select" id="quiz-duration" data-editor-field="duration">${[10,15,20,30,45,60,90,120].map((value) => `<option value="${value}" ${Number(quiz.duration) === value ? 'selected' : ''}>${value} секунд</option>`).join('')}</select></div></div>
            <div class="field"><label for="quiz-rules">Правила</label><textarea class="textarea" id="quiz-rules" data-editor-field="rules" maxlength="700">${escapeHtml(quiz.rules)}</textarea></div>
          </div>
        </section>
        <div class="section-head"><h2>Вопросы</h2><span class="muted small">${quiz.questions.length} из 50</span></div>
        ${quiz.questions.map(renderQuestionEditor).join('')}
        <button class="add-question" data-action="add-question">＋ Добавить вопрос</button>
      </div>
      <aside class="editor-aside">
        <div class="card editor-summary"><h3>Параметры</h3><div class="summary-row"><span>Вопросов</span><strong data-summary="questions">${quiz.questions.length}</strong></div><div class="summary-row"><span>На вопрос</span><strong data-summary="duration">${quiz.duration} сек.</strong></div><div class="summary-row"><span>Общее время</span><strong data-summary="total">≈ ${Math.ceil(quiz.questions.length * quiz.duration / 60)} мин.</strong></div></div>
        <button class="button button--large button--wide" data-action="save-quiz">${icon('save')} ${isEdit ? 'Сохранить' : 'Создать квиз'}</button>
        <button class="button button--secondary button--wide" data-view="quizzes">Отмена</button>
      </aside>
    </div>`);
}

function renderHistory() {
  const organizer = state.user.role === 'organizer';
  return shell(`
    <div class="page-head"><div><p class="eyebrow">Личный кабинет</p><h1>${organizer ? 'История игр' : 'Мои результаты'}</h1><p class="subtitle">${organizer ? 'Результаты всех проведённых вами квизов.' : 'Ваши достижения и места в прошедших квизах.'}</p></div></div>
    ${state.history.length ? `<div class="history-list">${state.history.map((item) => `
      <article class="card history-item">
        <div class="history-icon">${icon(item.status === 'finished' ? 'trophy' : 'play')}</div>
        <div><div class="history-title">${escapeHtml(item.title)}</div><div class="history-subtitle">${escapeHtml(item.category)} · ${formatDate(item.endedAt || item.createdAt)} · код ${item.code}</div></div>
        <span class="status-pill ${item.status === 'finished' ? 'status-pill--done' : 'status-pill--live'}">${item.status === 'finished' ? 'Завершён' : 'Активен'}</span>
        <div class="history-result">${organizer ? `<strong>${item.participantCount}</strong><span class="small muted">${plural(item.participantCount, ['участник','участника','участников'])}</span>` : `<strong>${item.score} б.</strong><span class="small muted">${item.place ? `${item.place} место из ${item.participantCount}` : 'игра идёт'}</span>`}</div>
      </article>`).join('')}</div>` : `<div class="card empty-state"><div class="empty-illustration">${icon('history')}</div><h2>История пока пуста</h2><p>${organizer ? 'Проведите первый квиз, и здесь появится его результат.' : 'Присоединитесь к квизу, чтобы получить свой первый результат.'}</p><button class="button" data-view="dashboard">${organizer ? 'На главную' : 'Ввести код'}</button></div>`}`);
}

function roomTopbar(room) {
  return `<header class="room-topbar">${brand()}<div class="room-code-small"><span>Код комнаты</span><strong>${room.code}</strong><button class="icon-button" data-action="copy-code" aria-label="Скопировать код">${icon('copy')}</button></div><button class="button button--ghost" data-action="leave-room">Выйти</button></header>`;
}

function renderLobby(room) {
  return `
    <div class="lobby">
      <section class="lobby-code"><p class="eyebrow">Код для входа</p><div class="big-code">${room.code}</div><p>Участникам нужно открыть QuizFlow и ввести этот код.</p>${room.isHost ? `<button class="button button--lime button--large" data-action="room-start" ${room.participants.length === 0 ? 'disabled' : ''}>${icon('play')} Начать квиз</button>` : '<p class="waiting">Организатор скоро начнёт игру<span class="waiting-dots"></span></p>'}</section>
      <section class="lobby-players"><div class="lobby-players-head"><h2>Участники</h2><span class="player-count">${room.participants.length}</span></div><div class="player-list">${room.participants.map((player) => `<span class="player-chip">${escapeHtml(player.name)}</span>`).join('')}</div>${!room.participants.length ? '<p class="waiting">Ждём первых игроков<span class="waiting-dots"></span></p>' : ''}</section>
    </div>`;
}

function leaderboard(room, limit = 8) {
  if (!room.participants.length) return '<p class="muted small">Участников пока нет</p>';
  return `<div class="leaderboard">${room.participants.slice(0, limit).map((player, index) => `<div class="leader-row"><span class="leader-place">${index + 1}</span><span class="leader-name">${escapeHtml(player.name)}</span><span class="leader-score"><strong>${player.score}</strong> б.</span></div>`).join('')}</div>`;
}

function renderQuestion(room) {
  const question = room.question;
  const submitted = room.me?.answer;
  const selected = submitted ? submitted.selected : state.selected;
  const isResults = room.phase === 'results';
  const options = question.options.map((option, index) => {
    const chosen = selected.includes(index);
    const correct = isResults && question.correct?.includes(index);
    const wrong = isResults && chosen && !correct;
    return `<button class="answer-option ${chosen ? 'is-selected' : ''} ${correct ? 'is-correct' : ''} ${wrong ? 'is-wrong' : ''}" data-action="select-answer" data-index="${index}" ${room.isHost || submitted || isResults ? 'disabled' : ''}><span class="answer-letter">${letters[index]}</span><span>${escapeHtml(option)}</span></button>`;
  }).join('');
  let resultBanner = '';
  if (isResults && !room.isHost) {
    const good = room.me?.answer?.isCorrect;
    resultBanner = room.me?.answer
      ? `<div class="result-banner ${good ? '' : 'result-banner--wrong'}"><span class="result-icon">${icon(good ? 'check' : 'x')}</span><div><strong>${good ? 'Верно!' : 'Не в этот раз'}</strong><span>${good ? `+${room.me.answer.points} баллов` : 'Правильный ответ отмечен зелёным'}</span></div></div>`
      : `<div class="result-banner result-banner--wrong"><span class="result-icon">${icon('clock')}</span><div><strong>Время вышло</strong><span>Ответ не был отправлен</span></div></div>`;
  }
  const last = room.questionIndex === room.quiz.questionCount - 1;
  return `
    <div class="question-stage">
      <section class="question-panel">
        <div class="question-progress"><span>Вопрос ${room.questionIndex + 1} из ${room.quiz.questionCount}</span><div class="progress-line"><span style="width:${(room.questionIndex + 1) / room.quiz.questionCount * 100}%"></span></div><span>${escapeHtml(room.quiz.category)}</span></div>
        ${resultBanner}
        <h1 class="question-title">${escapeHtml(question.text)}</h1>
        ${question.image ? `<img class="question-image" src="${question.image}" alt="Иллюстрация к вопросу">` : ''}
        <div class="answer-grid">${options}</div>
        ${!room.isHost && !submitted && !isResults ? `<button class="button button--large button--wide answer-submit" data-action="submit-answer" ${!state.selected.length ? 'disabled' : ''}>Ответить ${icon('arrow')}</button>` : ''}
        ${!room.isHost && submitted && !isResults ? '<div class="result-banner answer-submit"><span class="result-icon">✓</span><div><strong>Ответ принят</strong><span>Ждём остальных участников</span></div></div>' : ''}
      </section>
      <aside class="question-side">
        ${!isResults ? `<div class="timer-card"><div class="timer-ring" data-timer-ring><strong class="timer-value" data-timer-value>—</strong></div><span class="timer-label">секунд осталось</span></div>` : `<div class="room-side-card"><p class="eyebrow">Текущий рейтинг</p>${leaderboard(room, 5)}</div>`}
        <div class="room-side-card"><div class="side-stat"><span>Ответили</span><strong>${room.answerCount}/${room.participants.length}</strong></div><div class="side-stat"><span>${room.isHost ? 'Вопрос' : 'Ваши баллы'}</span><strong>${room.isHost ? `${room.questionIndex + 1}/${room.quiz.questionCount}` : room.me?.score || 0}</strong></div></div>
        ${room.isHost ? `<button class="button button--lime button--large button--wide" data-action="room-next">${isResults ? (last ? 'Показать итоги' : 'Следующий вопрос') : 'Завершить вопрос'} ${icon('arrow')}</button><button class="button button--ghost button--wide" data-action="room-finish">Завершить квиз</button>` : (isResults ? '<p class="waiting">Ждём следующий вопрос<span class="waiting-dots"></span></p>' : '')}
      </aside>
    </div>`;
}

function renderFinished(room) {
  const top = room.participants.slice(0, 3);
  return `
    <section class="finish-screen"><p class="eyebrow">Квиз завершён</p><h1>Вот это игра!</h1><p>Поздравляем победителей квиза «${escapeHtml(room.quiz.title)}»</p>
      <div class="podium">${top.map((player, index) => `<div class="podium-item podium-item--${index + 1}"><div class="podium-avatar">${escapeHtml(player.name.charAt(0).toUpperCase())}</div><div class="podium-name">${escapeHtml(player.name)}</div><div class="podium-block"><strong>${index + 1}</strong><span>${player.score} б.</span></div></div>`).join('')}</div>
      ${!top.length ? '<p>В этой игре пока нет результатов.</p>' : ''}
      <div class="finish-actions"><button class="button button--lime button--large" data-action="leave-room">${room.isHost ? 'В панель управления' : 'Мои результаты'}</button></div>
    </section>`;
}

