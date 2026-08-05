const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const http     = require('http');
const { Server } = require('socket.io');

const app  = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/attendance';

// ── Middleware ──────────────────────────────────────
app.use(cors());
app.use(express.json());

io.on('connection', (socket) => {
  socket.on('join_teacher_room', (teacherId) => {
    if (teacherId) socket.join(teacherId);
  });
});

// ── MongoDB Schema ──────────────────────────────────
const sessionSchema = new mongoose.Schema({
  submittedAt:   { type: Date, default: Date.now },
  date:          String,
  class:         String,
  subject:       String,
  group:         String,
  periods:       [Number],
  timeTable:     String,
  periodSlot:    String,
  specialization: String,
  totalStudents: Number,
  presentCount:  Number,
  absentRolls:   [String],
  allStudents: [{
    roll:   String,
    name:   String,
    status: { type: String, enum: ['P', 'A'] }
  }]
}, { timestamps: true });

const Session = mongoose.model('Session', sessionSchema);

const taskSchema = new mongoose.Schema({
  teacherId:   { type: String, default: 'default', index: true },
  title:       { type: String, required: true },
  description: { type: String, default: '' },
  completed:   { type: Boolean, default: false },
  priority:    { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
  dueDate:     { type: String, default: '' }
}, { timestamps: true });

const Task = mongoose.model('Task', taskSchema);

// ── Routes ──────────────────────────────────────────

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: 'Attendance server running' });
});

// Save session
app.post('/api/session', async (req, res) => {
  try {
    const {
      config,
      totalStudents,
      presentCount,
      absentRolls,
      allStudents,
      submittedAt
    } = req.body;

    const info = config?.info || {};

    const session = new Session({
      submittedAt:   submittedAt ? new Date(submittedAt) : new Date(),
      date:          info.date          || '',
      class:         info.class         || '',
      subject:       info.subject       || '',
      group:         info.group         || '',
      periods:       info.period        || [],
      timeTable:     info.timeTable     || '',
      periodSlot:    info.periodSlot    || '',
      specialization: info.specialization || '',
      totalStudents: totalStudents      ?? 0,
      presentCount:  presentCount       ?? 0,
      absentRolls:   absentRolls        || [],
      allStudents:   allStudents        || []
    });

    await session.save();
    res.status(201).json({ success: true, id: session._id });
  } catch (err) {
    console.error('Save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Get all sessions (newest first)
app.get('/api/sessions', async (req, res) => {
  try {
    const sessions = await Session.find()
      .sort({ submittedAt: -1 })
      .limit(200)
      .lean();
    res.json(sessions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Task Routes ─────────────────────────────────────

app.get('/api/tasks', async (req, res) => {
  try {
    const { teacherId = 'default' } = req.query;
    const tasks = await Task.find({ teacherId }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tasks', async (req, res) => {
  try {
    const { teacherId = 'default', title, description = '', priority = 'medium', dueDate = '' } = req.body;
    if (!title || !title.trim()) return res.status(400).json({ success: false, error: 'Title required' });
    const task = new Task({ teacherId, title: title.trim(), description: description.trim(), priority, dueDate });
    await task.save();
    io.to(teacherId).emit('task_created', task);
    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.put('/api/tasks/:id', async (req, res) => {
  try {
    const { title, description, completed, priority, dueDate } = req.body;
    const updateData = {};
    if (typeof title === 'string') updateData.title = title.trim();
    if (typeof description === 'string') updateData.description = description.trim();
    if (typeof completed === 'boolean') updateData.completed = completed;
    if (priority) updateData.priority = priority;
    if (typeof dueDate === 'string') updateData.dueDate = dueDate;

    const task = await Task.findByIdAndUpdate(req.params.id, updateData, { new: true }).lean();
    if (!task) return res.status(404).json({ error: 'Task not found' });
    io.to(task.teacherId || 'default').emit('task_updated', task);
    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    io.to(task.teacherId || 'default').emit('task_deleted', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Connect & Start ─────────────────────────────────
mongoose.connect(MONGO_URI)
  .then(() => {
    console.log(`✅ MongoDB connected: ${MONGO_URI}`);
    httpServer.listen(PORT, () => {
      console.log(`🚀 Server running at http://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('❌ MongoDB connection failed:', err.message);
    process.exit(1);
  });
