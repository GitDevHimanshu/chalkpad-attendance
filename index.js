require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 10000;
const MONGO_URI = process.env.MONGO_URI;

app.use(cors());
app.use(express.json());

// ── Socket.io Connection & Rooms ────────────────────────────
io.on('connection', (socket) => {
  socket.on('join_teacher_room', (teacherId) => {
    if (teacherId) {
      socket.join(teacherId);
      console.log(`[Socket] Client ${socket.id} joined room: ${teacherId}`);
    }
  });
});

// ── Schema ──────────────────────────────────────────────────
const sessionSchema = new mongoose.Schema(
  {
    teacherId: { type: String, default: 'default' },
    submittedAt: { type: Date, default: Date.now },
    date: { type: String, default: '' },
    class: { type: String, default: '' },
    subject: { type: String, default: '' },
    group: { type: String, default: '' },
    periods: { type: [Number], default: [] },
    timeTable: { type: String, default: '' },
    periodSlot: { type: String, default: '' },
    specialization: { type: String, default: '' },
    totalStudents: { type: Number, default: 0 },
    presentCount: { type: Number, default: 0 },
    absentRolls: { type: [String], default: [] },
    allStudents: [
      {
        roll: String,
        name: String,
        status: { type: String, enum: ['P', 'A'] }
      }
    ]
  },
);

const Session = mongoose.model('Session', sessionSchema);

const Task = mongoose.model('Task', new mongoose.Schema(
  {
    teacherId: { type: String, required: true, default: 'default', index: true },
    title: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    completed: { type: Boolean, default: false },
    priority: { type: String, enum: ['low', 'medium', 'high'], default: 'medium' },
    dueDate: { type: String, default: '' }
  },
  { timestamps: true }
));

// ── Routes ──────────────────────────────────────────────────

app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    message: 'Haziri Server is active.',
    dbStatus: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected'
  });
});

// POST — save a session
app.post('/api/session', async (req, res) => {
  try {
    const { config, totalStudents, presentCount, absentRolls, allStudents, submittedAt, teacherId } = req.body;
    const info = config?.info || {};

    const session = new Session({
      teacherId: teacherId || 'default',
      submittedAt: submittedAt ? new Date(submittedAt) : new Date(),
      date: info.date || '',
      class: info.class || '',
      subject: info.subject || '',
      group: info.group || '',
      periods: info.period || [],
      timeTable: info.timeTable || '',
      periodSlot: info.periodSlot || '',
      specialization: info.specialization || '',
      totalStudents: totalStudents ?? 0,
      presentCount: presentCount ?? 0,
      absentRolls: absentRolls || [],
      allStudents: allStudents || []
    });

    await session.save();
    res.status(201).json({ success: true, id: session._id });
  } catch (err) {
    console.error('[API] Save error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// GET — sessions filtered by teacherId
app.get('/api/sessions', async (req, res) => {
  try {
    const { page = 1, limit = 1000, search = '', teacherId = 'default' } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const baseFilter = { teacherId };

    const filter = search
      ? {
        ...baseFilter,
        $or: [
          { group: { $regex: search, $options: 'i' } },
          { subject: { $regex: search, $options: 'i' } },
          { date: { $regex: search, $options: 'i' } },
          { class: { $regex: search, $options: 'i' } }
        ]
      }
      : baseFilter;

    const [sessions, total] = await Promise.all([
      Session.find(filter).sort({ submittedAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      Session.countDocuments(filter)
    ]);

    res.json({ sessions, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — single session by ID
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const session = await Session.findById(req.params.id).lean();
    if (!session) return res.status(404).json({ error: 'Session not found' });
    res.json(session);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET — stats filtered by teacherId
app.get('/api/stats', async (req, res) => {
  try {
    const { teacherId = 'default' } = req.query;
    const filter = { teacherId };

    const total = await Session.countDocuments(filter);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const todayCount = await Session.countDocuments({ ...filter, submittedAt: { $gte: today } });

    const agg = await Session.aggregate([
      { $match: filter },
      { $group: { _id: null, totalStudents: { $sum: '$totalStudents' }, totalPresent: { $sum: '$presentCount' } } }
    ]);

    const sums = agg[0] || { totalStudents: 0, totalPresent: 0 };
    res.json({
      totalSessions: total,
      todaySessions: todayCount,
      totalStudents: sums.totalStudents,
      totalPresent: sums.totalPresent,
      totalAbsent: sums.totalStudents - sums.totalPresent
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — remove a session
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    await Session.findByIdAndDelete(req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Task Routes ─────────────────────────────────────────────

// GET — fetch all tasks for teacherId
app.get('/api/tasks', async (req, res) => {
  try {
    const { teacherId = 'default' } = req.query;
    const tasks = await Task.find({ teacherId }).sort({ createdAt: -1 }).lean();
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST — create new task
app.post('/api/tasks', async (req, res) => {
  try {
    const { teacherId = 'default', title, description = '', priority = 'medium', dueDate = '' } = req.body;
    if (!title || !title.trim()) {
      return res.status(400).json({ success: false, error: 'Title is required' });
    }
    const task = new Task({
      teacherId,
      title: title.trim(),
      description: description.trim(),
      priority,
      dueDate
    });
    await task.save();
    
    // Broadcast real-time socket event
    io.to(teacherId).emit('task_created', task);

    res.status(201).json({ success: true, task });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// PUT — update task (toggle completed, title, description, priority, dueDate)
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
    
    // Broadcast real-time socket event
    io.to(task.teacherId || 'default').emit('task_updated', task);

    res.json({ success: true, task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE — delete a task
app.delete('/api/tasks/:id', async (req, res) => {
  try {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) return res.status(404).json({ error: 'Task not found' });
    
    // Broadcast real-time socket event
    io.to(task.teacherId || 'default').emit('task_deleted', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Database Connection with Retry ───────────────────────────
const connectWithRetry = () => {
  console.log('[DB] Connecting to MongoDB...');
  mongoose.connect(MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  })
    .then(() => console.log('✅  MongoDB connected.'))
    .catch(err => {
      console.error('❌  MongoDB connection failed. Retrying in 5s...', err.message);
      setTimeout(connectWithRetry, 5000);
    });
};

connectWithRetry();

// Start the server via httpServer (enables WebSockets + Express)
httpServer.listen(PORT, () => {
  console.log(`🚀  Server running with Socket.io via Port ${PORT}`);
});
