'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'database.json');
const MAX_BODY = 6 * 1024 * 1024;

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const now = () => new Date().toISOString();
const makeId = () => crypto.randomUUID();
const clone = (value) => JSON.parse(JSON.stringify(value));

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, original] = String(stored).split(':');
  if (!salt || !original) return false;
  const candidate = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(original, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function seedDatabase() {
  const hostId = makeId();
  const playerId = makeId();
  const quizId = makeId();
  return {
    users: [
      {
        id: hostId,
        name: 'Организатор',
        email: 'host@quiz.local',
        passwordHash: hashPassword('demo123'),
        role: 'organizer',
        createdAt: now()
      },
      {
        id: playerId,
        name: 'Участник',
        email: 'player@quiz.local',
        passwordHash: hashPassword('demo123'),
        role: 'participant',
        createdAt: now()
      }
    ],
    quizzes: [
      {
        id: quizId,
        ownerId: hostId,
        title: 'Разминка: мир вокруг нас',
        description: 'Небольшой демонстрационный квиз, с которого удобно начать.',
        category: 'Общие знания',
        duration: 30,
        rules: 'Отвечайте быстро: за скорость начисляются дополнительные баллы.',
        questions: [
          {
            id: makeId(),
            text: 'Какая планета находится ближе всего к Солнцу?',
            image: '',
            type: 'single',
            options: ['Венера', 'Меркурий', 'Марс', 'Земля'],
            correct: [1]
          },
          {
            id: makeId(),
            text: 'Какие из этих языков выполняются непосредственно в браузере?',
            image: '',
            type: 'multiple',
            options: ['JavaScript', 'CSS', 'Python', 'HTML'],
            correct: [0]
          },
          {
            id: makeId(),
            text: 'Сколько минут в двух с половиной часах?',
            image: '',
            type: 'single',
            options: ['120', '130', '150', '180'],
            correct: [2]
          }
        ],
        createdAt: now(),
        updatedAt: now()
      }
    ],
    sessions: []
  };
}

function loadDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    const initial = seedDatabase();
    fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2), 'utf8');
    return initial;
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
    parsed.users ||= [];
    parsed.quizzes ||= [];
    parsed.sessions ||= [];
    return parsed;
  } catch (error) {
    console.error('Не удалось прочитать базу данных:', error.message);
    process.exit(1);
  }
}

let db = loadDatabase();
const authTokens = new Map();
const roomClients = new Map();
const roomTimers = new Map();

function persist() {
  const temp = `${DB_FILE}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), 'utf8');
  fs.renameSync(temp, DB_FILE);
}

function safeUser(user) {
  return user && {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    createdAt: user.createdAt
  };
}

function issueToken(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  authTokens.set(token, { userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  return token;
}

function userFromToken(token) {
  const session = authTokens.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (session) authTokens.delete(token);
    return null;
  }
  return db.users.find((user) => user.id === session.userId) || null;
}

function getBearer(req) {
  const value = req.headers.authorization || '';
  return value.startsWith('Bearer ') ? value.slice(7) : '';
}

function requireUser(req, role) {
  const user = userFromToken(getBearer(req));
  if (!user) throw new HttpError(401, 'Сначала войдите в аккаунт');
  if (role && user.role !== role) throw new HttpError(403, 'Недостаточно прав для этого действия');
  return user;
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Изображение или запрос слишком большой'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Некорректный JSON в запросе'));
      }
    });
    req.on('error', reject);
  });
}

function cleanText(value, max = 500) {
  return String(value ?? '').trim().slice(0, max);
}

function validateQuiz(input, ownerId, existing = null) {
  const title = cleanText(input.title, 100);
  const description = cleanText(input.description, 500);
  const category = cleanText(input.category, 60) || 'Без категории';
  const rules = cleanText(input.rules, 700);
  const duration = Math.min(120, Math.max(10, Number(input.duration) || 30));
  if (!title) throw new HttpError(400, 'Укажите название квиза');
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new HttpError(400, 'Добавьте хотя бы один вопрос');
  }
  if (input.questions.length > 50) throw new HttpError(400, 'В одном квизе может быть не более 50 вопросов');

  const questions = input.questions.map((question, questionIndex) => {
    const text = cleanText(question.text, 500);
    const image = String(question.image || '');
    const type = question.type === 'multiple' ? 'multiple' : 'single';
    if (!text && !image) throw new HttpError(400, `Заполните вопрос №${questionIndex + 1}`);
    if (image && (!image.startsWith('data:image/') || image.length > 4_500_000)) {
      throw new HttpError(400, `Некорректное или слишком большое изображение в вопросе №${questionIndex + 1}`);
    }
    if (!Array.isArray(question.options) || question.options.length < 2 || question.options.length > 6) {
      throw new HttpError(400, `В вопросе №${questionIndex + 1} должно быть от 2 до 6 вариантов`);
    }
    const options = question.options.map((option) => cleanText(option, 180));
    if (options.some((option) => !option)) throw new HttpError(400, `Заполните все варианты вопроса №${questionIndex + 1}`);
    const correct = [...new Set((question.correct || []).map(Number))]
      .filter((index) => Number.isInteger(index) && index >= 0 && index < options.length)
      .sort((a, b) => a - b);
    if (!correct.length) throw new HttpError(400, `Отметьте правильный ответ в вопросе №${questionIndex + 1}`);
    if (type === 'single' && correct.length !== 1) {
      throw new HttpError(400, `В вопросе №${questionIndex + 1} с одиночным выбором нужен один правильный ответ`);
    }
    return { id: question.id || makeId(), text, image, type, options, correct };
  });

  return {
    id: existing?.id || makeId(),
    ownerId,
    title,
    description,
    category,
    duration,
    rules,
    questions,
    createdAt: existing?.createdAt || now(),
    updatedAt: now()
  };
}

function makeRoomCode() {
  let code;
  do code = String(crypto.randomInt(100000, 1000000));
  while (db.sessions.some((session) => session.code === code && session.status !== 'finished'));
  return code;
}

function getRoom(code) {
  return db.sessions.find((session) => session.code === code && session.status !== 'archived');
}

function participantList(room) {
  return Object.values(room.participants || {}).sort((a, b) => b.score - a.score || a.joinedAt.localeCompare(b.joinedAt));
}

function publicRoom(room, user) {
  const isHost = room.hostId === user.id;
  const participant = room.participants?.[user.id] || null;
  const quiz = room.quiz;
  const rawQuestion = room.questionIndex >= 0 ? quiz.questions[room.questionIndex] : null;
  let question = null;
  if (rawQuestion) {
    question = {
      id: rawQuestion.id,
      text: rawQuestion.text,
      image: rawQuestion.image,
      type: rawQuestion.type,
      options: rawQuestion.options
    };
    if (room.phase === 'results' || room.phase === 'finished' || isHost) question.correct = rawQuestion.correct;
  }
  const questionAnswers = room.answers?.[room.questionIndex] || {};
  return {
    code: room.code,
    status: room.status,
    phase: room.phase,
    isHost,
    quiz: {
      id: quiz.id,
      title: quiz.title,
      description: quiz.description,
      category: quiz.category,
      duration: quiz.duration,
      rules: quiz.rules,
      questionCount: quiz.questions.length
    },
    questionIndex: room.questionIndex,
    questionEndsAt: room.questionEndsAt,
    question,
    answerCount: Object.keys(questionAnswers).length,
    participants: participantList(room).map((item) => ({
      userId: item.userId,
      name: item.name,
      score: item.score,
      answered: Boolean(questionAnswers[item.userId])
    })),
    me: participant ? {
      score: participant.score,
      answer: questionAnswers[user.id] || null
    } : null,
    createdAt: room.createdAt,
    endedAt: room.endedAt || null
  };
}

function setRoomTimer(room) {
  const oldTimer = roomTimers.get(room.code);
  if (oldTimer) clearTimeout(oldTimer);
  roomTimers.delete(room.code);
  if (room.phase !== 'question' || !room.questionEndsAt) return;
  const delay = Math.max(0, new Date(room.questionEndsAt).getTime() - Date.now());
  const timer = setTimeout(() => closeQuestion(room.code), Math.min(delay, 2_147_000_000));
  roomTimers.set(room.code, timer);
}

function closeQuestion(code) {
  const room = getRoom(code);
  if (!room || room.phase !== 'question') return;
  room.phase = 'results';
  room.questionEndsAt = null;
  persist();
  broadcastRoom(code, 'room:state');
}

function finishRoom(room) {
  room.phase = 'finished';
  room.status = 'finished';
  room.questionEndsAt = null;
  room.endedAt = now();
  const timer = roomTimers.get(room.code);
  if (timer) clearTimeout(timer);
  roomTimers.delete(room.code);
  persist();
  broadcastRoom(room.code, 'room:state');
}

function startQuestion(room, index) {
  if (index >= room.quiz.questions.length) return finishRoom(room);
  room.status = 'active';
  room.phase = 'question';
  room.questionIndex = index;
  room.questionEndsAt = new Date(Date.now() + room.quiz.duration * 1000).toISOString();
  room.answers[index] ||= {};
  persist();
  setRoomTimer(room);
  broadcastRoom(room.code, 'room:state');
}

function equalAnswers(selected, correct) {
  if (selected.length !== correct.length) return false;
  return selected.every((value, index) => value === correct[index]);
}

function historyFor(user) {
  if (user.role === 'organizer') {
    return db.sessions
      .filter((session) => session.hostId === user.id)
      .map((session) => ({
        id: session.id,
        code: session.code,
        title: session.quiz.title,
        category: session.quiz.category,
        status: session.status,
        participantCount: Object.keys(session.participants || {}).length,
        winner: participantList(session)[0] || null,
        createdAt: session.createdAt,
        endedAt: session.endedAt || null
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  return db.sessions
    .filter((session) => session.participants?.[user.id])
    .map((session) => {
      const leaders = participantList(session);
      const place = leaders.findIndex((item) => item.userId === user.id) + 1;
      return {
        id: session.id,
        code: session.code,
        title: session.quiz.title,
        category: session.quiz.category,
        status: session.status,
        score: session.participants[user.id].score,
        place: place || null,
        participantCount: leaders.length,
        createdAt: session.createdAt,
        endedAt: session.endedAt || null
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

async function handleApi(req, res, url) {
  const method = req.method;
  const pathname = url.pathname;

  if (method === 'GET' && pathname === '/api/health') return json(res, 200, { ok: true, time: now() });

  if (method === 'POST' && pathname === '/api/register') {
    const body = await readBody(req);
    const name = cleanText(body.name, 80);
    const email = cleanText(body.email, 120).toLowerCase();
    const password = String(body.password || '');
    const role = body.role === 'organizer' ? 'organizer' : 'participant';
    if (name.length < 2) throw new HttpError(400, 'Имя должно содержать не менее 2 символов');
    if (!/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Введите корректный email');
    if (password.length < 6) throw new HttpError(400, 'Пароль должен содержать не менее 6 символов');
    if (db.users.some((user) => user.email === email)) throw new HttpError(409, 'Пользователь с таким email уже существует');
    const user = { id: makeId(), name, email, passwordHash: hashPassword(password), role, createdAt: now() };
    db.users.push(user);
    persist();
    return json(res, 201, { token: issueToken(user.id), user: safeUser(user) });
  }

  if (method === 'POST' && pathname === '/api/login') {
    const body = await readBody(req);
    const email = cleanText(body.email, 120).toLowerCase();
    const user = db.users.find((item) => item.email === email);
    if (!user || !verifyPassword(String(body.password || ''), user.passwordHash)) {
      throw new HttpError(401, 'Неверный email или пароль');
    }
    return json(res, 200, { token: issueToken(user.id), user: safeUser(user) });
  }

  if (method === 'POST' && pathname === '/api/logout') {
    authTokens.delete(getBearer(req));
    return json(res, 200, { ok: true });
  }

  if (method === 'GET' && pathname === '/api/me') {
    return json(res, 200, { user: safeUser(requireUser(req)) });
  }

  if (method === 'GET' && pathname === '/api/quizzes') {
    const user = requireUser(req, 'organizer');
    const quizzes = db.quizzes
      .filter((quiz) => quiz.ownerId === user.id)
      .map((quiz) => ({ ...quiz, activeRooms: db.sessions.filter((room) => room.quiz.id === quiz.id && room.status !== 'finished').length }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return json(res, 200, { quizzes });
  }

  if (method === 'POST' && pathname === '/api/quizzes') {
    const user = requireUser(req, 'organizer');
    const quiz = validateQuiz(await readBody(req), user.id);
    db.quizzes.push(quiz);
    persist();
    return json(res, 201, { quiz });
  }

  const quizMatch = pathname.match(/^\/api\/quizzes\/([\w-]+)$/);
  if (quizMatch) {
    const user = requireUser(req, 'organizer');
    const quizIndex = db.quizzes.findIndex((quiz) => quiz.id === quizMatch[1] && quiz.ownerId === user.id);
    if (quizIndex < 0) throw new HttpError(404, 'Квиз не найден');
    if (method === 'GET') return json(res, 200, { quiz: db.quizzes[quizIndex] });
    if (method === 'PUT') {
      const quiz = validateQuiz(await readBody(req), user.id, db.quizzes[quizIndex]);
      db.quizzes[quizIndex] = quiz;
      persist();
      return json(res, 200, { quiz });
    }
    if (method === 'DELETE') {
      db.quizzes.splice(quizIndex, 1);
      persist();
      return json(res, 200, { ok: true });
    }
  }

  const launchMatch = pathname.match(/^\/api\/quizzes\/([\w-]+)\/launch$/);
  if (method === 'POST' && launchMatch) {
    const user = requireUser(req, 'organizer');
    const quiz = db.quizzes.find((item) => item.id === launchMatch[1] && item.ownerId === user.id);
    if (!quiz) throw new HttpError(404, 'Квиз не найден');
    const room = {
      id: makeId(),
      code: makeRoomCode(),
      hostId: user.id,
      quiz: clone(quiz),
      status: 'lobby',
      phase: 'lobby',
      questionIndex: -1,
      questionEndsAt: null,
      participants: {},
      answers: {},
      createdAt: now(),
      endedAt: null
    };
    db.sessions.push(room);
    persist();
    return json(res, 201, { room: publicRoom(room, user) });
  }

  if (method === 'POST' && pathname === '/api/rooms/join') {
    const user = requireUser(req, 'participant');
    const body = await readBody(req);
    const code = cleanText(body.code, 6);
    const room = getRoom(code);
    if (!room || room.status === 'finished') throw new HttpError(404, 'Активная комната с таким кодом не найдена');
    if (!room.participants[user.id]) {
      room.participants[user.id] = { userId: user.id, name: user.name, score: 0, joinedAt: now() };
      persist();
      broadcastRoom(code, 'room:state');
    }
    return json(res, 200, { room: publicRoom(room, user) });
  }

  const roomMatch = pathname.match(/^\/api\/rooms\/(\d{6})$/);
  if (method === 'GET' && roomMatch) {
    const user = requireUser(req);
    const room = getRoom(roomMatch[1]);
    if (!room) throw new HttpError(404, 'Комната не найдена');
    if (room.hostId !== user.id && !room.participants?.[user.id]) throw new HttpError(403, 'Сначала подключитесь к комнате');
    return json(res, 200, { room: publicRoom(room, user) });
  }

  const actionMatch = pathname.match(/^\/api\/rooms\/(\d{6})\/(start|next|finish|answer)$/);
  if (method === 'POST' && actionMatch) {
    const user = requireUser(req);
    const room = getRoom(actionMatch[1]);
    if (!room) throw new HttpError(404, 'Комната не найдена');
    const action = actionMatch[2];

    if (action === 'answer') {
      if (!room.participants?.[user.id]) throw new HttpError(403, 'Вы не являетесь участником этой комнаты');
      if (room.phase !== 'question' || !room.questionEndsAt || Date.now() >= new Date(room.questionEndsAt).getTime()) {
        throw new HttpError(409, 'Время ответа на этот вопрос закончилось');
      }
      const body = await readBody(req);
      const question = room.quiz.questions[room.questionIndex];
      const selected = [...new Set((body.selected || []).map(Number))]
        .filter((index) => Number.isInteger(index) && index >= 0 && index < question.options.length)
        .sort((a, b) => a - b);
      if (!selected.length) throw new HttpError(400, 'Выберите хотя бы один вариант');
      if (question.type === 'single' && selected.length !== 1) throw new HttpError(400, 'Выберите один вариант ответа');
      room.answers[room.questionIndex] ||= {};
      if (room.answers[room.questionIndex][user.id]) throw new HttpError(409, 'Ответ уже принят');
      const isCorrect = equalAnswers(selected, question.correct);
      const remaining = Math.max(0, new Date(room.questionEndsAt).getTime() - Date.now());
      const speedBonus = isCorrect ? Math.round(500 * remaining / (room.quiz.duration * 1000)) : 0;
      const points = isCorrect ? 1000 + speedBonus : 0;
      room.answers[room.questionIndex][user.id] = { selected, isCorrect, points, answeredAt: now() };
      room.participants[user.id].score += points;
      persist();
      broadcastRoom(room.code, 'room:state');
      const joined = Object.keys(room.participants).length;
      const answered = Object.keys(room.answers[room.questionIndex]).length;
      if (joined > 0 && answered >= joined) closeQuestion(room.code);
      return json(res, 200, { answer: room.answers[room.questionIndex][user.id] });
    }

    if (room.hostId !== user.id) throw new HttpError(403, 'Управлять квизом может только организатор');
    if (action === 'start') {
      if (room.phase !== 'lobby') throw new HttpError(409, 'Квиз уже запущен');
      startQuestion(room, 0);
      return json(res, 200, { room: publicRoom(room, user) });
    }
    if (action === 'next') {
      if (room.phase === 'question') closeQuestion(room.code);
      else if (room.phase === 'results') startQuestion(room, room.questionIndex + 1);
      else throw new HttpError(409, 'Сейчас нельзя перейти к следующему вопросу');
      return json(res, 200, { room: publicRoom(room, user) });
    }
    if (action === 'finish') {
      if (room.status !== 'finished') finishRoom(room);
      return json(res, 200, { room: publicRoom(room, user) });
    }
  }

  if (method === 'GET' && pathname === '/api/history') {
    const user = requireUser(req);
    return json(res, 200, { history: historyFor(user) });
  }

  throw new HttpError(404, 'Маршрут API не найден');
}

const publicFiles = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/index.html', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/js/core.js', ['js/core.js', 'text/javascript; charset=utf-8']],
  ['/js/views.js', ['js/views.js', 'text/javascript; charset=utf-8']],
  ['/js/app.js', ['js/app.js', 'text/javascript; charset=utf-8']],
  ['/mockups.html', ['mockups.html', 'text/html; charset=utf-8']],
  ['/presentation.html', ['presentation.html', 'text/html; charset=utf-8']],
  ['/QuizFlow_Presentation.pdf', ['QuizFlow_Presentation.pdf', 'application/pdf']],
  ['/QuizFlow_Mockups.pdf', ['Макеты.pdf', 'application/pdf']],
  ['/favicon.svg', ['favicon.svg', 'image/svg+xml']],
  ['/fonts/Roboto.woff2', ['fonts/Roboto.woff2', 'font/woff2']]
]);

function serveStatic(req, res, pathname) {
  const entry = publicFiles.get(pathname) || publicFiles.get('/');
  const filePath = path.join(ROOT, entry[0]);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Файл не найден');
    }
    res.writeHead(200, {
      'Content-Type': entry[1],
      'Content-Length': contents.length,
      'Cache-Control': pathname.startsWith('/fonts/') || pathname === '/favicon.svg'
        ? 'public, max-age=3600'
        : 'no-cache'
    });
    res.end(contents);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') serveStatic(req, res, url.pathname);
    else throw new HttpError(405, 'Метод не поддерживается');
  } catch (error) {
    if (!res.headersSent) json(res, error.status || 500, { error: error.status ? error.message : 'Внутренняя ошибка сервера' });
    if (!error.status) console.error(error);
  }
});

function wsFrame(payload, opcode = 0x1) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(String(payload));
  let header;
  if (data.length < 126) {
    header = Buffer.from([0x80 | opcode, data.length]);
  } else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(data.length), 2);
  }
  return Buffer.concat([header, data]);
}

function sendWs(client, payload) {
  if (!client.socket.destroyed && client.socket.writable) {
    client.socket.write(wsFrame(JSON.stringify(payload)));
  }
}

function removeWsClient(client) {
  const clients = roomClients.get(client.code);
  if (!clients) return;
  clients.delete(client);
  if (!clients.size) roomClients.delete(client.code);
}

function broadcastRoom(code, type) {
  const room = getRoom(code);
  const clients = roomClients.get(code);
  if (!room || !clients) return;
  for (const client of clients) {
    const user = db.users.find((item) => item.id === client.userId);
    if (user) sendWs(client, { type, room: publicRoom(room, user) });
  }
}

function consumeWsFrames(client, chunk) {
  client.buffer = Buffer.concat([client.buffer, chunk]);
  while (client.buffer.length >= 2) {
    const first = client.buffer[0];
    const second = client.buffer[1];
    const opcode = first & 0x0f;
    const masked = Boolean(second & 0x80);
    let length = second & 0x7f;
    let offset = 2;
    if (length === 126) {
      if (client.buffer.length < 4) return;
      length = client.buffer.readUInt16BE(2);
      offset = 4;
    } else if (length === 127) {
      if (client.buffer.length < 10) return;
      const bigLength = client.buffer.readBigUInt64BE(2);
      if (bigLength > BigInt(MAX_BODY)) return client.socket.destroy();
      length = Number(bigLength);
      offset = 10;
    }
    const maskSize = masked ? 4 : 0;
    if (client.buffer.length < offset + maskSize + length) return;
    let payload = client.buffer.subarray(offset + maskSize, offset + maskSize + length);
    if (masked) {
      const mask = client.buffer.subarray(offset, offset + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    }
    client.buffer = client.buffer.subarray(offset + maskSize + length);
    if (opcode === 0x8) {
      client.socket.end(wsFrame('', 0x8));
      return;
    }
    if (opcode === 0x9) client.socket.write(wsFrame(payload, 0xA));
  }
}

server.on('upgrade', (req, socket) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/ws') throw new Error('Not found');
    const user = userFromToken(url.searchParams.get('token') || '');
    const code = url.searchParams.get('room') || '';
    const room = getRoom(code);
    if (!user || !room || (room.hostId !== user.id && !room.participants?.[user.id])) throw new Error('Unauthorized');
    const key = req.headers['sec-websocket-key'];
    if (!key) throw new Error('Bad handshake');
    const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write([
      'HTTP/1.1 101 Switching Protocols',
      'Upgrade: websocket',
      'Connection: Upgrade',
      `Sec-WebSocket-Accept: ${accept}`,
      '\r\n'
    ].join('\r\n'));
    const client = { socket, userId: user.id, code, buffer: Buffer.alloc(0) };
    if (!roomClients.has(code)) roomClients.set(code, new Set());
    roomClients.get(code).add(client);
    socket.on('data', (chunk) => consumeWsFrames(client, chunk));
    socket.on('close', () => removeWsClient(client));
    socket.on('error', () => removeWsClient(client));
    sendWs(client, { type: 'room:state', room: publicRoom(room, user) });
  } catch {
    socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
    socket.destroy();
  }
});

for (const room of db.sessions) {
  if (room.phase === 'question') {
    if (new Date(room.questionEndsAt).getTime() <= Date.now()) closeQuestion(room.code);
    else setRoomTimer(room);
  }
}

server.listen(PORT, HOST, () => {
  console.log(`QuizFlow запущен: http://localhost:${PORT}`);
  console.log('Демо-организатор: host@quiz.local / demo123');
  console.log('Демо-участник: player@quiz.local / demo123');
});
